import { HttpStatus, Injectable } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { ListNotificationsQueryDto } from "./dto/list-notifications.dto";

export type NotificationTypeName =
  | "paymentSuccess"
  | "orderStatus"
  | "moderationAlert"
  | "safetyAlert"
  | "supportUpdate"
  | "messageReceived";

export type TransactionalNotificationInput = {
  userId: string;
  type: NotificationTypeName;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  /** Stable business-event id, for example `order:<id>:confirmed`. */
  eventKey: string;
  /** A key configured server-side for a WeChat subscription template. */
  templateKey: string;
};

export type ConversationMessageNotificationInput = {
  /** Internal conversation id, used only for server-side mute enforcement. */
  conversationId: string;
  messageId: string;
  recipientUserId: string;
  /** The recipient's authorized route id (public companion id or internal id). */
  recipientConversationId: string;
};

export const CONVERSATION_MESSAGE_NOTIFICATION_TEMPLATE_KEY = "messageReceived";

/**
 * Event keys are intentionally server-only: the public notification payload
 * contains just the recipient's existing chat route, never a chat body or a
 * hidden internal conversation identifier.
 */
export function conversationMessageNotificationEventKey(input: Pick<
  ConversationMessageNotificationInput,
  "conversationId" | "messageId" | "recipientUserId"
>) {
  return `conversation:${input.conversationId}:message:${input.messageId}:recipient:${input.recipientUserId}`;
}

/** Returns the internal conversation id only for a valid, recipient-owned event. */
export function conversationIdFromMessageNotificationEventKey(
  eventKey: string | null | undefined,
  recipientUserId: string
): string | null {
  if (!eventKey) return null;
  const matched = /^conversation:([^:]+):message:([^:]+):recipient:([^:]+)$/.exec(eventKey);
  if (!matched || matched[3] !== recipientUserId) return null;
  return matched[1];
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    type: NotificationTypeName,
    title: string,
    body: string,
    data?: Record<string, unknown> | null,
    database: any = this.prisma
  ) {
    const item = await database.notification.create({
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

  /**
   * Stores the inbox item and a delivery intent in the same database
   * transaction as the business event. The worker owns remote delivery; the
   * request path never calls WeChat and therefore cannot lose a paid/order
   * state merely because a notification provider is unavailable.
   */
  async createTransactional(db: any, input: TransactionalNotificationInput) {
    const item = await db.notification.upsert({
      where: { eventKey: input.eventKey },
      create: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: (input.data ?? undefined) as any,
        eventKey: input.eventKey
      },
      update: {}
    });
    await db.notificationDelivery.upsert({
      where: {
        notificationId_templateKey: {
          notificationId: item.id,
          templateKey: input.templateKey
        }
      },
      create: {
        notificationId: item.id,
        userId: input.userId,
        templateKey: input.templateKey,
        status: "pending",
        nextAttemptAt: new Date()
      },
      update: {}
    });
    return this.toDto(item);
  }

  /**
   * Stores a durable new-message notification only when the recipient has not
   * muted this exact conversation. It never receives or renders message body
   * text. The delivery worker rechecks the same preference immediately before
   * consuming a one-time WeChat grant, so a queued delivery cannot bypass a
   * mute chosen after the message transaction committed.
   */
  async createConversationMessageReceivedIfUnmuted(
    db: any,
    input: ConversationMessageNotificationInput
  ) {
    // Sending paths recheck this boundary before publishing. Keep a second
    // check here so a future caller cannot turn a blocked conversation into an
    // inbox or external reminder by mistake.
    const block = await db.conversationBlock.findFirst({
      where: { conversationId: input.conversationId },
      select: { id: true }
    });
    if (block) return { queued: false };
    const preference = await db.conversationNotificationPreference.findUnique({
      where: {
        conversationId_userId: {
          conversationId: input.conversationId,
          userId: input.recipientUserId
        }
      },
      select: { mutedAt: true }
    });
    if (preference?.mutedAt) return { queued: false };

    await this.createTransactional(db, {
      userId: input.recipientUserId,
      type: "messageReceived",
      title: "收到一条新消息",
      body: "打开 Talk&Talk 的平台内会话查看。",
      data: { conversationId: input.recipientConversationId },
      eventKey: conversationMessageNotificationEventKey(input),
      templateKey: CONVERSATION_MESSAGE_NOTIFICATION_TEMPLATE_KEY
    });
    return { queued: true };
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
