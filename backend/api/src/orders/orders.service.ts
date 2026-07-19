import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import {
  WECHAT_PAY_PROVIDER,
  WECHAT_PREPAY_TTL_MS,
  WeChatPayProvider
} from "../payments/wechat/wechat-pay.provider";
import { CreateOrderDto } from "./dto/create-order.dto";

const SERVICE_EARLY_START_MS = 15 * 60 * 1000;

type OrderRecord = {
  id: string;
  userId: string;
  companionId: string;
  themeId: string;
  durationMinutes: number;
  amountCents: number;
  currency: string;
  status: string;
  scheduledAt: Date;
  companionNameSnapshot: string;
  companionRoleSnapshot: string;
  companionInitialsSnapshot: string;
  themeNameSnapshot: string;
  conversationId: string | null;
  companionConfirmedAt: Date | null;
  paidAt: Date | null;
  cancelledAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  conversation?: { externalId: string } | null;
  user?: { profile: { displayName: string | null } | null };
  refunds?: any[];
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Inject(WECHAT_PAY_PROVIDER) private readonly wechat: WeChatPayProvider
  ) {}

  async create(userId: string, dto: CreateOrderDto) {
    const durationMinutes = dto.durationMinutes;
    if (durationMinutes % 30 !== 0) {
      throw new AppException(
        "INVALID_DURATION",
        "durationMinutes must be a multiple of 30",
        HttpStatus.BAD_REQUEST
      );
    }

    const companion = await this.prisma.companionProfile.findFirst({
      where: {
        id: dto.companionId,
        isPublished: true,
        isVerified: true,
        ownerUserId: { not: null },
        owner: { accountStatus: "active", profile: { isVerified: true } }
      }
    } as any);

    if (!companion) {
      throw new AppException("COMPANION_NOT_FOUND", "Companion not found", HttpStatus.NOT_FOUND);
    }

    const units = Math.max(1, Math.ceil(durationMinutes / 30));
    const amountCents = companion.pricePerHalfHour * units * 100;
    const scheduledAt = new Date(dto.scheduledAt);
    if (scheduledAt.getTime() <= Date.now()) {
      throw new AppException("INVALID_SCHEDULE", "scheduledAt must be in the future", HttpStatus.BAD_REQUEST);
    }

    const order = await this.prisma.order.create({
      data: {
        userId,
        companionId: companion.id,
        themeId: dto.themeId,
        durationMinutes,
        amountCents,
        currency: "CNY",
        status: "pending",
        scheduledAt,
        companionNameSnapshot: companion.name,
        companionRoleSnapshot: companion.role,
        companionInitialsSnapshot: companion.initials,
        themeNameSnapshot: this.themeName(dto.themeId)
      }
    } as any);

    return this.toDto(order);
  }

  async list(userId: string) {
    const orders = await this.prisma.order.findMany({
      where: { userId },
      include: { conversation: { select: { externalId: true } }, refunds: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { createdAt: "desc" }
    } as any);

    return {
      items: orders.map((order: OrderRecord) => this.toDto(order))
    };
  }

  async listForCompanion(userId: string) {
    const companion = await this.prisma.companionProfile.findUnique({
      where: { ownerUserId: userId }
    } as any);
    if (!companion) {
      return { items: [] };
    }
    const orders = await this.prisma.order.findMany({
      where: { companionId: companion.id },
      include: {
        conversation: { select: { externalId: true } },
        user: { select: { profile: { select: { displayName: true } } } }
      },
      orderBy: { scheduledAt: "asc" }
    } as any);
    return { items: orders.map((order: OrderRecord) => this.toDto(order)) };
  }

  async startService(userId: string, orderId: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      const order = await db.order.findUnique({
        where: { id: orderId },
        include: {
          companion: { select: { ownerUserId: true } },
          conversation: { select: { externalId: true } }
        }
      });
      if (!order || order.companion.ownerUserId !== userId) {
        throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
      }
      if (order.status !== "paid") {
        throw new AppException("ORDER_INVALID_STATE", "Only paid orders can start", HttpStatus.CONFLICT);
      }
      const activeRefund = await db.refundTransaction.findFirst({
        where: {
          orderId,
          status: { in: ["pendingReview", "pending", "processing", "success", "failed"] }
        },
        select: { id: true }
      });
      if (activeRefund) {
        throw new AppException(
          "ORDER_REFUND_IN_PROGRESS",
          "Service cannot start while a refund request is active",
          HttpStatus.CONFLICT
        );
      }
      const now = Date.now();
      const scheduledStart = order.scheduledAt.getTime();
      const scheduledEnd = scheduledStart + order.durationMinutes * 60_000;
      if (now < scheduledStart - SERVICE_EARLY_START_MS) {
        throw new AppException(
          "ORDER_SERVICE_NOT_READY",
          "Service can only start within 15 minutes of the scheduled time",
          HttpStatus.CONFLICT
        );
      }
      if (now >= scheduledEnd) {
        throw new AppException(
          "ORDER_SERVICE_WINDOW_EXPIRED",
          "The scheduled service window has ended",
          HttpStatus.CONFLICT
        );
      }
      return db.order.update({
        where: { id: orderId },
        data: { status: "inService" },
        include: { conversation: { select: { externalId: true } } }
      });
    }, { maxWait: 5_000, timeout: 10_000 });
    await this.notifications.create(updated.userId, "orderStatus", "服务已开始", "陪伴者已开始本次服务。", { orderId, status: "inService" });
    return this.toDto(updated);
  }

  async confirmOrder(userId: string, orderId: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      const order = await db.order.findUnique({
        where: { id: orderId },
        include: { companion: { include: { owner: { include: { profile: true } } } }, conversation: true }
      });
      if (!order || order.companion.ownerUserId !== userId) {
        throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
      }
      if (order.status !== "pending") {
        throw new AppException("ORDER_INVALID_STATE", "Only pending orders can be confirmed", HttpStatus.CONFLICT);
      }
      if (order.companionConfirmedAt) return order;
      if (order.scheduledAt.getTime() <= Date.now()) {
        throw new AppException("ORDER_SCHEDULE_EXPIRED", "Past bookings cannot be confirmed", HttpStatus.CONFLICT);
      }
      if (
        order.companion.availability === "busy" ||
        order.companion.availableTimes.length === 0 ||
        order.companion.owner?.accountStatus !== "active" ||
        order.companion.owner?.profile?.isVerified !== true
      ) {
        throw new AppException("COMPANION_UNAVAILABLE", "Companion is not accepting this booking", HttpStatus.CONFLICT);
      }
      return db.order.update({
        where: { id: orderId },
        data: { companionConfirmedAt: new Date() },
        include: { conversation: { select: { externalId: true } } }
      });
    });
    await this.notifications.create(
      updated.userId,
      "orderStatus",
      "预约已确认",
      "陪伴者已确认本次预约，现在可以安全支付。",
      { orderId, status: "pending", companionConfirmed: true }
    );
    return this.toDto(updated);
  }

  async rejectOrder(userId: string, orderId: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      const order = await db.order.findUnique({
        where: { id: orderId },
        include: { companion: { select: { ownerUserId: true } }, conversation: true }
      });
      if (!order || order.companion.ownerUserId !== userId) {
        throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
      }
      if (order.status !== "pending" || order.companionConfirmedAt) {
        throw new AppException("ORDER_INVALID_STATE", "Only unconfirmed pending orders can be rejected", HttpStatus.CONFLICT);
      }
      const activePayment = await db.paymentTransaction.findFirst({
        where: { orderId, status: "initiated" },
        select: { id: true }
      });
      if (activePayment) {
        throw new AppException(
          "ORDER_PAYMENT_IN_PROGRESS",
          "An order with an active payment cannot be rejected",
          HttpStatus.CONFLICT
        );
      }
      return db.order.update({
        where: { id: orderId },
        data: { status: "cancelled", cancelledAt: new Date() },
        include: { conversation: { select: { externalId: true } } }
      });
    });
    await this.notifications.create(
      updated.userId,
      "orderStatus",
      "预约未被接受",
      "陪伴者当前无法接受该时段，订单已取消且不会扣款。",
      { orderId, status: "cancelled" }
    );
    return this.toDto(updated);
  }

  async completeService(userId: string, orderId: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      const order = await db.order.findUnique({
        where: { id: orderId },
        include: {
          companion: { select: { ownerUserId: true } },
          conversation: { select: { externalId: true } }
        }
      });
      if (!order || order.companion.ownerUserId !== userId) {
        throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
      }
      if (order.status !== "inService") {
        throw new AppException("ORDER_INVALID_STATE", "Only in-service orders can complete", HttpStatus.CONFLICT);
      }
      return db.order.update({
        where: { id: orderId },
        data: { status: "completed", completedAt: new Date() },
        include: { conversation: { select: { externalId: true } } }
      });
    }, { maxWait: 5_000, timeout: 10_000 });
    await this.notifications.create(updated.userId, "orderStatus", "服务已完成", "本次服务已完成，你现在可以提交评价。", { orderId, status: "completed" });
    return this.toDto(updated);
  }

  async get(userId: string, orderId: string) {
    const order = await this.findOwnedOrThrow(userId, orderId);
    return this.toDto(order);
  }

  async cancel(userId: string, orderId: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      // Serialize with prepay and payment callbacks. A locally closed WeChat
      // prepay remains externally payable, so never cancel an order once an
      // initiated payment exists.
      await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      const order = await db.order.findUnique({
        where: { id: orderId },
        include: { conversation: { select: { externalId: true } } }
      });
      if (!order || order.userId !== userId) {
        throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
      }
      if (!["pending", "paying"].includes(order.status)) {
        throw new AppException(
          "ORDER_INVALID_STATE",
          "Only pending or paying orders can be cancelled",
          HttpStatus.CONFLICT
        );
      }

      const activePayment = await db.paymentTransaction.findFirst({
        where: { orderId, status: "initiated" },
        select: { id: true, outTradeNo: true, createdAt: true, expiresAt: true }
      });
      if (activePayment) {
        const expiresAt = activePayment.expiresAt instanceof Date
          ? activePayment.expiresAt
          : new Date(activePayment.createdAt.getTime() + WECHAT_PREPAY_TTL_MS);
        if (expiresAt.getTime() > Date.now()) {
          throw new AppException(
            "ORDER_PAYMENT_IN_PROGRESS",
            "Order has an active WeChat payment and cannot be cancelled",
            HttpStatus.CONFLICT
          );
        }

        await this.wechat.closePayment(activePayment.outTradeNo);
        const closed = await db.paymentTransaction.updateMany({
          where: { id: activePayment.id, status: "initiated" },
          data: { status: "closed" }
        });
        if (closed.count !== 1) {
          throw new AppException(
            "PAYMENT_STATE_CHANGED",
            "Payment state changed while closing the expired prepay",
            HttpStatus.CONFLICT
          );
        }
      }

      return db.order.update({
        where: { id: orderId },
        data: {
          status: "cancelled",
          cancelledAt: new Date()
        },
        include: { conversation: { select: { externalId: true } } }
      });
    }, { maxWait: 5_000, timeout: 10_000 });

    await this.notifications.create(
      userId,
      "orderStatus",
      "订单已取消",
      "你的订单已取消，如需服务可重新下单。",
      { orderId, status: "cancelled" }
    );

    return this.toDto(updated);
  }

  toDto(order: OrderRecord) {
    return {
      id: order.id,
      userId: order.userId,
      companionId: order.companionId,
      themeId: order.themeId,
      durationMinutes: order.durationMinutes,
      amountCents: order.amountCents,
      amountYuan: Math.round(order.amountCents / 100),
      currency: order.currency,
      status: order.status,
      scheduledAt: (order.scheduledAt ?? order.createdAt).toISOString(),
      companionSnapshot: {
        name: order.companionNameSnapshot ?? "",
        role: order.companionRoleSnapshot ?? "",
        initials: order.companionInitialsSnapshot ?? ""
      },
      themeNameSnapshot: order.themeNameSnapshot ?? this.themeName(order.themeId),
      customer: order.user ? {
        id: order.userId,
        name: order.user.profile?.displayName ?? "用户",
        initials: (order.user.profile?.displayName ?? "用户").slice(0, 2)
      } : null,
      refund: order.refunds?.[0] ? {
        id: order.refunds[0].id,
        outRefundNo: order.refunds[0].outRefundNo,
        amountCents: order.refunds[0].amountCents,
        status: order.refunds[0].status,
        reason: order.refunds[0].reason,
        reviewNote: order.refunds[0].reviewNote,
        failureReason: order.refunds[0].failureReason
      } : null,
      conversationId: order.conversation?.externalId ?? null,
      companionConfirmedAt: order.companionConfirmedAt?.toISOString() ?? null,
      paidAt: order.paidAt?.toISOString() ?? null,
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
      completedAt: order.completedAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString()
    };
  }

  private async findOwnedOrThrow(userId: string, orderId: string): Promise<OrderRecord> {
    const order: any = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { conversation: { select: { externalId: true } }, refunds: { orderBy: { createdAt: "desc" }, take: 1 } }
    } as any);

    if (!order || order.userId !== userId) {
      throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
    }

    return order;
  }

  private async findServiceOrderOrThrow(userId: string, orderId: string): Promise<OrderRecord> {
    const order: any = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { companion: { select: { ownerUserId: true } }, conversation: { select: { externalId: true } } }
    } as any);
    if (!order || order.companion.ownerUserId !== userId) {
      throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
    }
    return order;
  }

  private themeName(themeId: string) {
    return ({
      t1: "情绪倾听",
      t2: "职场减压",
      t3: "睡前语音",
      t4: "学习陪伴",
      t5: "运动鼓励",
      t6: "兴趣聊天"
    } as Record<string, string>)[themeId] ?? "线上沟通";
  }
}
