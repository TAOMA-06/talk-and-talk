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
  WeChatPayProvider
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

  async prepay(userId: string, orderId: string) {
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

    const prepay = await this.wechat.createAppPrepay({
      outTradeNo,
      description: `Talk&Talk 陪伴服务 ${order.durationMinutes}分钟`,
      amountCents: order.amountCents,
      notifyUrl
    });

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
        wechatAppParams: prepay.clientParams
      }
    };
  }

  async handleWechatNotify(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string
  ) {
    try {
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
}
