import { HttpStatus, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { AuditService } from "../common/audit/audit.service";
import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { CreateOrderDto } from "./dto/create-order.dto";
import { CreateRefundDto } from "./dto/create-refund.dto";

type OrderRecord = {
  id: string;
  userId: string;
  companionId: string;
  themeId: string;
  durationMinutes: number;
  amountCents: number;
  currency: string;
  status: string;
  conversationId: string | null;
  paidAt: Date | null;
  cancelledAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  conversation?: { externalId: string } | null;
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService
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
      where: { id: dto.companionId, isPublished: true }
    } as any);

    if (!companion) {
      throw new AppException("COMPANION_NOT_FOUND", "Companion not found", HttpStatus.NOT_FOUND);
    }

    const units = Math.max(1, Math.ceil(durationMinutes / 30));
    const amountCents = companion.pricePerHalfHour * units * 100;

    const order = await this.prisma.order.create({
      data: {
        userId,
        companionId: companion.id,
        themeId: dto.themeId,
        durationMinutes,
        amountCents,
        currency: "CNY",
        status: "pending"
      }
    } as any);

    return this.toDto(order);
  }

  async list(userId: string) {
    const orders = await this.prisma.order.findMany({
      where: { userId },
      include: { conversation: { select: { externalId: true } } },
      orderBy: { createdAt: "desc" }
    } as any);

    return {
      items: orders.map((order: OrderRecord) => this.toDto(order))
    };
  }

  async get(userId: string, orderId: string) {
    const order = await this.findOwnedOrThrow(userId, orderId);
    return this.toDto(order);
  }

  async cancel(userId: string, orderId: string) {
    const order = await this.findOwnedOrThrow(userId, orderId);

    if (order.status !== "pending" && order.status !== "paying") {
      throw new AppException(
        "ORDER_INVALID_STATE",
        "Only pending or paying orders can be cancelled",
        HttpStatus.CONFLICT
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.paymentTransaction.updateMany({
        where: {
          orderId,
          status: "initiated"
        },
        data: {
          status: "closed"
        }
      });

      return db.order.update({
        where: { id: orderId },
        data: {
          status: "cancelled",
          cancelledAt: new Date()
        },
        include: { conversation: { select: { externalId: true } } }
      });
    });

    await this.notifications.create(
      userId,
      "orderStatus",
      "订单已取消",
      "你的订单已取消，如需服务可重新下单。",
      { orderId, status: "cancelled" }
    );

    return this.toDto(updated);
  }

  async createRefundSkeleton(userId: string, orderId: string, dto: CreateRefundDto) {
    const order = await this.findOwnedOrThrow(userId, orderId);

    if (!["paid", "inService", "completed"].includes(order.status)) {
      throw new AppException(
        "ORDER_INVALID_STATE",
        "Refund is only available for paid, inService, or completed orders",
        HttpStatus.CONFLICT
      );
    }

    const payment = await this.prisma.paymentTransaction.findFirst({
      where: { orderId, status: "success" },
      orderBy: { paidAt: "desc" }
    } as any);

    if (!payment) {
      throw new AppException(
        "PAYMENT_NOT_FOUND",
        "No successful payment found for this order",
        HttpStatus.NOT_FOUND
      );
    }

    const existing = await this.prisma.refundTransaction.findFirst({
      where: {
        orderId,
        status: { in: ["pending", "processing", "success"] }
      }
    } as any);

    if (existing) {
      return {
        refund: this.toRefundDto(existing),
        order: this.toDto(order)
      };
    }

    const refund = await this.prisma.refundTransaction.create({
      data: {
        orderId,
        paymentId: payment.id,
        outRefundNo: `R${Date.now()}${randomUUID().replace(/-/g, "").slice(0, 10)}`,
        amountCents: order.amountCents,
        status: "pending",
        reason: dto.reason?.trim() || null
      }
    } as any);

    await this.audit.record({
      actorId: userId,
      action: "refund.requested",
      resourceType: "order",
      resourceId: orderId,
      metadata: { refundId: refund.id, amountCents: order.amountCents }
    });

    await this.notifications.create(
      userId,
      "orderStatus",
      "退款申请已提交",
      "我们已收到你的退款申请，将尽快处理。",
      { orderId, refundId: refund.id, status: "pending" }
    );

    return {
      refund: this.toRefundDto(refund),
      order: this.toDto(order)
    };
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
      conversationId: order.conversation?.externalId ?? null,
      paidAt: order.paidAt?.toISOString() ?? null,
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
      completedAt: order.completedAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString()
    };
  }

  private toRefundDto(refund: any) {
    return {
      id: refund.id,
      orderId: refund.orderId,
      paymentId: refund.paymentId,
      outRefundNo: refund.outRefundNo,
      amountCents: refund.amountCents,
      status: refund.status,
      reason: refund.reason,
      providerRefundId: refund.providerRefundId,
      createdAt: refund.createdAt.toISOString(),
      updatedAt: refund.updatedAt.toISOString()
    };
  }

  private async findOwnedOrThrow(userId: string, orderId: string): Promise<OrderRecord> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { conversation: { select: { externalId: true } } }
    } as any);

    if (!order || order.userId !== userId) {
      throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
    }

    return order;
  }
}
