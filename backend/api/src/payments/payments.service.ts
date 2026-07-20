import { forwardRef, HttpStatus, Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
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

type RefundExceptionContext = {
  actorId: string;
  requestId: string;
  reasonCode: "ACCOUNT_DELETION_SETTLEMENT" | "SUPPORT_APPROVED_AFTER_WINDOW";
};

const MIN_PREPAY_LEAD_MS = 5 * 60 * 1000;
const MIN_PREPAY_USABLE_WINDOW_MS = 60 * 1000;
// Keep a small issuance allowance so the client still receives at least a
// full minute after the WeChat create-order round trip completes.
const PREPAY_ISSUANCE_ALLOWANCE_MS = 25 * 1000;
const FAILED_REFUND_RETRY_BACKOFF_MINUTES = 5;
const INITIAL_REFUND_QUERY_DELAY_MS = 60 * 1000;
const REFUND_QUERY_LEASE_MS = 2 * 60 * 1000;
const REFUND_QUERY_BACKOFF_MS = [
  5 * 60 * 1000,
  10 * 60 * 1000,
  30 * 60 * 1000,
  60 * 60 * 1000,
  2 * 60 * 60 * 1000,
  6 * 60 * 60 * 1000
] as const;

@Injectable()
export class PaymentsService implements OnModuleInit {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(forwardRef(() => OrdersService)) private readonly ordersService: OrdersService,
    @Inject(WECHAT_PAY_PROVIDER) private readonly wechat: WeChatPayProvider,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly metrics: MetricsService
  ) {}

  async onModuleInit(): Promise<void> {
    const provider = this.wechat as WeChatPayProvider & {
      ensurePlatformCertificates?: () => Promise<void>;
    };
    if (this.wechat.mode === "real" && typeof provider.ensurePlatformCertificates === "function") {
      // Prove that the merchant signature can reach WeChat and that a current
      // platform certificate can be decrypted before accepting paid traffic.
      // Callback verification must not discover this dependency for the first
      // time while WeChat is waiting for a response.
      await provider.ensurePlatformCertificates();
    }
  }

  status() {
    return {
      module: "payments",
      status: this.wechat.mode === "disabled" ? "unavailable" : "active",
      provider: this.wechat.mode,
      productionReady: this.wechat.mode === "real"
    };
  }

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
        const hasUsableClientParams = Boolean(existing.prepayId && existing.clientParams);
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
          if (!hasUsableClientParams) {
            // A provider timeout is ambiguous: WeChat may still finish creating
            // this outTradeNo after our socket has closed. Never replace that
            // durable identity merely because client parameters are missing.
            // The expiry reconciliation loop will query and close it safely.
            throw new AppException(
              "PAYMENT_PREPAY_IN_PROGRESS",
              "Payment preparation is being reconciled; retry after the current payment window expires",
              HttpStatus.CONFLICT,
              { expiresAt: expiresAt.toISOString() }
            );
          }
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
      const created = await db.paymentTransaction.create({
        data: {
          orderId,
          outTradeNo,
          provider: "wechat",
          amountCents: order.amountCents,
          status: "initiated",
          prepayId: null,
          clientParams: undefined,
          expiresAt
        }
      });

      const updatedOrder = await db.order.update({
        where: { id: orderId },
        data: { status: "paying" },
        include: { conversation: { select: { externalId: true } } }
      });

      // Commit a durable local identity before the non-transactional WeChat
      // call. A timeout or process crash can then always be reconciled by the
      // stable outTradeNo instead of creating an untracked external order.
      return { order: updatedOrder, payment: created, provision: { input, channel } };
      }, { maxWait: 5_000, timeout: 20_000 });
    } catch (error) {
      for (const remotelyClosedPayment of remotelyClosedPayments) {
        await this.reconcileRemotelyClosedPrepay(remotelyClosedPayment);
      }
      throw error;
    }

    if (result.retryAfterClose) {
      return this.prepay(userId, orderId, channel);
    }

    if (result.provision) {
      let prepay: any;
      let remoteCreated = false;
      try {
        prepay = result.provision.channel === "miniProgram"
          ? await this.wechat.createMiniProgramPrepay({
              ...result.provision.input,
              openId: await this.findMiniProgramOpenId(userId)
            })
          : await this.wechat.createAppPrepay(result.provision.input);
        remoteCreated = true;
        const persisted = await this.prisma.paymentTransaction.updateMany({
          where: {
            id: result.payment.id,
            outTradeNo: result.payment.outTradeNo,
            status: "initiated",
            prepayId: null
          },
          data: { prepayId: prepay.prepayId, clientParams: prepay.clientParams }
        } as any);
        if (persisted.count !== 1) {
          throw new AppException(
            "PAYMENT_STATE_CHANGED",
            "Payment state changed while recording WeChat prepay parameters",
            HttpStatus.CONFLICT
          );
        }
        result.payment = {
          ...result.payment,
          prepayId: prepay.prepayId,
          clientParams: prepay.clientParams
        };
        result.prepay = prepay;
      } catch (error) {
        // Only close when WeChat returned a concrete prepay result. A provider
        // timeout before that point is ambiguous; closing an ORDER_NOT_EXIST
        // response immediately could race a late remote create and orphan it.
        if (remoteCreated) {
          await this.closeReservedPrepayAfterFailure(result.payment);
        }
        throw error;
      }
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
      if (!(await this.verifyWechatNotifySignature(headers, rawBody))) {
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
    if (this.config.getOrThrow<string>("APP_ENV") === "production" || !this.wechat.isMock) {
      throw new AppException(
        "MOCK_PAY_DISABLED",
        "Mock WeChat notify is only available when the mock payment provider is active",
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

  async requestSupportRefund(actorId: string, ticketId: string, reason: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { id: true, userId: true, orderId: true }
    } as any);
    if (!ticket?.orderId) {
      throw new AppException(
        "SUPPORT_TICKET_ORDER_REQUIRED",
        "An order-linked support ticket is required to initiate a refund",
        HttpStatus.CONFLICT
      );
    }
    return this.requestRefund(ticket.userId, ticket.orderId, reason, {
      actorId,
      requestId: ticket.id,
      reasonCode: "SUPPORT_APPROVED_AFTER_WINDOW"
    });
  }

  async requestRefund(
    userId: string,
    orderId: string,
    reason?: string,
    exceptionContext?: RefundExceptionContext
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      const order = await db.order.findUnique({ where: { id: orderId } });
      if (!order || order.userId !== userId) {
        throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
      }
      let supportTicket: any = null;
      if (exceptionContext?.reasonCode === "SUPPORT_APPROVED_AFTER_WINDOW") {
        await db.$queryRaw`SELECT "id" FROM "SupportTicket" WHERE "id" = ${exceptionContext.requestId} FOR UPDATE`;
        supportTicket = await db.supportTicket.findUnique({ where: { id: exceptionContext.requestId } });
        if (
          !supportTicket ||
          supportTicket.orderId !== orderId ||
          supportTicket.userId !== userId ||
          !["open", "inProgress"].includes(supportTicket.status) ||
          supportTicket.assignedToUserId !== exceptionContext.actorId
        ) {
          throw new AppException(
            "SUPPORT_TICKET_ASSIGNEE_REQUIRED",
            "The active assignee of this order-linked ticket must initiate the refund",
            HttpStatus.FORBIDDEN
          );
        }
      }
      const existing = await db.refundTransaction.findFirst({
        where: {
          orderId,
          status: { in: ["pendingReview", "pending", "processing", "success", "failed"] }
        },
        orderBy: { createdAt: "asc" }
      });
      if (existing) {
        if (["pendingReview", "pending", "processing", "failed"].includes(existing.status)) {
          await this.holdEarningForRefund(db, orderId);
        }
        return { order, refund: existing, created: false };
      }
      if (!["paid", "inService", "completed"].includes(order.status)) {
        throw new AppException("ORDER_INVALID_STATE", "Order is not eligible for refund", HttpStatus.CONFLICT);
      }
      if (order.status === "completed" && !exceptionContext) {
        const refundWindowHours = this.config.get<number>("REFUND_REQUEST_WINDOW_HOURS") ?? 72;
        const deadline = order.refundRequestDeadlineAt ?? (
          order.completedAt
            ? new Date(order.completedAt.getTime() + refundWindowHours * 60 * 60_000)
            : null
        );
        if (!deadline || deadline.getTime() <= Date.now()) {
          throw new AppException(
            "REFUND_REQUEST_WINDOW_CLOSED",
            "The self-service refund request window has closed; contact support for a dispute review",
            HttpStatus.CONFLICT,
            { refundRequestDeadlineAt: deadline?.toISOString() ?? null }
          );
        }
      }
      const payment = await db.paymentTransaction.findFirst({
        where: { orderId, status: "success" },
        orderBy: { paidAt: "desc" }
      });
      if (!payment?.transactionId) {
        throw new AppException("PAYMENT_NOT_FOUND", "Successful WeChat payment not found", HttpStatus.NOT_FOUND);
      }
      await db.$queryRaw`SELECT "id" FROM "PaymentTransaction" WHERE "id" = ${payment.id} FOR UPDATE`;

      const needsReview = exceptionContext?.reasonCode === "SUPPORT_APPROVED_AFTER_WINDOW" ||
        order.status === "inService" || order.status === "completed";
      const refund = await db.refundTransaction.create({
        data: {
          orderId,
          paymentId: payment.id,
          outRefundNo: `R${Date.now()}${randomUUID().replace(/-/g, "").slice(0, 10)}`,
          amountCents: order.amountCents,
          status: needsReview ? "pendingReview" : "pending",
          reason: reason?.trim() || null,
          initiatedById: exceptionContext?.actorId ?? userId,
          supportTicketId: supportTicket?.id ?? null,
          exceptionReasonCode: exceptionContext?.reasonCode ?? null
        }
      });
      await this.holdEarningForRefund(db, orderId);
      await this.audit.record({
        actorId: exceptionContext?.actorId ?? userId,
        action: "refund.requested",
        resourceType: "refund",
        resourceId: refund.id,
        metadata: {
          orderId,
          amountCents: order.amountCents,
          needsReview,
          requestedForUserId: userId,
          exceptionReasonCode: exceptionContext?.reasonCode ?? null,
          supportTicketId: supportTicket?.id ?? null
        }
      }, db);
      if (needsReview) {
        await this.enqueueTransactionalNotification(db, {
          userId,
          type: "orderStatus",
          title: "售后申请待审核",
          body: "平台将在审核后通知你处理结果。",
          data: { orderId, refundId: refund.id, status: "pendingReview" },
          eventKey: `refund:${refund.id}:pending-review`,
          templateKey: "supportUpdate"
        });
      }
      if (exceptionContext?.reasonCode === "ACCOUNT_DELETION_SETTLEMENT") {
        await this.audit.record({
          actorId: exceptionContext.actorId,
          action: "account.deletion_refund_initiated",
          resourceType: "accountDeletionRequest",
          resourceId: exceptionContext.requestId,
          metadata: {
            userId,
            orderId,
            refundId: refund.id,
            amountCents: order.amountCents,
            reasonCode: "ACCOUNT_DELETION_SETTLEMENT"
          }
        }, db);
      }
      if (exceptionContext?.reasonCode === "SUPPORT_APPROVED_AFTER_WINDOW") {
        await this.audit.record({
          actorId: exceptionContext.actorId,
          action: "support.refund_initiated",
          resourceType: "supportTicket",
          resourceId: exceptionContext.requestId,
          metadata: { userId, orderId, refundId: refund.id, amountCents: order.amountCents }
        }, db);
      }
      return { order, refund, created: true };
    }, { maxWait: 5_000, timeout: 10_000 });

    const needsReview = result.refund.status === "pendingReview";
    if (needsReview) {
      return {
        refund: this.refundDto(result.refund),
        order: this.ordersService.toDto(result.order),
        created: result.created
      };
    }
    if (["processing", "success", "failed"].includes(result.refund.status)) {
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
        if (refund.initiatedById && refund.initiatedById === actorId) {
          throw new AppException(
            "REFUND_SECOND_REVIEW_REQUIRED",
            "A different administrator must review a staff-initiated refund",
            HttpStatus.FORBIDDEN
          );
        }
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
        await this.audit.record({
          actorId,
          action: "refund.approved",
          resourceType: "refund",
          resourceId: refundId
        }, db);
        return { refund: updated, newlyApproved: true, shouldSubmit: true };
      }

      // An approval is idempotent after the winning reviewer commits. Retrying
      // a still-pending submission reuses the same outRefundNo and closes the
      // crash window after approval. An explicit provider failure must use the
      // separately audited admin retry action below.
      if (refund.reviewedAt && ["pending", "failed", "processing", "success"].includes(refund.status)) {
        return {
          refund,
          newlyApproved: false,
          shouldSubmit: refund.status === "pending"
        };
      }
      throw new AppException("REFUND_INVALID_STATE", "Refund is not awaiting review", HttpStatus.CONFLICT);
    }, { maxWait: 5_000, timeout: 10_000 });

    if (decision.shouldSubmit) return this.submitRefundToWechat(refundId);
    return {
      refund: this.refundDto(decision.refund),
      order: this.ordersService.toDto(decision.refund.order)
    };
  }

  async listRefundsAwaitingReview() {
    const now = Date.now();
    const items: any[] = await this.prisma.refundTransaction.findMany({
      where: {
        OR: [
          { status: { in: ["pendingReview", "failed"] } },
          { status: "pending", updatedAt: { lt: new Date(now - 15 * 60_000) } },
          { status: "processing", nextReconcileAt: { lt: new Date(now - 15 * 60_000) } },
          { status: "processing", createdAt: { lt: new Date(now - 24 * 60 * 60_000) } }
        ]
      },
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
        paymentOutTradeNo: item.payment.outTradeNo,
        initiatedById: item.initiatedById ?? null,
        supportTicketId: item.supportTicketId ?? null,
        exceptionReasonCode: item.exceptionReasonCode ?? null
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
      if (current.initiatedById && current.initiatedById === actorId) {
        throw new AppException(
          "REFUND_SECOND_REVIEW_REQUIRED",
          "A different administrator must review a staff-initiated refund",
          HttpStatus.FORBIDDEN
        );
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
      await this.audit.record({
        actorId,
        action: "refund.rejected",
        resourceType: "refund",
        resourceId: refundId,
        metadata: { note: note?.trim() || null }
      }, db);
      await this.enqueueTransactionalNotification(db, {
        userId: current.order.userId,
        type: "orderStatus",
        title: "售后申请未通过",
        body: note?.trim() || "本次退款申请未通过审核。",
        data: { orderId: current.orderId, refundId, status: "rejected" },
        eventKey: `refund:${refundId}:rejected`,
        templateKey: "supportUpdate"
      });
      return { refund: current, updated: rejected };
    }, { maxWait: 5_000, timeout: 10_000 });
    return { refund: this.refundDto(updated), order: this.ordersService.toDto(refund.order) };
  }

  async retryRefund(actorId: string, refundId: string, note?: string) {
    const refund = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "RefundTransaction" WHERE "id" = ${refundId} FOR UPDATE`;
      const current = await db.refundTransaction.findUnique({
        where: { id: refundId },
        include: { order: true }
      });
      if (!current) throw new AppException("REFUND_NOT_FOUND", "Refund not found", HttpStatus.NOT_FOUND);
      if (current.status !== "failed") {
        throw new AppException("REFUND_INVALID_STATE", "Only a failed refund can be retried", HttpStatus.CONFLICT);
      }
      const updated = await db.refundTransaction.update({
        where: { id: refundId },
        data: {
          status: "pending",
          failureReason: null,
          reviewNote: note?.trim() || current.reviewNote
        },
        include: { order: true }
      });
      await this.holdEarningForRefund(db, current.orderId);
      await this.audit.record({
        actorId,
        action: "refund.retry_requested",
        resourceType: "refund",
        resourceId: refundId,
        metadata: { note: note?.trim() || null }
      }, db);
      return updated;
    }, { maxWait: 5_000, timeout: 10_000 });
    return this.submitRefundToWechat(refund.id);
  }

  async syncRefund(userId: string, orderId: string) {
    const refund: any = await this.prisma.refundTransaction.findFirst({
      where: { orderId, order: { userId } }, orderBy: { createdAt: "desc" }
    } as any);
    if (!refund) throw new AppException("REFUND_NOT_FOUND", "Refund not found", HttpStatus.NOT_FOUND);
    if (["processing", "pending"].includes(refund.status)) {
      const result = await this.wechat.queryRefund(refund.outRefundNo);
      this.assertRefundQueryBinding(refund, result.outRefundNo);
      await this.applyQueriedRefundResult(refund, result.status, result.refundId);
    }
    const current: any = await this.prisma.refundTransaction.findUnique({ where: { id: refund.id }, include: { order: true } } as any);
    return { refund: this.refundDto(current), order: this.ordersService.toDto(current.order) };
  }

  async syncRefundForAdmin(actorId: string, refundId: string) {
    const refund: any = await this.prisma.refundTransaction.findUnique({
      where: { id: refundId },
      include: { order: true }
    } as any);
    if (!refund) throw new AppException("REFUND_NOT_FOUND", "Refund not found", HttpStatus.NOT_FOUND);
    if (!["pending", "processing", "failed", "success"].includes(refund.status)) {
      throw new AppException(
        "REFUND_INVALID_STATE",
        "Only a submitted refund can be reconciled with WeChat",
        HttpStatus.CONFLICT
      );
    }
    if (refund.status !== "success") {
      await this.audit.record({
        actorId,
        action: "refund.provider_sync_requested",
        resourceType: "refund",
        resourceId: refundId,
        metadata: { previousStatus: refund.status, outRefundNo: refund.outRefundNo }
      });
      const result = await this.wechat.queryRefund(refund.outRefundNo);
      this.assertRefundQueryBinding(refund, result.outRefundNo);
      await this.applyQueriedRefundResult(refund, result.status, result.refundId);
    }
    const current: any = await this.prisma.refundTransaction.findUnique({
      where: { id: refund.id },
      include: { order: true }
    } as any);
    return { refund: this.refundDto(current), order: this.ordersService.toDto(current.order) };
  }

  /**
   * Durable refund recovery. A pending row is an already-authorized provider
   * submission that did not start before a crash. A processing row is queried
   * first; only an authoritative NOTEXIST result is reset and resubmitted with
   * the exact same outRefundNo and financial parameters.
   */
  async reconcileStaleRefunds(limit = 50): Promise<{
    scanned: number;
    submissions: number;
    queries: number;
    failures: number;
  }> {
    const safeLimit = Math.min(Math.max(Math.floor(limit) || 1, 1), 200);
    const now = new Date();
    const pendingCutoff = new Date(now.getTime() - INITIAL_REFUND_QUERY_DELAY_MS);
    const pending: Array<{ id: string }> = await this.prisma.refundTransaction.findMany({
      where: { status: "pending", updatedAt: { lte: pendingCutoff } },
      select: { id: true },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: safeLimit
    } as any);
    let submissions = 0;
    let queries = 0;
    let failures = 0;
    for (const item of pending ?? []) {
      try {
        await this.submitRefundToWechat(item.id);
        submissions += 1;
      } catch (error) {
        failures += 1;
        this.logger.error(
          `Failed to resume pending refund ${item.id} (${error instanceof Error ? error.name : "unknown_error"})`
        );
      }
    }

    const remaining = Math.max(0, safeLimit - (pending?.length ?? 0));
    const processing: Array<{
      id: string;
      outRefundNo: string;
      status: string;
      nextReconcileAt: Date | null;
    }> = remaining > 0
      ? await this.prisma.refundTransaction.findMany({
          where: { status: "processing", nextReconcileAt: { lte: now } },
          select: { id: true, outRefundNo: true, status: true, nextReconcileAt: true },
          orderBy: [{ nextReconcileAt: "asc" }, { id: "asc" }],
          take: remaining
        } as any)
      : [];
    for (const item of processing ?? []) {
      if (!item.nextReconcileAt) continue;
      let reconciliationStage: "query" | "binding" | "apply" = "query";
      try {
        // Claim this query window with a compare-and-swap. Another API replica
        // sees the lease in the database and cannot issue the same provider
        // query or resubmit the same refund concurrently.
        const leaseUntil = new Date(Date.now() + REFUND_QUERY_LEASE_MS);
        const lease = await this.prisma.refundTransaction.updateMany({
          where: {
            id: item.id,
            status: "processing",
            nextReconcileAt: item.nextReconcileAt
          },
          data: { nextReconcileAt: leaseUntil }
        } as any);
        if (lease.count !== 1) continue;
        const claimed: any = await this.prisma.refundTransaction.findUnique({
          where: { id: item.id },
          select: {
            id: true,
            outRefundNo: true,
            status: true,
            updatedAt: true,
            providerQueryAttempts: true
          }
        } as any);
        if (!claimed || claimed.status !== "processing") continue;
        queries += 1;
        const result = await this.wechat.queryRefund(claimed.outRefundNo);
        reconciliationStage = "binding";
        this.assertRefundQueryBinding(claimed, result.outRefundNo);
        reconciliationStage = "apply";
        const applied = await this.applyQueriedRefundResult(claimed, result.status, result.refundId);
        if (applied.resubmitted) submissions += 1;
      } catch (error) {
        failures += 1;
        // Query and binding failures have no later helper state to preserve, so
        // persist both the evidence and the next backoff. An apply/resubmission
        // failure may already have written the more precise "outcome unknown"
        // state and must not be overwritten here.
        if (reconciliationStage !== "apply") {
          const current: any = await this.prisma.refundTransaction.findUnique({
            where: { id: item.id },
            select: { status: true, providerQueryAttempts: true }
          } as any);
          if (current?.status === "processing") {
            const attempts = Number(current.providerQueryAttempts ?? 0) + 1;
            await this.prisma.refundTransaction.updateMany({
              where: { id: item.id, status: "processing" },
              data: {
                providerQueryAttempts: attempts,
                nextReconcileAt: this.nextRefundQueryAt(attempts),
                failureReason: reconciliationStage === "binding"
                  ? `Reconciliation response binding rejected: ${error instanceof Error ? error.name : "unknown_error"}`
                  : `Reconciliation query failed: ${error instanceof Error ? error.name : "unknown_error"}`
              }
            } as any);
          }
        }
        this.logger.error(
          `Failed to reconcile processing refund ${item.id} (${error instanceof Error ? error.name : "unknown_error"})`
        );
      }
    }
    return {
      scanned: (pending?.length ?? 0) + (processing?.length ?? 0),
      submissions,
      queries,
      failures
    };
  }

  async handleWechatRefundNotify(headers: Record<string, string | string[] | undefined>, rawBody: string) {
    if (!(await this.verifyWechatNotifySignature(headers, rawBody))) {
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
            content: "订单已支付，平台内沟通已开启。请在平台内完成服务，勿交换私人联系方式。",
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
          conversationId: conversation.id,
          paymentReservationExpiresAt: null
        }
      });

      await db.conversation.update({
        where: { id: conversation.id },
        data: { updatedAt: paidAt }
      });

      await this.enqueueTransactionalNotification(db, {
        userId: order.userId,
        type: "paymentSuccess",
        title: "支付成功",
        body: "订单已支付，平台内沟通已开启。",
        data: { orderId: order.id, status: "paid" },
        eventKey: `payment:${payment.id}:succeeded`,
        templateKey: "paymentSuccess"
      });
      await this.audit.record({
        actorId: order.userId,
        action: "payment.fulfilled",
        resourceType: "order",
        resourceId: order.id,
        metadata: {
          paymentId: payment.id,
          amountCents: order.amountCents,
          outTradeNo: payload.outTradeNo
        }
      }, db);

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

  private async verifyWechatNotifySignature(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string
  ): Promise<boolean> {
    const provider = this.wechat as WeChatPayProvider & {
      verifyNotifySignatureAsync?: (
        callbackHeaders: Record<string, string | string[] | undefined>,
        callbackBody: string
      ) => Promise<boolean>;
      ensurePlatformCertificates?: () => Promise<void>;
    };
    if (typeof provider.verifyNotifySignatureAsync === "function") {
      return provider.verifyNotifySignatureAsync(headers, rawBody);
    }
    if (typeof provider.ensurePlatformCertificates === "function") {
      await provider.ensurePlatformCertificates();
    }
    return provider.verifyNotifySignature(headers, rawBody);
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
    if (
      order.paymentReservationExpiresAt instanceof Date &&
      order.paymentReservationExpiresAt.getTime() <= Date.now()
    ) {
      throw new AppException(
        "ORDER_RESERVATION_EXPIRED",
        "The companion confirmation reservation has expired; ask the companion to confirm again",
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

      if (candidate.companionConfirmedAt) {
        const reservationExpiresAt = candidate.paymentReservationExpiresAt as Date | null;
        if (!reservationExpiresAt || reservationExpiresAt.getTime() > Date.now()) {
          this.throwCompanionSlotUnavailable();
        }
        await db.order.updateMany({
          where: {
            id: candidate.id,
            status: "pending",
            companionConfirmedAt: { not: null },
            paymentReservationExpiresAt: { lte: new Date() }
          },
          data: { companionConfirmedAt: null, paymentReservationExpiresAt: null }
        });
      }

      const activePayment = candidate.payments.find((payment: any) => payment.status === "initiated");
      if (!activePayment) {
        if (candidate.status === "paying") {
          await db.order.update({
            where: { id: candidate.id },
            data: {
              status: "pending",
              companionConfirmedAt: null,
              paymentReservationExpiresAt: null
            }
          });
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
        await db.order.update({
          where: { id: candidate.id },
          data: {
            status: "pending",
            companionConfirmedAt: null,
            paymentReservationExpiresAt: null
          }
        });
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

  private async closeReservedPrepayAfterFailure(payment: {
    id: string;
    outTradeNo: string;
    orderId: string;
  }): Promise<void> {
    try {
      const current: any = await this.prisma.paymentTransaction.findUnique({
        where: { id: payment.id },
        select: { status: true }
      } as any);
      if (current && current.status !== "initiated") return;
    } catch {
      // Continue with the close attempt when local state is temporarily
      // unreadable. The durable reservation can be reconciled later.
    }
    try {
      await this.wechat.closePayment(payment.outTradeNo);
      await this.reconcileRemotelyClosedPrepay(payment);
    } catch {
      // Keep the initiated reservation visible. A retry or the reconciliation
      // worker can query/close it without ever losing the outTradeNo binding.
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

  /**
   * Recover the crash window between committing the local payment identity and
   * persisting WeChat's client parameters. Only authoritative provider state
   * may turn an expired initiated row into success or closed; local time alone
   * never assumes that an ambiguous remote create failed.
   */
  async reconcileExpiredPrepays(limit = 50): Promise<{
    scanned: number;
    paidRecovered: number;
    closed: number;
    failures: number;
  }> {
    const safeLimit = Math.min(Math.max(Math.floor(limit) || 1, 1), 200);
    const now = new Date();
    const legacyCutoff = new Date(now.getTime() - WECHAT_PREPAY_TTL_MS);
    const candidates: Array<{ id: string; outTradeNo: string; orderId: string }> =
      await this.prisma.paymentTransaction.findMany({
        where: {
          status: "initiated",
          OR: [
            { expiresAt: { lte: now } },
            { expiresAt: null, createdAt: { lte: legacyCutoff } }
          ]
        },
        select: { id: true, outTradeNo: true, orderId: true },
        orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        take: safeLimit
      } as any);

    let paidRecovered = 0;
    let closed = 0;
    let failures = 0;
    for (const candidate of candidates ?? []) {
      try {
        const payload = await this.wechat.queryPayment(candidate.outTradeNo);
        if (payload.outTradeNo !== candidate.outTradeNo) {
          throw new AppException(
            "PAYMENT_TRANSACTION_MISMATCH",
            "WeChat reconciliation result does not match the local payment",
            HttpStatus.BAD_GATEWAY
          );
        }
        if (payload.tradeState === "SUCCESS") {
          this.validateWechatCallbackIdentity(payload, true);
          if (payload.currency !== "CNY") {
            throw new AppException(
              "PAYMENT_CURRENCY_MISMATCH",
              "WeChat payment currency must be CNY",
              HttpStatus.BAD_GATEWAY
            );
          }
          await this.fulfillPayment(payload);
          await this.refundIfServiceWindowExpired(candidate.orderId);
          paidRecovered += 1;
          continue;
        }
        if (payload.tradeState === "REFUND") {
          throw new AppException(
            "PAYMENT_RECONCILIATION_MANUAL_REVIEW",
            "WeChat reports a refunded payment that was never confirmed locally",
            HttpStatus.CONFLICT
          );
        }

        // At authoritative local expiry, closing is safe and idempotent. If a
        // payment won the race, WeChat rejects the close and this row remains
        // initiated for the next query/callback rather than being lost.
        await this.wechat.closePayment(candidate.outTradeNo);
        await this.reconcileRemotelyClosedPrepay(candidate);
        closed += 1;
      } catch (error) {
        failures += 1;
        this.logger.error(
          `Failed to reconcile expired prepay ${candidate.id} (${error instanceof Error ? error.name : "unknown_error"})`
        );
      }
    }
    return { scanned: candidates?.length ?? 0, paidRecovered, closed, failures };
  }

  /**
   * Database-driven reconciliation means no scheduled work is lost on a
   * process restart: every due paid order remains eligible until a guarded
   * refund transaction is created or successfully completed.
   */
  async reconcileExpiredServiceWindows(limit = 50): Promise<{
    scanned: number;
    refundAttempts: number;
    failures: number;
  }> {
    const safeLimit = Math.min(Math.max(Math.floor(limit) || 1, 1), 200);
    const candidates: Array<{ id: string }> = await this.prisma.$queryRaw`
      SELECT candidate."id"
      FROM "Order" AS candidate
      WHERE candidate."status" = 'paid'
        AND candidate."scheduledAt" + candidate."durationMinutes" * INTERVAL '1 minute' <= NOW()
        AND NOT EXISTS (
          SELECT 1
          FROM "RefundTransaction" AS refund
          WHERE refund."orderId" = candidate."id"
            AND refund."status" = 'failed'
            AND refund."updatedAt" > NOW() - ${FAILED_REFUND_RETRY_BACKOFF_MINUTES} * INTERVAL '1 minute'
        )
      ORDER BY candidate."scheduledAt" ASC, candidate."id" ASC
      LIMIT ${safeLimit}
    `;

    let refundAttempts = 0;
    let failures = 0;
    for (const candidate of candidates ?? []) {
      try {
        if (await this.refundIfServiceWindowExpired(candidate.id)) refundAttempts += 1;
      } catch (error) {
        failures += 1;
        this.logger.error(
          `Failed to reconcile expired service order ${candidate.id} (${error instanceof Error ? error.name : "unknown_error"})`
        );
      }
    }
    return { scanned: candidates?.length ?? 0, refundAttempts, failures };
  }

  private async refundIfServiceWindowExpired(orderId: string): Promise<boolean> {
    const order: any = await this.prisma.order.findUnique({ where: { id: orderId } } as any);
    if (!order || order.status !== "paid" || !(order.scheduledAt instanceof Date)) return false;
    const scheduledEnd = order.scheduledAt.getTime() + order.durationMinutes * 60_000;
    if (Date.now() < scheduledEnd) return false;
    await this.requestRefund(
      order.userId,
      order.id,
      "支付回调到达时预约服务窗口已结束，系统自动原路退款"
    );
    return true;
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
      where: { id: refundId, status: "pending" },
      data: {
        status: "processing",
        failureReason: null,
        providerQueryAttempts: 0,
        nextReconcileAt: this.nextRefundQueryAt(0)
      }
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
          failureReason: `Submission outcome unknown: ${error instanceof Error ? error.message.slice(0, 460) : "unknown"}`,
          nextReconcileAt: this.nextRefundQueryAt(0)
        }
      } as any);
      throw error;
    }
    const current: any = await this.prisma.refundTransaction.findUnique({ where: { id: refundId }, include: { order: true } } as any);
    return { refund: this.refundDto(current), order: this.ordersService.toDto(current.order) };
  }

  private async applyRefundResult(
    refundId: string,
    providerStatus: string,
    providerRefundId: string,
    fromQuery = false
  ) {
    const success = providerStatus === "SUCCESS";
    const failed = ["CLOSED", "ABNORMAL"].includes(providerStatus);
    const refundRef: any = await this.prisma.refundTransaction.findUnique({
      where: { id: refundId },
      select: { orderId: true }
    } as any);
    if (!refundRef) return;
    await this.prisma.$transaction(async (tx) => {
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
      const providerQueryAttempts = Number(current.providerQueryAttempts ?? 0) + (fromQuery ? 1 : 0);
      const updated = await db.refundTransaction.update({
        where: { id: refundId },
        data: {
          status: success ? "success" : failed ? "failed" : "processing",
          providerRefundId: providerRefundId || current.providerRefundId || null,
          providerQueryAttempts,
          nextReconcileAt: success || failed ? null : this.nextRefundQueryAt(providerQueryAttempts),
          failureReason: success
            ? null
            : failed
              ? `Provider reported ${providerStatus}`
              : null
        },
        include: { order: true }
      });
      if (success) {
        await db.order.update({
          where: { id: current.orderId },
          data: { status: "refunded" }
        });
        const recovery = await this.voidEarningForRefund(db, current.orderId, refundId);
        await this.enqueueTransactionalNotification(db, {
          userId: current.order.userId,
          type: "orderStatus",
          title: "退款成功",
          body: "款项已按原支付路径退回。",
          data: { orderId: current.orderId, refundId, status: "success" },
          eventKey: `refund:${refundId}:succeeded`,
          templateKey: "supportUpdate"
        });
        await this.audit.record({
          actorId: current.order.userId,
          action: "refund.succeeded",
          resourceType: "refund",
          resourceId: refundId,
          metadata: {
            orderId: current.orderId,
            amountCents: current.amountCents,
            recoveryId: recovery?.id ?? null,
            companionRecoveryCents: recovery?.amountCents ?? null,
            companionRecoveryReason: recovery?.reason ?? null
          }
        }, db);
      }
      return { refund: updated, becameSuccess: success };
    }, { maxWait: 5_000, timeout: 10_000 });
  }

  private async applyQueriedRefundResult(
    refund: {
      id: string;
      outRefundNo: string;
      status: string;
      updatedAt?: Date;
    },
    providerStatus: string,
    providerRefundId: string
  ): Promise<{ resubmitted: boolean }> {
    if (providerStatus !== "NOTEXIST") {
      await this.applyRefundResult(refund.id, providerStatus, providerRefundId, true);
      return { resubmitted: false };
    }

    if (refund.status === "pending") {
      await this.submitRefundToWechat(refund.id);
      return { resubmitted: true };
    }
    if (refund.status === "processing") {
      const reset = await this.prisma.refundTransaction.updateMany({
        where: {
          id: refund.id,
          status: "processing",
          ...(refund.updatedAt ? { updatedAt: refund.updatedAt } : {})
        },
        data: {
          status: "pending",
          providerQueryAttempts: 0,
          nextReconcileAt: null,
          failureReason: "Provider query confirmed refund does not exist; resubmitting the original refund reference"
        }
      } as any);
      if (reset.count === 1) {
        await this.submitRefundToWechat(refund.id);
        return { resubmitted: true };
      }
      return { resubmitted: false };
    }

    // A provider failure that was already made explicit still requires the
    // separately audited administrator retry action. A sync must not bypass
    // that financial control merely because the provider now reports absent.
    if (refund.status === "failed") {
      await this.prisma.refundTransaction.updateMany({
        where: { id: refund.id, status: "failed" },
        data: {
          nextReconcileAt: null,
          failureReason: "Provider confirms refund does not exist; explicit audited retry is required"
        }
      } as any);
    }
    return { resubmitted: false };
  }

  private nextRefundQueryAt(queryAttempts: number): Date {
    if (queryAttempts <= 0) {
      return new Date(Date.now() + INITIAL_REFUND_QUERY_DELAY_MS);
    }
    const index = Math.min(queryAttempts - 1, REFUND_QUERY_BACKOFF_MS.length - 1);
    return new Date(Date.now() + REFUND_QUERY_BACKOFF_MS[index]);
  }

  private refundDto(refund: any) {
    return {
      id: refund.id, orderId: refund.orderId, outRefundNo: refund.outRefundNo,
      amountCents: refund.amountCents, status: refund.status, reason: refund.reason,
      providerRefundId: refund.providerRefundId, reviewNote: refund.reviewNote,
      failureReason: refund.failureReason,
      providerQueryAttempts: Number(refund.providerQueryAttempts ?? 0),
      nextReconcileAt: refund.nextReconcileAt?.toISOString?.() ?? null,
      createdAt: refund.createdAt.toISOString(), updatedAt: refund.updatedAt.toISOString()
    };
  }

  private assertRefundQueryBinding(refund: { outRefundNo: string }, providerOutRefundNo: string): void {
    if (!providerOutRefundNo || providerOutRefundNo !== refund.outRefundNo) {
      throw new AppException(
        "REFUND_BINDING_MISMATCH",
        "WeChat refund query result does not match the local refund",
        HttpStatus.BAD_GATEWAY
      );
    }
  }

  private async enqueueTransactionalNotification(
    db: any,
    input: Parameters<NotificationsService["createTransactional"]>[1]
  ) {
    const transactional = (this.notifications as any).createTransactional;
    if (typeof transactional === "function") {
      return transactional.call(this.notifications, db, input);
    }
    // Test doubles created before the delivery-outbox rollout retain the
    // legacy create surface; real application wiring always takes the path
    // above and persists the delivery intent with the payment transaction.
    return this.notifications.create(input.userId, input.type, input.title, input.body, input.data);
  }

  private async holdEarningForRefund(db: any, orderId: string) {
    if (!db.companionEarning?.updateMany) return;
    await db.companionEarning.updateMany({
      where: { orderId, status: { in: ["pending", "available", "held"] } },
      data: { status: "held", holdReason: "refund_in_progress" }
    });
  }

  private async voidEarningForRefund(db: any, orderId: string, refundId: string) {
    if (!db.companionEarning?.findUnique || !db.companionEarning?.updateMany) return null;
    const earning = await db.companionEarning.findUnique({ where: { orderId } });
    if (!earning) return null;
    const confirmedPaid = earning.status === "paid" || Boolean(earning.paidReference);
    const payoutStateUncertain = Boolean(earning.payoutSubmittedAt && earning.payoutSubmittedById);
    if (confirmedPaid || payoutStateUncertain) {
      if (!db.companionRecovery?.upsert) return null;
      return db.companionRecovery.upsert({
        where: { refundId },
        create: {
          refundId,
          earningId: earning.id,
          companionId: earning.companionId,
          amountCents: earning.payableCents,
          status: "due",
          reason: confirmedPaid ? "confirmedPaidBeforeRefund" : "payoutStateUncertain"
        },
        update: {}
      });
    }
    await db.companionEarning.updateMany({
      where: { orderId, status: { in: ["pending", "available", "held"] } },
      data: { status: "void", holdReason: "refund_succeeded" }
    });
    return null;
  }
}
