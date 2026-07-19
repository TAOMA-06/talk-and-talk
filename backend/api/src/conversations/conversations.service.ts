import { HttpStatus, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { ModerationCaseService } from "../moderation/moderation-case.service";
import { ModerationService, ModerationResult } from "../moderation/moderation.service";
import { ListMessagesQueryDto } from "./dto/list-messages.dto";
import { SendMessageDto } from "./dto/send-message.dto";

type Db = any;
const CHAT_ENABLED_ORDER_STATUSES = ["paid", "inService", "completed"] as const;

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
    private readonly moderationCases: ModerationCaseService
  ) {}

  async list(userId: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        orders: { some: { status: { in: [...CHAT_ENABLED_ORDER_STATUSES] } } },
        OR: [{ userId }, { companion: { ownerUserId: userId } }]
      },
      include: {
        companion: true,
        user: { include: { profile: true } },
        messages: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1
        },
        readStates: {
          where: { userId },
          take: 1
        }
      },
      orderBy: { updatedAt: "desc" }
    } as any);

    const items = await Promise.all(
      conversations.map(async (conversation: any) => {
        const isCustomer = conversation.userId === userId;
        const readState = conversation.readStates[0];
        const unreadPosition = readState
          ? {
              OR: [
                { createdAt: { gt: readState.readAt } },
                ...(readState.lastReadMessageId
                  ? [
                      {
                        createdAt: readState.readAt,
                        id: { gt: readState.lastReadMessageId }
                      }
                    ]
                  : [])
              ]
            }
          : {};
        const unreadCount = await this.prisma.message.count({
          where: {
            conversationId: conversation.id,
            senderId: { not: userId },
            ...unreadPosition
          }
        } as any);

        return {
          // Customer routes stay compatible with the public companion id. An
          // owner must route by the internal id because one companion can have
          // multiple customer conversations with the same external id.
          id: isCustomer ? conversation.externalId : conversation.id,
          companionId: conversation.companionId,
          viewerRole: isCustomer ? "customer" : "companion",
          participant: isCustomer
            ? this.companionParticipantDto(conversation.companion)
            : this.customerParticipantDto(conversation.user),
          lastMessage: conversation.messages[0]
            ? this.toMessageDto(
                conversation.messages[0],
                isCustomer ? conversation.externalId : conversation.id
              )
            : null,
          unreadCount,
          updatedAt: conversation.updatedAt.toISOString()
        };
      })
    );

    return { conversations: items };
  }

  async messages(userId: string, externalId: string, query: ListMessagesQueryDto) {
    const conversation = await this.ensureConversation(userId, externalId);
    const limit = Math.min(query.limit ?? 50, 100);
    const cursorMessage = query.cursor
      ? await this.prisma.message.findFirst({
          where: { id: query.cursor, conversationId: conversation.id }
        } as any)
      : null;
    if (query.cursor && !cursorMessage) {
      throw new AppException("INVALID_CURSOR", "Message cursor is invalid", HttpStatus.BAD_REQUEST);
    }

    const where: any = { conversationId: conversation.id };
    if (cursorMessage) {
      where.OR = [
        { createdAt: { lt: cursorMessage.createdAt } },
        { createdAt: cursorMessage.createdAt, id: { lt: cursorMessage.id } }
      ];
    }

    const messages = await this.prisma.message.findMany({
      where,
      // Fetch newest-first so an app that does not paginate still sees live
      // messages. Reverse the selected page before returning for chat display.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1
    } as any);

    const page = messages.slice(0, limit).reverse();
    if (page.length) {
      const readThrough = page[page.length - 1].createdAt;
      const lastReadMessageId = page[page.length - 1].id;
      const readStateId = randomUUID();
      await this.prisma.$executeRaw`
        INSERT INTO "MessageReadState"
          ("id", "conversationId", "userId", "readAt", "lastReadMessageId")
        VALUES
          (${readStateId}, ${conversation.id}, ${userId}, ${readThrough}, ${lastReadMessageId})
        ON CONFLICT ("conversationId", "userId") DO UPDATE
        SET
          "readAt" = EXCLUDED."readAt",
          "lastReadMessageId" = EXCLUDED."lastReadMessageId"
        WHERE
          "MessageReadState"."readAt" < EXCLUDED."readAt"
          OR (
            "MessageReadState"."readAt" = EXCLUDED."readAt"
            AND COALESCE("MessageReadState"."lastReadMessageId", '') < EXCLUDED."lastReadMessageId"
          )
      `;
    }

    return {
      messages: page.map((message: any) => this.toMessageDto(message, externalId)),
      pagination: {
        limit,
        nextCursor: messages.length > limit ? page[0]?.id ?? null : null,
        hasMore: messages.length > limit
      }
    };
  }

  async send(userId: string, externalId: string, dto: SendMessageDto) {
    const content = dto.content.trim();
    if (!content) {
      throw new AppException("EMPTY_MESSAGE", "Message content is required", HttpStatus.BAD_REQUEST);
    }

    const conversation: any = await this.ensureConversation(userId, externalId);
    const user: any = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true }
    } as any);
    if (!user) {
      throw new AppException("UNAUTHORIZED", "User not found", HttpStatus.UNAUTHORIZED);
    }
    const isCompanion = conversation.companion.ownerUserId === userId;

    const recentMessages = await this.prisma.message.findMany({
      where: {
        conversationId: conversation.id,
        senderId: userId,
        type: "text"
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 4
    } as any);
    const moderation = await this.moderation.moderateAsync(content, "chat", {
      recentMessages: recentMessages.map((message: any) => message.content),
      safetyScore: user.profile?.safetyScore ?? 80,
      isVerified: user.profile?.isVerified ?? false
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as Db;
      const now = Date.now();
      let message: any | null = null;
      let safetyMessage: any | null = null;

      if (moderation.decision !== "block") {
        message = await db.message.create({
          data: {
            conversationId: conversation.id,
            senderId: userId,
            senderName: isCompanion
              ? conversation.companion.name
              : user.profile?.displayName ?? "用户",
            content,
            type: "text",
            createdAt: new Date(now)
          }
        });
      }

      if (moderation.decision === "block" || moderation.decision === "warn" || moderation.decision === "review") {
        safetyMessage = await db.message.create({
          data: {
            conversationId: conversation.id,
            senderId: "system",
            senderName: "系统",
            content: this.safetyContent(moderation),
            type: "safety",
            createdAt: new Date(now + 1)
          }
        });
      }

      await this.moderationCases.createFromResult({
        result: moderation,
        source: "chat",
        content,
        // Moderation evidence must identify this customer's conversation, not
        // the shared public companion id.
        targetId: conversation.id,
        messageId: message?.id ?? null,
        actorId: userId,
        db
      });

      await db.conversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date(now + 3) }
      });

      return { message, safetyMessage };
    });

    return {
      moderation: this.toPublicModeration(moderation),
      message: result.message ? this.toMessageDto(result.message, externalId) : null,
      safetyMessage: result.safetyMessage ? this.toMessageDto(result.safetyMessage, externalId) : null,
      companionReply: null
    };
  }

  private async ensureConversation(userId: string, externalId: string) {
    const existing = await this.prisma.conversation.findFirst({
      where: {
        orders: { some: { status: { in: [...CHAT_ENABLED_ORDER_STATUSES] } } },
        OR: [
          { userId, externalId },
          { id: externalId, companion: { ownerUserId: userId } }
        ]
      },
      include: {
        companion: true,
        user: { include: { profile: true } }
      }
    } as any);

    if (existing) {
      return existing;
    }

    // Payment fulfillment owns conversation activation. A published profile must
    // not let an API client bypass ordering and payment.
    const companion = await this.prisma.companionProfile.findFirst({
      where: { id: externalId, isPublished: true }
    } as any);

    if (companion) {
      throw new AppException(
        "PAYMENT_REQUIRED",
        "A paid order is required before messaging this companion",
        HttpStatus.FORBIDDEN
      );
    }

    throw new AppException("CONVERSATION_NOT_FOUND", "Conversation not found", HttpStatus.NOT_FOUND);
  }

  private companionParticipantDto(companion: any) {
    return {
      id: companion.id,
      kind: "companion",
      name: companion.name,
      role: companion.role,
      initials: companion.initials,
      isOnline: companion.isOnline,
      isVerified: companion.isVerified,
      availability: companion.availability,
      responseTime: companion.responseTime
    };
  }

  private customerParticipantDto(user: any) {
    const name = user.profile?.displayName?.trim() || "用户";
    return {
      id: user.id,
      kind: "customer",
      name,
      role: "客户",
      initials: name.slice(0, 2),
      isOnline: false,
      isVerified: user.profile?.isVerified ?? false,
      availability: "available",
      responseTime: ""
    };
  }

  private toMessageDto(message: any, externalConversationId: string) {
    return {
      id: message.id,
      conversationId: externalConversationId,
      senderId: message.senderId,
      senderName: message.senderName,
      content: message.content,
      type: message.type,
      timestamp: message.createdAt.toISOString()
    };
  }

  private toPublicModeration(result: ModerationResult) {
    return {
      decision: result.decision,
      riskLevel: result.riskLevel
    };
  }

  private safetyContent(result: ModerationResult): string {
    switch (result.decision) {
      case "block":
        return "安全提醒：平台不支持线下邀约、私下转账或敏感交易，请在平台内完成沟通。";
      case "warn":
        return "友善提醒：你的表达可能接近边界，请阅读用户协议并保持平台内沟通。";
      case "review":
        return "安全提醒：这条消息已进入平台复核，请继续保持平台内沟通。";
      case "allow":
        return "";
    }
  }
}
