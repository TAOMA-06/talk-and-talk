import { HttpStatus, Injectable } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { ListNotificationsQueryDto } from "./dto/list-notifications.dto";

export type NotificationTypeName =
  | "paymentSuccess"
  | "orderStatus"
  | "moderationAlert"
  | "safetyAlert";

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    type: NotificationTypeName,
    title: string,
    body: string,
    data?: Record<string, unknown> | null
  ) {
    const item = await this.prisma.notification.create({
      data: {
        userId,
        type,
        title,
        body,
        data: (data ?? undefined) as any
      }
    } as any);
    return this.toDto(item);
  }

  async list(userId: string, query: ListNotificationsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: any = { userId };
    if (query.unreadOnly) {
      where.readAt = null;
    }

    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize
      } as any),
      this.prisma.notification.count({ where } as any)
    ]);

    return {
      items: items.map((item: any) => this.toDto(item)),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    };
  }

  async unreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, readAt: null }
    } as any);
    return { count };
  }

  async markRead(userId: string, id: string) {
    const item = await this.prisma.notification.findUnique({ where: { id } } as any);
    if (!item || item.userId !== userId) {
      throw new AppException("NOTIFICATION_NOT_FOUND", "Notification not found", HttpStatus.NOT_FOUND);
    }
    if (item.readAt) {
      return this.toDto(item);
    }
    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() }
    } as any);
    return this.toDto(updated);
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() }
    } as any);
    return { updated: result.count };
  }

  private toDto(item: any) {
    return {
      id: item.id,
      userId: item.userId,
      type: item.type,
      title: item.title,
      body: item.body,
      data: item.data ?? null,
      readAt: item.readAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString()
    };
  }
}
