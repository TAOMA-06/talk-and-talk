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
  WeChatPayProvider,
  WeChatPrepayInput
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

  status() {
    return {
      module: "payments",
      status: this.wechat.mode === "disabled" ? "unavailable" : "active",
      provider: this.wechat.mode,
      productionReady: this.wechat.mode === "real"
    };
  }

  async prepay(userId: string, orderId: string, channel: "app" | "miniProgram" = "app") {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { conversation: { select: { externalId: true } } }
    } as any);

    if (!order || order.userId !== userId) {
      throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
    }

    if (order.status === "paid" || order.status === "inService" || order.status === "completed") {
      throw new AppException(
        "ORDER_INVALID_STATE",
        "Order is already paid",
        HttpStatus.CONFLICT
      );
    }

    if (order.status === "cancelled" || order.status === "refunded") {
      throw new AppException(
        "ORDER_INVALID_STATE",
        "Order cannot be prepaid in current state",
        HttpStatus.CONFLICT
      );
    }

    if (order.status !== "pending" && order.status !== "paying") {
      throw new AppException(
        "ORDER_INVALID_STATE",
        "Order cannot be prepaid in current state",
        HttpStatus.CONFLICT
      );
    }

    const outTradeNo = `T${Date.now()}${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const notifyUrl = this.buildNotifyUrl();

    const input: WeChatPrepayInput = {
      outTradeNo,
      description: `Talk&Talk 陪伴服务 ${order.durationMinutes}分钟`,
      amountCents: order.amountCents,
      notifyUrl
    };
    const prepay = channel === "miniProgram"
      ? await this.wechat.createMiniProgramPrepay({ ...input, openId: await this.findMiniProgramOpenId(userId) })
      : await this.wechat.createAppPrepay(input);

    const payment = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.paymentTransaction.updateMany({
        where: { orderId, status: "initiated" },
        data: { status: "closed" }
      });

      const created = await db.paymentTransaction.create({
        data: {
          orderId,
          outTradeNo,
          provider: "wechat",
          amountCents: order.amountCents,
          status: "initiated",
          prepayId: prepay.prepayId,
          clientParams: prepay.clientParams
        }
      });

      await db.order.update({
        where: { id: orderId },
        data: { status: "paying" }
      });

      return created;
    });

    const refreshed = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { conversation: { select: { externalId: true } } }
    } as any);

    if (!refreshed) {
      throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
    }

    return {
      order: this.ordersService.toDto(refreshed),
      payment: {
        id: payment.id,
        outTradeNo: payment.outTradeNo,
        status: payment.status,
        mock: prepay.mock,
        channel: prepay.channel,
        wechatAppParams: prepay.channel === "app" ? prepay.clientParams : undefined,
        wechatMiniProgramParams: prepay.channel === "miniProgram" ? prepay.clientParams : undefined
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
      const result = await this.fulfillPayment(payload);
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

    return this.fulfillPayment({
      outTradeNo: payment.outTradeNo,
      transactionId: body.transactionId ?? `mock_txn_${payment.outTradeNo}`,
      tradeState: "SUCCESS",
      amountCents,
      raw: JSON.parse(raw)
    });
  }

  async requestRefund(userId: string, orderId: string, reason?: string) {
    const order: any = await this.prisma.order.findUnique({ where: { id: orderId } } as any);
    if (!order || order.userId !== userId) {
      throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
    }
    if (!['paid', 'inService', 'completed'].includes(order.status)) {
      throw new AppException("ORDER_INVALID_STATE", "Order is not eligible for refund", HttpStatus.CONFLICT);
    }
    const payment: any = await this.prisma.paymentTransaction.findFirst({
      where: { orderId, status: "success" }, orderBy: { paidAt: "desc" }
    } as any);
    if (!payment?.transactionId) {
      throw new AppException("PAYMENT_NOT_FOUND", "Successful WeChat payment not found", HttpStatus.NOT_FOUND);
    }
    const existing: any = await this.prisma.refundTransaction.findFirst({
      where: { orderId, status: { in: ["pendingReview", "pending", "processing", "success"] } },
      orderBy: { createdAt: "desc" }
    } as any);
    if (existing) return { refund: this.refundDto(existing), order: this.ordersService.toDto(order) };

    const needsReview = order.status === "inService" || order.status === "completed";
    const refund: any = await this.prisma.refundTransaction.create({
      data: {
        orderId, paymentId: payment.id,
        outRefundNo: `R${Date.now()}${randomUUID().replace(/-/g, "").slice(0, 10)}`,
        amountCents: order.amountCents,
        status: needsReview ? "pendingReview" : "pending",
        reason: reason?.trim() || null
      }
    } as any);
    await this.audit.record({
      actorId: userId, action: "refund.requested", resourceType: "refund", resourceId: refund.id,
      metadata: { orderId, amountCents: order.amountCents, needsReview }
    });
    if (needsReview) {
      await this.notifications.create(userId, "orderStatus", "售后申请待审核", "平台将在审核后通知你处理结果。", { orderId, refundId: refund.id, status: "pendingReview" });
      return { refund: this.refundDto(refund), order: this.ordersService.toDto(order) };
    }
    return this.submitRefundToWechat(refund.id);
  }

  async approveRefund(actorId: string, refundId: string, note?: string) {
    const refund: any = await this.prisma.refundTransaction.findUnique({ where: { id: refundId } } as any);
    if (!refund) throw new AppException("REFUND_NOT_FOUND", "Refund not found", HttpStatus.NOT_FOUND);
    if (refund.status !== "pendingReview") {
      throw new AppException("REFUND_INVALID_STATE", "Refund is not awaiting review", HttpStatus.CONFLICT);
    }
    await this.prisma.refundTransaction.update({
      where: { id: refundId }, data: { status: "pending", reviewedById: actorId, reviewedAt: new Date(), reviewNote: note?.trim() || null }
    } as any);
    await this.audit.record({ actorId, action: "refund.approved", resourceType: "refund", resourceId: refundId });
    return this.submitRefundToWechat(refundId);
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
    const refund: any = await this.prisma.refundTransaction.findUnique({ where: { id: refundId }, include: { order: true } } as any);
    if (!refund) throw new AppException("REFUND_NOT_FOUND", "Refund not found", HttpStatus.NOT_FOUND);
    if (refund.status !== "pendingReview") throw new AppException("REFUND_INVALID_STATE", "Refund is not awaiting review", HttpStatus.CONFLICT);
    const updated: any = await this.prisma.refundTransaction.update({
      where: { id: refundId }, data: { status: "rejected", reviewedById: actorId, reviewedAt: new Date(), reviewNote: note?.trim() || null }
    } as any);
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
    const refund: any = await this.prisma.refundTransaction.findUnique({ where: { outRefundNo: payload.outRefundNo } } as any);
    if (!refund) throw new AppException("REFUND_NOT_FOUND", "Refund not found", HttpStatus.NOT_FOUND);
    await this.applyRefundResult(refund.id, payload.status, payload.refundId);
    return { code: "SUCCESS", message: "成功" };
  }

  private async fulfillPayment(payload: {
    outTradeNo: string;
    transactionId: string;
    tradeState: string;
    amountCents: number;
    raw: Record<string, unknown>;
  }) {
    if (payload.tradeState !== "SUCCESS") {
      throw new AppException(
        "PAYMENT_NOT_SUCCESS",
        `Trade state is ${payload.tradeState}`,
        HttpStatus.BAD_REQUEST
      );
    }

    if (!payload.outTradeNo) {
      throw new AppException("PAYMENT_INVALID", "Missing out_trade_no", HttpStatus.BAD_REQUEST);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const payment = await db.paymentTransaction.findUnique({
        where: { outTradeNo: payload.outTradeNo },
        include: { order: true }
      });

      if (!payment) {
        throw new AppException("PAYMENT_NOT_FOUND", "Payment not found", HttpStatus.NOT_FOUND);
      }

      const order = payment.order;

      if (payload.amountCents !== payment.amountCents || payload.amountCents !== order.amountCents) {
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

      if (!["pending", "paying"].includes(order.status)) {
        // Paid via another path or cancelled — do not re-activate
        if (["paid", "inService", "completed"].includes(order.status)) {
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
    });

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
    const refund: any = await this.prisma.refundTransaction.findUnique({
      where: { id: refundId }, include: { payment: true, order: true }
    } as any);
    if (!refund?.payment?.transactionId) throw new AppException("PAYMENT_NOT_FOUND", "Payment not found", HttpStatus.NOT_FOUND);
    await this.prisma.refundTransaction.update({ where: { id: refundId }, data: { status: "processing", failureReason: null } } as any);
    try {
      const result = await this.wechat.createRefund({
        transactionId: refund.payment.transactionId, outRefundNo: refund.outRefundNo,
        reason: refund.reason || "用户申请退款", refundAmountCents: refund.amountCents,
        totalAmountCents: refund.order.amountCents, notifyUrl: this.buildRefundNotifyUrl()
      });
      await this.applyRefundResult(refundId, result.status, result.refundId);
    } catch (error) {
      await this.prisma.refundTransaction.update({
        where: { id: refundId }, data: { status: "failed", failureReason: error instanceof Error ? error.message.slice(0, 500) : "unknown" }
      } as any);
      throw error;
    }
    const current: any = await this.prisma.refundTransaction.findUnique({ where: { id: refundId }, include: { order: true } } as any);
    return { refund: this.refundDto(current), order: this.ordersService.toDto(current.order) };
  }

  private async applyRefundResult(refundId: string, providerStatus: string, providerRefundId: string) {
    const success = providerStatus === "SUCCESS";
    const failed = ["CLOSED", "ABNORMAL"].includes(providerStatus);
    const refund: any = await this.prisma.refundTransaction.findUnique({ where: { id: refundId }, include: { order: true } } as any);
    if (!refund || refund.status === "success") return;
    await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.refundTransaction.update({
        where: { id: refundId },
        data: { status: success ? "success" : failed ? "failed" : "processing", providerRefundId: providerRefundId || null }
      });
      if (success) await db.order.update({ where: { id: refund.orderId }, data: { status: "refunded" } });
    });
    if (success) {
      await this.audit.record({ actorId: refund.order.userId, action: "refund.succeeded", resourceType: "refund", resourceId: refundId });
      await this.notifications.create(refund.order.userId, "orderStatus", "退款成功", "款项已按原支付路径退回。", { orderId: refund.orderId, refundId, status: "success" });
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
