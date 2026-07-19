import { forwardRef, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";

import { AuditService } from "../common/audit/audit.service";
import { AppException } from "../common/errors/app.exception";
import { MetricsService } from "../metrics/metrics.service";
import { PrismaService } from "../database/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { OrdersService } from "../orders/orders.service";
import {
  WECHAT_PAY_PROVIDER,
  WeChatNotifyPayload,
  WeChatPayProvider,
  WeChatPrepayInput,
  WECHAT_PREPAY_TTL_MS,
  WeChatRefundNotifyPayload
} from "./wechat/wechat-pay.provider";

type FulfillPaymentTxResult = {
  alreadyProcessed: boolean;
  orderId: string;
  conversationCreated: boolean;
  orderStatus: string;
  userId: string;
  amountCents: number;
  paymentId: string;
};

const MIN_PREPAY_LEAD_MS = 5 * 60 * 1000;
const MIN_PREPAY_USABLE_WINDOW_MS = 60 * 1000;
// Keep a small issuance allowance so the client still receives at least a
// full minute after the WeChat create-order round trip completes.
const PREPAY_ISSUANCE_ALLOWANCE_MS = 25 * 1000;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(forwardRef(() => OrdersService)) private readonly ordersService: OrdersService,
    @Inject(WECHAT_PAY_PROVIDER) private readonly wechat: WeChatPayProvider,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly metrics: MetricsService
  ) {}

  async prepay(
    userId: string,
    orderId: string,
    channel: "app" | "miniProgram" = "app"
  ): Promise<any> {
    const orderRef = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { userId: true, companionId: true }
    } as any);
    if (!orderRef || orderRef.userId !== userId) {
      throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
    }

    let createdRemoteTradeNo: string | undefined;
    const remotelyClosedPayments: Array<{ id: string; outTradeNo: string; orderId: string }> = [];
    let result: any;
    try {
      result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      // Every prepay locks companion first, then order. This global lock order
      // lets overlapping orders serialize without deadlocking each other.
      await db.$queryRaw`SELECT "id" FROM "CompanionProfile" WHERE "id" = ${orderRef.companionId} FOR UPDATE`;
      await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;

      const order = await db.order.findUnique({
        where: { id: orderId },
        include: {
          conversation: { select: { externalId: true } },
          companion: {
            include: { owner: { include: { profile: true } } }
          }
        }
      });

      this.assertOrderCanPrepay(order, userId);
      await this.assertCompanionSlotAvailable(db, order, remotelyClosedPayments);

      const existing = await db.paymentTransaction.findFirst({
        where: { orderId, status: "initiated" },
        orderBy: { createdAt: "desc" }
      });
      if (existing) {
        const expiresAt = existing.expiresAt instanceof Date
          ? existing.expiresAt
          : new Date(existing.createdAt.getTime() + WECHAT_PREPAY_TTL_MS);
        if (expiresAt.getTime() <= Date.now() + MIN_PREPAY_USABLE_WINDOW_MS) {
          // Local expiry alone is not enough: the old order must be confirmed
          // closed at WeChat before another payable prepay can be created.
          await this.wechat.closePayment(existing.outTradeNo);
          remotelyClosedPayments.push({ id: existing.id, outTradeNo: existing.outTradeNo, orderId });
          const closed = await db.paymentTransaction.updateMany({
            where: { id: existing.id, status: "initiated" },
            data: { status: "closed" }
          });
          if (closed.count !== 1) {
            throw new AppException(
              "PAYMENT_STATE_CHANGED",
              "Payment state changed while closing the expired prepay",
              HttpStatus.CONFLICT
            );
          }
          const resetOrder = order.status === "paying"
            ? await db.order.update({
                where: { id: orderId },
                data: { status: "pending" },
                include: { conversation: { select: { externalId: true } } }
              })
            : order;
          // Commit the remote/local close before attempting a replacement. If
          // the next WeChat create call fails, the old remotely closed trade no
          // must never be resurrected by rolling this transaction back.
          return { retryAfterClose: true, order: resetOrder };
        } else {
        const existingChannel = this.prepayChannel(existing.clientParams);
        if (existingChannel !== channel) {
          throw new AppException(
            "PAYMENT_CHANNEL_MISMATCH",
            `An active ${existingChannel} prepay already exists for this order`,
            HttpStatus.CONFLICT
          );
        }

        const currentOrder = order.status === "paying"
          ? order
          : await db.order.update({
              where: { id: orderId },
              data: { status: "paying" },
              include: { conversation: { select: { externalId: true } } }
            });
        return {
          order: currentOrder,
          payment: existing,
          prepay: {
            mock: this.wechat.isMock,
            channel: existingChannel,
            clientParams: existing.clientParams
          }
        };
        }
      }

      const outTradeNo = `T${Date.now()}${randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const expiresAt = new Date(Math.min(
        Date.now() + WECHAT_PREPAY_TTL_MS,
        order.scheduledAt.getTime() - MIN_PREPAY_LEAD_MS
      ));
      if (expiresAt.getTime() <= Date.now() + MIN_PREPAY_USABLE_WINDOW_MS) {
        throw new AppException(
          "ORDER_PAYMENT_WINDOW_EXPIRED",
          "At least 60 seconds must remain to complete WeChat payment",
          HttpStatus.CONFLICT
        );
      }
      const input: WeChatPrepayInput = {
        outTradeNo,
        description: `Talk&Talk 陪伴服务 ${order.durationMinutes}分钟`,
        amountCents: order.amountCents,
        notifyUrl: this.buildNotifyUrl(),
        expiresAt
      };
      const prepay = channel === "miniProgram"
        ? await this.wechat.createMiniProgramPrepay({
            ...input,
            openId: await this.findMiniProgramOpenId(userId)
          })
        : await this.wechat.createAppPrepay(input);
      createdRemoteTradeNo = outTradeNo;

      const created = await db.paymentTransaction.create({
        data: {
          orderId,
          outTradeNo,
          provider: "wechat",
          amountCents: order.amountCents,
          status: "initiated",
          prepayId: prepay.prepayId,
          clientParams: prepay.clientParams,
          expiresAt
        }
      });

      const updatedOrder = await db.order.update({
        where: { id: orderId },
        data: { status: "paying" },
        include: { conversation: { select: { externalId: true } } }
      });

      return { order: updatedOrder, payment: created, prepay };
      }, { maxWait: 5_000, timeout: 20_000 });
    } catch (error) {
      for (const remotelyClosedPayment of remotelyClosedPayments) {
        await this.reconcileRemotelyClosedPrepay(remotelyClosedPayment);
      }
      if (createdRemoteTradeNo) {
        await this.closeOrphanedPrepay(createdRemoteTradeNo);
      }
      throw error;
    }

    if (result.retryAfterClose) {
      return this.prepay(userId, orderId, channel);
    }

    return {
      order: this.ordersService.toDto(result.order),
      payment: {
        id: result.payment.id,
        outTradeNo: result.payment.outTradeNo,
        status: result.payment.status,
        mock: result.prepay.mock,
        channel: result.prepay.channel,
        wechatAppParams: result.prepay.channel === "app" ? result.prepay.clientParams : undefined,
        wechatMiniProgramParams: result.prepay.channel === "miniProgram" ? result.prepay.clientParams : undefined
      }
    };
  }

  async handleWechatNotify(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string
  ) {
    try {
      // Real provider needs platform certs before sync RSA verify.
      const maybeReal = this.wechat as WeChatPayProvider & {
        ensurePlatformCertificates?: () => Promise<void>;
      };
      if (typeof maybeReal.ensurePlatformCertificates === "function") {
        await maybeReal.ensurePlatformCertificates();
      }

      if (!this.wechat.verifyNotifySignature(headers, rawBody)) {
        throw new AppException(
          "WECHAT_SIGN_INVALID",
          "WeChat notify signature verification failed",
          HttpStatus.UNAUTHORIZED
        );
      }

      const payload = this.wechat.parseNotifyPayload(rawBody);
      this.validateWechatCallbackIdentity(payload, true);
      if (payload.currency !== "CNY") {
        throw new AppException(
          "PAYMENT_CURRENCY_MISMATCH",
          "WeChat payment currency must be CNY",
          HttpStatus.BAD_REQUEST
        );
      }
      const result = await this.fulfillPayment(payload);
      await this.refundIfServiceWindowExpired(result.data.orderId);
      this.metrics.recordWechatNotifySuccess();
      return result;
    } catch (error) {
      this.metrics.recordWechatNotifyFailure();
      throw error;
    }
  }

  async mockNotify(userId: string, body: { outTradeNo: string; amountCents?: number; transactionId?: string }) {
    if (this.config.getOrThrow<string>("APP_ENV") === "production") {
      throw new AppException(
        "MOCK_PAY_DISABLED",
        "Mock WeChat notify is disabled in production",
        HttpStatus.FORBIDDEN
      );
    }

    const payment: any = await this.prisma.paymentTransaction.findUnique({
      where: { outTradeNo: body.outTradeNo },
      include: { order: true }
    } as any);

    if (!payment || !payment.order || payment.order.userId !== userId) {
      throw new AppException("PAYMENT_NOT_FOUND", "Payment not found", HttpStatus.NOT_FOUND);
    }

    const amountCents = body.amountCents ?? payment.amountCents;
    const raw = JSON.stringify({
      out_trade_no: payment.outTradeNo,
      transaction_id: body.transactionId ?? `mock_txn_${payment.outTradeNo}`,
      trade_state: "SUCCESS",
      amount: { total: amountCents },
      outTradeNo: payment.outTradeNo,
      transactionId: body.transactionId ?? `mock_txn_${payment.outTradeNo}`,
      tradeState: "SUCCESS",
      amountCents
    });

    const result = await this.fulfillPayment({
      appId: this.config.get<string>("WECHAT_MINIPROGRAM_APP_ID", "") || "wx_mock_app_id",
      mchId: this.config.get<string>("WECHAT_PAY_MCH_ID", "") || "1900000000",
      outTradeNo: payment.outTradeNo,
      transactionId: body.transactionId ?? `mock_txn_${payment.outTradeNo}`,
      tradeState: "SUCCESS",
      amountCents,
      currency: "CNY",
      raw: JSON.parse(raw)
    });
    await this.refundIfServiceWindowExpired(result.data.orderId);
    return result;
  }

  async syncPayment(userId: string, orderId: string) {
    const order: any = await this.prisma.order.findUnique({ where: { id: orderId } } as any);
    if (!order || order.userId !== userId) {
      throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
    }
    const payment: any = await this.prisma.paymentTransaction.findFirst({
      where: { orderId, status: { in: ["initiated", "success"] } },
      orderBy: { createdAt: "desc" }
    } as any);
    if (!payment) {
      throw new AppException("PAYMENT_NOT_FOUND", "Payment not found", HttpStatus.NOT_FOUND);
    }
    if (payment.status === "success") {
      await this.refundIfServiceWindowExpired(orderId);
      return {
        code: "SUCCESS" as const,
        message: "支付已确认",
        data: { alreadyProcessed: true, orderId, orderStatus: order.status }
      };
    }

    const payload = await this.wechat.queryPayment(payment.outTradeNo);
    if (payload.outTradeNo !== payment.outTradeNo) {
      throw new AppException(
        "PAYMENT_TRANSACTION_MISMATCH",
        "WeChat query result does not match the local payment",
        HttpStatus.BAD_REQUEST
      );
    }
    if (payload.tradeState !== "SUCCESS") {
      return {
        code: "PENDING" as const,
        message: `微信支付状态：${payload.tradeState || "UNKNOWN"}`,
        data: { alreadyProcessed: false, orderId, orderStatus: order.status }
      };
    }
    this.validateWechatCallbackIdentity(payload, true);
    if (payload.currency !== "CNY") {
      throw new AppException(
        "PAYMENT_CURRENCY_MISMATCH",
        "WeChat payment currency must be CNY",
        HttpStatus.BAD_REQUEST
      );
    }
    const result = await this.fulfillPayment(payload);
    await this.refundIfServiceWindowExpired(result.data.orderId);
    return result;
  }

  async settlePaymentForDeletion(userId: string, orderId: string) {
    const sync = await this.syncPayment(userId, orderId);
    if (sync.code !== "PENDING") {
      return { sync, closedExpiredPayment: false };
    }

    // This never creates or replaces a prepay. OrdersService.cancel only closes
    // an initiated WeChat payment after its authoritative expiry time and then
    // moves the local order to a terminal cancelled state.
    const order = await this.ordersService.cancel(userId, orderId);
    return { sync, closedExpiredPayment: true, order };
  }

  async requestRefund(
    userId: string,
    orderId: string,
    reason?: string,
    deletionContext?: { actorId: string; requestId: string }
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      const order = await db.order.findUnique({ where: { id: orderId } });
      if (!order || order.userId !== userId) {
        throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
      }
      const existing = await db.refundTransaction.findFirst({
        where: {
          orderId,
          status: { in: ["pendingReview", "pending", "processing", "success", "failed"] }
        },
        orderBy: { createdAt: "asc" }
      });
      if (existing) return { order, refund: existing, created: false };
      if (!["paid", "inService", "completed"].includes(order.status)) {
        throw new AppException("ORDER_INVALID_STATE", "Order is not eligible for refund", HttpStatus.CONFLICT);
      }
      const payment = await db.paymentTransaction.findFirst({
        where: { orderId, status: "success" },
        orderBy: { paidAt: "desc" }
      });
      if (!payment?.transactionId) {
        throw new AppException("PAYMENT_NOT_FOUND", "Successful WeChat payment not found", HttpStatus.NOT_FOUND);
      }
      await db.$queryRaw`SELECT "id" FROM "PaymentTransaction" WHERE "id" = ${payment.id} FOR UPDATE`;

      const needsReview = order.status === "inService" || order.status === "completed";
      const refund = await db.refundTransaction.create({
        data: {
          orderId,
          paymentId: payment.id,
          outRefundNo: `R${Date.now()}${randomUUID().replace(/-/g, "").slice(0, 10)}`,
          amountCents: order.amountCents,
          status: needsReview ? "pendingReview" : "pending",
          reason: reason?.trim() || null
        }
      });
      if (deletionContext) {
        await this.audit.record({
          actorId: deletionContext.actorId,
          action: "account.deletion_refund_initiated",
          resourceType: "accountDeletionRequest",
          resourceId: deletionContext.requestId,
          metadata: {
            userId,
            orderId,
            refundId: refund.id,
            amountCents: order.amountCents,
            reasonCode: "ACCOUNT_DELETION_SETTLEMENT"
          }
        }, db);
      }
      return { order, refund, created: true };
    }, { maxWait: 5_000, timeout: 10_000 });

    const needsReview = result.refund.status === "pendingReview";
    if (result.created) {
      await this.audit.record({
        actorId: userId,
        action: "refund.requested",
        resourceType: "refund",
        resourceId: result.refund.id,
        metadata: { orderId, amountCents: result.order.amountCents, needsReview }
      });
    }
    if (needsReview) {
      if (result.created) {
        await this.notifications.create(
          userId,
          "orderStatus",
          "售后申请待审核",
          "平台将在审核后通知你处理结果。",
          { orderId, refundId: result.refund.id, status: "pendingReview" }
        );
      }
      return {
        refund: this.refundDto(result.refund),
        order: this.ordersService.toDto(result.order),
        created: result.created
      };
    }
    if (["processing", "success"].includes(result.refund.status)) {
      return {
        refund: this.refundDto(result.refund),
        order: this.ordersService.toDto(result.order),
        created: result.created
      };
    }
    const submitted = await this.submitRefundToWechat(result.refund.id);
    return { ...submitted, created: result.created };
  }

  async approveRefund(actorId: string, refundId: string, note?: string) {
    const decision = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "RefundTransaction" WHERE "id" = ${refundId} FOR UPDATE`;
      const refund = await db.refundTransaction.findUnique({
        where: { id: refundId },
        include: { order: true }
      });
      if (!refund) throw new AppException("REFUND_NOT_FOUND", "Refund not found", HttpStatus.NOT_FOUND);

      if (refund.status === "pendingReview") {
        const updated = await db.refundTransaction.update({
          where: { id: refundId },
          data: {
            status: "pending",
            reviewedById: actorId,
            reviewedAt: new Date(),
            reviewNote: note?.trim() || null
          },
          include: { order: true }
        });
        return { refund: updated, newlyApproved: true, shouldSubmit: true };
      }

      // An approval is idempotent after the winning reviewer commits. Retrying
      // a still-pending/explicitly-failed submission reuses the same outRefundNo;
      // submitRefundToWechat's atomic claim ensures only one provider request.
      if (refund.reviewedAt && ["pending", "failed", "processing", "success"].includes(refund.status)) {
        return {
          refund,
          newlyApproved: false,
          shouldSubmit: ["pending", "failed"].includes(refund.status)
        };
      }
      throw new AppException("REFUND_INVALID_STATE", "Refund is not awaiting review", HttpStatus.CONFLICT);
    }, { maxWait: 5_000, timeout: 10_000 });

    if (decision.newlyApproved) {
      await this.audit.record({ actorId, action: "refund.approved", resourceType: "refund", resourceId: refundId });
    }
    if (decision.shouldSubmit) return this.submitRefundToWechat(refundId);
    return {
      refund: this.refundDto(decision.refund),
      order: this.ordersService.toDto(decision.refund.order)
    };
  }

  async listRefundsAwaitingReview() {
    const items: any[] = await this.prisma.refundTransaction.findMany({
      where: { status: { in: ["pendingReview", "failed"] } },
      include: { order: true, payment: true },
      orderBy: { createdAt: "asc" },
      take: 200
    } as any);
    return {
      items: items.map((item) => ({
        ...this.refundDto(item),
        orderId: item.orderId,
        userId: item.order.userId,
        orderStatus: item.order.status,
        paymentOutTradeNo: item.payment.outTradeNo
      }))
    };
  }

  async rejectRefund(actorId: string, refundId: string, note?: string) {
    const { refund, updated } = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "RefundTransaction" WHERE "id" = ${refundId} FOR UPDATE`;
      const current = await db.refundTransaction.findUnique({
        where: { id: refundId },
        include: { order: true }
      });
      if (!current) throw new AppException("REFUND_NOT_FOUND", "Refund not found", HttpStatus.NOT_FOUND);
      if (current.status !== "pendingReview") {
        throw new AppException("REFUND_INVALID_STATE", "Refund is not awaiting review", HttpStatus.CONFLICT);
      }
      const rejected = await db.refundTransaction.update({
        where: { id: refundId },
        data: {
          status: "rejected",
          reviewedById: actorId,
          reviewedAt: new Date(),
          reviewNote: note?.trim() || null
        }
      });
      return { refund: current, updated: rejected };
    }, { maxWait: 5_000, timeout: 10_000 });
    await this.audit.record({ actorId, action: "refund.rejected", resourceType: "refund", resourceId: refundId });
    await this.notifications.create(refund.order.userId, "orderStatus", "售后申请未通过", note?.trim() || "本次退款申请未通过审核。", { orderId: refund.orderId, refundId, status: "rejected" });
    return { refund: this.refundDto(updated), order: this.ordersService.toDto(refund.order) };
  }

  async syncRefund(userId: string, orderId: string) {
    const refund: any = await this.prisma.refundTransaction.findFirst({
      where: { orderId, order: { userId } }, orderBy: { createdAt: "desc" }
    } as any);
    if (!refund) throw new AppException("REFUND_NOT_FOUND", "Refund not found", HttpStatus.NOT_FOUND);
    if (["processing", "pending"].includes(refund.status)) {
      const result = await this.wechat.queryRefund(refund.outRefundNo);
      await this.applyRefundResult(refund.id, result.status, result.refundId);
    }
    const current: any = await this.prisma.refundTransaction.findUnique({ where: { id: refund.id }, include: { order: true } } as any);
    return { refund: this.refundDto(current), order: this.ordersService.toDto(current.order) };
  }

  async handleWechatRefundNotify(headers: Record<string, string | string[] | undefined>, rawBody: string) {
    const maybeReal = this.wechat as WeChatPayProvider & { ensurePlatformCertificates?: () => Promise<void> };
    if (typeof maybeReal.ensurePlatformCertificates === "function") await maybeReal.ensurePlatformCertificates();
    if (!this.wechat.verifyNotifySignature(headers, rawBody)) {
      throw new AppException("WECHAT_SIGN_INVALID", "WeChat notify signature verification failed", HttpStatus.UNAUTHORIZED);
    }
    const payload = this.wechat.parseRefundNotifyPayload(rawBody);
    // WeChat's domestic refund notification omits AppID and currency in some
    // documented payload versions. Validate either field whenever it is present,
    // while merchant, payment, transaction, refund, and amounts remain mandatory.
    this.validateWechatCallbackIdentity(payload, false);
    if (payload.currency && payload.currency !== "CNY") {
      throw new AppException(
        "REFUND_CURRENCY_MISMATCH",
        "WeChat refund currency must be CNY when supplied",
        HttpStatus.BAD_REQUEST
      );
    }
    if (
      !payload.outRefundNo ||
      !payload.refundId ||
      !payload.outTradeNo ||
      !payload.transactionId ||
      !Number.isInteger(payload.refundAmountCents) ||
      !Number.isInteger(payload.totalAmountCents)
    ) {
      throw new AppException(
        "REFUND_INVALID",
        "WeChat refund notify is missing required binding fields",
        HttpStatus.BAD_REQUEST
      );
    }

    const refund: any = await this.prisma.refundTransaction.findUnique({
      where: { outRefundNo: payload.outRefundNo },
      include: { payment: true, order: true }
    } as any);
    if (!refund) throw new AppException("REFUND_NOT_FOUND", "Refund not found", HttpStatus.NOT_FOUND);
    if (
      refund.paymentId !== refund.payment?.id ||
      refund.orderId !== refund.order?.id ||
      refund.payment?.orderId !== refund.orderId ||
      refund.payment?.provider !== "wechat" ||
      refund.payment?.outTradeNo !== payload.outTradeNo ||
      refund.payment?.transactionId !== payload.transactionId
    ) {
      throw new AppException(
        "REFUND_BINDING_MISMATCH",
        "WeChat refund notify does not match the local payment",
        HttpStatus.BAD_REQUEST
      );
    }
    if (
      payload.refundAmountCents !== refund.amountCents ||
      payload.totalAmountCents !== refund.order.amountCents ||
      refund.order.currency !== "CNY"
    ) {
      throw new AppException(
        "REFUND_AMOUNT_MISMATCH",
        "WeChat refund notify amount does not match the local refund",
        HttpStatus.BAD_REQUEST,
        {
          notifyRefundAmount: payload.refundAmountCents,
          localRefundAmount: refund.amountCents,
          notifyTotalAmount: payload.totalAmountCents,
          localOrderAmount: refund.order.amountCents
        }
      );
    }
    if (refund.providerRefundId && refund.providerRefundId !== payload.refundId) {
      throw new AppException(
        "REFUND_ID_MISMATCH",
        "WeChat refund id conflicts with the local refund",
        HttpStatus.BAD_REQUEST
      );
    }
    const conflictingRefund: any = await this.prisma.refundTransaction.findFirst({
      where: {
        providerRefundId: payload.refundId,
        NOT: { id: refund.id }
      }
    } as any);
    if (conflictingRefund) {
      throw new AppException(
        "REFUND_ID_MISMATCH",
        "WeChat refund id is already bound to another local refund",
        HttpStatus.BAD_REQUEST
      );
    }
    await this.applyRefundResult(refund.id, payload.status, payload.refundId);
    return { code: "SUCCESS", message: "成功" };
  }

  private async fulfillPayment(payload: WeChatNotifyPayload) {
    if (payload.tradeState !== "SUCCESS") {
      throw new AppException(
        "PAYMENT_NOT_SUCCESS",
        `Trade state is ${payload.tradeState}`,
        HttpStatus.BAD_REQUEST
      );
    }

    if (!payload.outTradeNo || !payload.transactionId || !Number.isInteger(payload.amountCents)) {
      throw new AppException(
        "PAYMENT_INVALID",
        "Payment notify is missing required transaction fields",
        HttpStatus.BAD_REQUEST
      );
    }

    const paymentRef = await this.prisma.paymentTransaction.findUnique({
      where: { outTradeNo: payload.outTradeNo },
      select: { orderId: true }
    } as any);
    if (!paymentRef) {
      throw new AppException("PAYMENT_NOT_FOUND", "Payment not found", HttpStatus.NOT_FOUND);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      // Use the same lock order as prepay/cancel to avoid both lost updates and
      // deadlocks. A duplicate callback waits, then observes status=success.
      await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${paymentRef.orderId} FOR UPDATE`;
      await db.$queryRaw`SELECT "id" FROM "PaymentTransaction" WHERE "outTradeNo" = ${payload.outTradeNo} FOR UPDATE`;
      const payment = await db.paymentTransaction.findUnique({
        where: { outTradeNo: payload.outTradeNo },
        include: { order: true }
      });

      if (!payment) {
        throw new AppException("PAYMENT_NOT_FOUND", "Payment not found", HttpStatus.NOT_FOUND);
      }

      const order = payment.order;

      if (payment.provider !== "wechat") {
        throw new AppException(
          "PAYMENT_PROVIDER_MISMATCH",
          "Payment notify does not match the local provider",
          HttpStatus.BAD_REQUEST
        );
      }

      if (payment.transactionId && payment.transactionId !== payload.transactionId) {
        throw new AppException(
          "PAYMENT_TRANSACTION_MISMATCH",
          "WeChat transaction id conflicts with the local payment",
          HttpStatus.BAD_REQUEST
        );
      }

      const transactionBinding = await db.paymentTransaction.findUnique({
        where: {
          provider_transactionId: {
            provider: "wechat",
            transactionId: payload.transactionId
          }
        }
      });
      if (transactionBinding && transactionBinding.id !== payment.id) {
        throw new AppException(
          "PAYMENT_TRANSACTION_MISMATCH",
          "WeChat transaction id is already bound to another local payment",
          HttpStatus.BAD_REQUEST
        );
      }

      if (
        payload.amountCents !== payment.amountCents ||
        payload.amountCents !== order.amountCents ||
        payload.currency !== order.currency
      ) {
        throw new AppException(
          "PAYMENT_AMOUNT_MISMATCH",
          "Notify amount does not match order amount",
          HttpStatus.BAD_REQUEST,
          {
            notifyAmount: payload.amountCents,
            paymentAmount: payment.amountCents,
            orderAmount: order.amountCents
          }
        );
      }

      // Idempotent: already fulfilled
      if (payment.status === "success") {
        return {
          alreadyProcessed: true,
          orderId: order.id,
          conversationCreated: false,
          orderStatus: order.status,
          userId: order.userId,
          amountCents: order.amountCents,
          paymentId: payment.id
        } satisfies FulfillPaymentTxResult;
      }

      if (payment.status !== "initiated") {
        throw new AppException(
          "PAYMENT_INVALID_STATE",
          `Payment status ${payment.status} cannot accept a success callback`,
          HttpStatus.CONFLICT
        );
      }

      if (!["pending", "paying"].includes(order.status)) {
        throw new AppException(
          "ORDER_INVALID_STATE",
          `Order status ${order.status} cannot accept payment`,
          HttpStatus.CONFLICT
        );
      }

      const paidAt = new Date();

      await db.paymentTransaction.update({
        where: { id: payment.id },
        data: {
          status: "success",
          transactionId: payload.transactionId,
          notifyPayload: payload.raw,
          paidAt
        }
      });

      let conversation = await db.conversation.findUnique({
        where: {
          userId_companionId: {
            userId: order.userId,
            companionId: order.companionId
          }
        }
      });

      let conversationCreated = false;
      if (!conversation) {
        conversation = await db.conversation.create({
          data: {
            externalId: order.companionId,
            userId: order.userId,
            companionId: order.companionId
          }
        });
        conversationCreated = true;
      }

      // Only write system activation message once per order (when first paid)
      if (!order.conversationId) {
        await db.message.create({
          data: {
            conversationId: conversation.id,
            senderId: "system",
            senderName: "系统",
            content: "订单已支付，平台担保沟通已开启。请在平台内完成服务，勿交换私人联系方式。",
            type: "system",
            createdAt: paidAt
          }
        });
      }

      await db.order.update({
        where: { id: order.id },
        data: {
          status: "paid",
          paidAt,
          conversationId: conversation.id
        }
      });

      await db.conversation.update({
        where: { id: conversation.id },
        data: { updatedAt: paidAt }
      });

      return {
        alreadyProcessed: false,
        orderId: order.id,
        conversationCreated,
        orderStatus: "paid",
        userId: order.userId,
        amountCents: order.amountCents,
        paymentId: payment.id
      } satisfies FulfillPaymentTxResult;
    }, { maxWait: 5_000, timeout: 20_000 });

    if (!result.alreadyProcessed) {
      await this.audit.record({
        actorId: result.userId,
        action: "payment.fulfilled",
        resourceType: "order",
        resourceId: result.orderId,
        metadata: {
          paymentId: result.paymentId,
          amountCents: result.amountCents,
          outTradeNo: payload.outTradeNo
        }
      });
      await this.notifications.create(
        result.userId,
        "paymentSuccess",
        "支付成功",
        "订单已支付，平台担保沟通已开启。",
        { orderId: result.orderId, status: "paid" }
      );
    }

    return {
      code: "SUCCESS" as const,
      message: "成功",
      data: {
        alreadyProcessed: result.alreadyProcessed,
        orderId: result.orderId,
        conversationCreated: result.conversationCreated,
        orderStatus: result.orderStatus
      }
    };
  }

  private buildNotifyUrl(): string {
    const prefix = this.config.getOrThrow<string>("API_PREFIX");
    const baseUrl = this.config.get<string>("WECHAT_PAY_NOTIFY_BASE_URL")?.trim();
    const path = `/${prefix}/payments/wechat/notify`;
    return baseUrl ? `${baseUrl}${path}` : path;
  }

  private assertOrderCanPrepay(order: any, userId: string): void {
    if (!order || order.userId !== userId) {
      throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
    }
    if (["paid", "inService", "completed"].includes(order.status)) {
      throw new AppException("ORDER_INVALID_STATE", "Order is already paid", HttpStatus.CONFLICT);
    }
    if (!["pending", "paying"].includes(order.status)) {
      throw new AppException(
        "ORDER_INVALID_STATE",
        "Order cannot be prepaid in current state",
        HttpStatus.CONFLICT
      );
    }
    if (!(order.scheduledAt instanceof Date) ||
        order.scheduledAt.getTime() <= Date.now() + MIN_PREPAY_LEAD_MS +
          MIN_PREPAY_USABLE_WINDOW_MS + PREPAY_ISSUANCE_ALLOWANCE_MS) {
      throw new AppException(
        "ORDER_PAYMENT_WINDOW_EXPIRED",
        "Payment must start early enough to leave a 60-second payment window before the 5-minute cutoff",
        HttpStatus.CONFLICT
      );
    }
    const owner = order.companion?.owner;
    if (!owner || owner.accountStatus !== "active" || owner.profile?.isVerified !== true) {
      throw new AppException(
        "COMPANION_UNAVAILABLE",
        "The companion account is not active and verified",
        HttpStatus.CONFLICT
      );
    }
    if (!(order.companionConfirmedAt instanceof Date)) {
      throw new AppException(
        "ORDER_NOT_CONFIRMED",
        "The companion must confirm this order before payment",
        HttpStatus.CONFLICT
      );
    }
  }

  private async assertCompanionSlotAvailable(
    db: any,
    order: any,
    remotelyClosedPayments: Array<{ id: string; outTradeNo: string; orderId: string }>
  ): Promise<void> {
    const scheduledAt = order.scheduledAt as Date;
    const scheduledEnd = new Date(scheduledAt.getTime() + order.durationMinutes * 60_000);
    const candidates = await db.$queryRaw`
      SELECT candidate."id"
      FROM "Order" AS candidate
      WHERE candidate."companionId" = ${order.companionId}
        AND candidate."id" <> ${order.id}
        AND candidate."scheduledAt" < ${scheduledEnd}
        AND candidate."scheduledAt" + candidate."durationMinutes" * INTERVAL '1 minute' > ${scheduledAt}
        AND candidate."status" IN ('pending', 'paying', 'paid', 'inService', 'completed')
      ORDER BY candidate."id"
    `;
    if (!Array.isArray(candidates)) return;

    for (const candidateRef of candidates) {
      const candidateId = String((candidateRef as { id: unknown }).id);
      await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${candidateId} FOR UPDATE`;
      const candidate = await db.order.findUnique({
        where: { id: candidateId },
        include: {
          payments: {
            where: { status: { in: ["initiated", "success"] } },
            orderBy: { createdAt: "desc" }
          }
        }
      });
      if (!candidate || !["pending", "paying", "paid", "inService", "completed"].includes(candidate.status)) {
        continue;
      }
      if (["paid", "inService"].includes(candidate.status) ||
          candidate.payments.some((payment: any) => payment.status === "success")) {
        this.throwCompanionSlotUnavailable();
      }

      const activePayment = candidate.payments.find((payment: any) => payment.status === "initiated");
      if (!activePayment) {
        if (candidate.status === "paying") {
          await db.order.update({ where: { id: candidate.id }, data: { status: "pending" } });
        }
        continue;
      }
      const expiresAt = activePayment.expiresAt instanceof Date
        ? activePayment.expiresAt
        : new Date(activePayment.createdAt.getTime() + WECHAT_PREPAY_TTL_MS);
      if (expiresAt.getTime() > Date.now()) {
        this.throwCompanionSlotUnavailable();
      }

      // Reclaim an abandoned slot only after WeChat confirms that its expired
      // prepay is no longer payable. ORDER_PAID/error keeps the slot reserved.
      await this.wechat.closePayment(activePayment.outTradeNo);
      remotelyClosedPayments.push({
        id: activePayment.id,
        outTradeNo: activePayment.outTradeNo,
        orderId: candidate.id
      });
      const closed = await db.paymentTransaction.updateMany({
        where: { id: activePayment.id, status: "initiated" },
        data: { status: "closed" }
      });
      if (closed.count !== 1) {
        throw new AppException(
          "PAYMENT_STATE_CHANGED",
          "Payment state changed while reclaiming an expired slot",
          HttpStatus.CONFLICT
        );
      }
      if (candidate.status === "paying") {
        await db.order.update({ where: { id: candidate.id }, data: { status: "pending" } });
      }
    }
  }

  private throwCompanionSlotUnavailable(): never {
    throw new AppException(
      "COMPANION_SLOT_UNAVAILABLE",
      "The companion already has a payment or service for this time slot",
      HttpStatus.CONFLICT
    );
  }

  private prepayChannel(clientParams: unknown): "app" | "miniProgram" {
    if (!clientParams || typeof clientParams !== "object" || Array.isArray(clientParams)) {
      throw new AppException(
        "PAYMENT_INVALID_STATE",
        "Active payment is missing reusable client parameters",
        HttpStatus.CONFLICT
      );
    }
    return "paySign" in clientParams ? "miniProgram" : "app";
  }

  private async closeOrphanedPrepay(outTradeNo: string): Promise<void> {
    try {
      // A COMMIT response can be uncertain. If the row is visible, preserve it
      // for the retry path; otherwise close the externally-created orphan.
      const persisted = await this.prisma.paymentTransaction.findUnique({
        where: { outTradeNo },
        select: { id: true }
      } as any);
      if (!persisted) {
        await this.wechat.closePayment(outTradeNo);
      }
    } catch {
      // Financial safety wins over availability when DB commit state cannot be
      // established: best-effort close prevents an untracked payable order.
      await this.wechat.closePayment(outTradeNo).catch(() => undefined);
    }
  }

  private async reconcileRemotelyClosedPrepay(payment: {
    id: string;
    outTradeNo: string;
    orderId: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${payment.orderId} FOR UPDATE`;
      await db.paymentTransaction.updateMany({
        where: { id: payment.id, outTradeNo: payment.outTradeNo, status: "initiated" },
        data: { status: "closed" }
      });
      const payable = await db.paymentTransaction.findFirst({
        where: { orderId: payment.orderId, status: { in: ["initiated", "success"] } },
        select: { id: true }
      });
      if (!payable) {
        await db.order.updateMany({
          where: { id: payment.orderId, status: "paying" },
          data: { status: "pending" }
        });
      }
    }, { maxWait: 5_000, timeout: 10_000 });
  }

  private async refundIfServiceWindowExpired(orderId: string): Promise<void> {
    const order: any = await this.prisma.order.findUnique({ where: { id: orderId } } as any);
    if (!order || order.status !== "paid" || !(order.scheduledAt instanceof Date)) return;
    const scheduledEnd = order.scheduledAt.getTime() + order.durationMinutes * 60_000;
    if (Date.now() < scheduledEnd) return;
    await this.requestRefund(
      order.userId,
      order.id,
      "支付回调到达时预约服务窗口已结束，系统自动原路退款"
    );
  }

  private validateWechatCallbackIdentity(
    payload: Pick<WeChatNotifyPayload, "appId" | "mchId"> | Pick<WeChatRefundNotifyPayload, "appId" | "mchId">,
    requireAppId: boolean
  ): void {
    const configuredMchId = this.config.get<string>("WECHAT_PAY_MCH_ID", "").trim();
    const expectedMchId = configuredMchId || (this.wechat.isMock ? "1900000000" : "");
    if (!payload.mchId || !expectedMchId || payload.mchId !== expectedMchId) {
      throw new AppException(
        "WECHAT_MCH_ID_MISMATCH",
        "WeChat callback merchant id does not match this service",
        HttpStatus.BAD_REQUEST
      );
    }

    const expectedAppIds = [
      this.config.get<string>("WECHAT_MINIPROGRAM_APP_ID", "").trim(),
      this.config.get<string>("WECHAT_PAY_APP_ID", "").trim()
    ].filter(Boolean);
    if (expectedAppIds.length === 0 && this.wechat.isMock) {
      expectedAppIds.push("wx_mock_app_id");
    }
    if ((requireAppId || payload.appId) && (!payload.appId || !expectedAppIds.includes(payload.appId))) {
      throw new AppException(
        "WECHAT_APP_ID_MISMATCH",
        "WeChat callback AppID does not match this service",
        HttpStatus.BAD_REQUEST
      );
    }
  }

  private async findMiniProgramOpenId(userId: string): Promise<string> {
    const identity = await this.prisma.authIdentity.findFirst({
      where: { userId, provider: "wechatMiniProgram" },
      orderBy: { id: "asc" }
    });
    const openId = identity?.providerId?.trim();
    if (!openId) {
      throw new AppException(
        "WECHAT_OPENID_MISSING",
        "Sign in with WeChat Mini Program before starting Mini Program payment",
        HttpStatus.CONFLICT
      );
    }
    return openId;
  }

  private buildRefundNotifyUrl(): string {
    const prefix = this.config.getOrThrow<string>("API_PREFIX");
    const baseUrl = this.config.get<string>("WECHAT_PAY_NOTIFY_BASE_URL")?.trim();
    const path = `/${prefix}/payments/wechat/refund-notify`;
    return baseUrl ? `${baseUrl}${path}` : path;
  }

  private async submitRefundToWechat(refundId: string) {
    const claimed = await this.prisma.refundTransaction.updateMany({
      where: { id: refundId, status: { in: ["pending", "failed"] } },
      data: { status: "processing", failureReason: null }
    } as any);
    const refund: any = await this.prisma.refundTransaction.findUnique({
      where: { id: refundId }, include: { payment: true, order: true }
    } as any);
    if (!refund?.payment?.transactionId) throw new AppException("PAYMENT_NOT_FOUND", "Payment not found", HttpStatus.NOT_FOUND);
    if (claimed.count !== 1) {
      return { refund: this.refundDto(refund), order: this.ordersService.toDto(refund.order) };
    }
    try {
      const result = await this.wechat.createRefund({
        transactionId: refund.payment.transactionId, outRefundNo: refund.outRefundNo,
        reason: refund.reason || "用户申请退款", refundAmountCents: refund.amountCents,
        totalAmountCents: refund.order.amountCents, notifyUrl: this.buildRefundNotifyUrl()
      });
      await this.applyRefundResult(refundId, result.status, result.refundId);
    } catch (error) {
      await this.prisma.refundTransaction.updateMany({
        where: { id: refundId, status: "processing" },
        data: {
          failureReason: `Submission outcome unknown: ${error instanceof Error ? error.message.slice(0, 460) : "unknown"}`
        }
      } as any);
      throw error;
    }
    const current: any = await this.prisma.refundTransaction.findUnique({ where: { id: refundId }, include: { order: true } } as any);
    return { refund: this.refundDto(current), order: this.ordersService.toDto(current.order) };
  }

  private async applyRefundResult(refundId: string, providerStatus: string, providerRefundId: string) {
    const success = providerStatus === "SUCCESS";
    const failed = ["CLOSED", "ABNORMAL"].includes(providerStatus);
    const refundRef: any = await this.prisma.refundTransaction.findUnique({
      where: { id: refundId },
      select: { orderId: true }
    } as any);
    if (!refundRef) return;
    const transition = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      // Use Order -> Refund everywhere money and service state intersect. The
      // lock order prevents deadlocks and stale service transitions from
      // overwriting a successful refund.
      await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${refundRef.orderId} FOR UPDATE`;
      await db.$queryRaw`SELECT "id" FROM "RefundTransaction" WHERE "id" = ${refundId} FOR UPDATE`;
      const current = await db.refundTransaction.findUnique({
        where: { id: refundId },
        include: { order: true }
      });
      if (!current) return null;
      if (current.status === "success") {
        return { refund: current, becameSuccess: false };
      }
      if (!success && ["rejected", "pendingReview"].includes(current.status)) {
        return { refund: current, becameSuccess: false };
      }
      const updated = await db.refundTransaction.update({
        where: { id: refundId },
        data: {
          status: success ? "success" : failed ? "failed" : "processing",
          providerRefundId: providerRefundId || current.providerRefundId || null
        },
        include: { order: true }
      });
      if (success) {
        await db.order.update({
          where: { id: current.orderId },
          data: { status: "refunded" }
        });
      }
      return { refund: updated, becameSuccess: success };
    }, { maxWait: 5_000, timeout: 10_000 });
    if (transition?.becameSuccess) {
      await this.audit.record({ actorId: transition.refund.order.userId, action: "refund.succeeded", resourceType: "refund", resourceId: refundId });
      await this.notifications.create(transition.refund.order.userId, "orderStatus", "退款成功", "款项已按原支付路径退回。", { orderId: transition.refund.orderId, refundId, status: "success" });
    }
  }

  private refundDto(refund: any) {
    return {
      id: refund.id, orderId: refund.orderId, outRefundNo: refund.outRefundNo,
      amountCents: refund.amountCents, status: refund.status, reason: refund.reason,
      providerRefundId: refund.providerRefundId, reviewNote: refund.reviewNote,
      failureReason: refund.failureReason, createdAt: refund.createdAt.toISOString(), updatedAt: refund.updatedAt.toISOString()
    };
  }
}
