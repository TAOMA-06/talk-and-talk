import { HttpStatus, Injectable } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { ModerationCaseService } from "../moderation/moderation-case.service";
import { ModerationService, ModerationResult } from "../moderation/moderation.service";
import { ListMessagesQueryDto } from "./dto/list-messages.dto";
import { SendMessageDto } from "./dto/send-message.dto";

type Db = any;

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
    private readonly moderationCases: ModerationCaseService
  ) {}

  async list(userId: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: { userId },
      include: {
        companion: true,
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
        const readAt = conversation.readStates[0]?.readAt ?? new Date(0);
        const unreadCount = await this.prisma.message.count({
          where: {
            conversationId: conversation.id,
            senderId: { not: userId },
            createdAt: { gt: readAt }
          }
        } as any);

        return {
          id: conversation.externalId,
          participant: this.participantDto(conversation.companion),
          lastMessage: conversation.messages[0]
            ? this.toMessageDto(conversation.messages[0], conversation.externalId)
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

    const where: any = { conversationId: conversation.id };
    if (cursorMessage) {
      where.OR = [
        { createdAt: { gt: cursorMessage.createdAt } },
        { createdAt: cursorMessage.createdAt, id: { gt: cursorMessage.id } }
      ];
    }

    const messages = await this.prisma.message.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1
    } as any);

    const page = messages.slice(0, limit);
    if (page.length) {
      await this.prisma.messageReadState.upsert({
        where: {
          conversationId_userId: {
            conversationId: conversation.id,
            userId
          }
        },
        create: {
          conversationId: conversation.id,
          userId,
          readAt: new Date()
        },
        update: {
          readAt: new Date()
        }
      } as any);
    }

    return {
      messages: page.map((message: any) => this.toMessageDto(message, conversation.externalId)),
      pagination: {
        limit,
        nextCursor: messages.length > limit ? page[page.length - 1]?.id ?? null : null,
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
      let companionReply: any | null = null;

      if (moderation.decision !== "block") {
        message = await db.message.create({
          data: {
            conversationId: conversation.id,
            senderId: userId,
            senderName: user.profile?.displayName ?? "用户",
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

      if (moderation.decision === "allow" || moderation.decision === "warn") {
        companionReply = await db.message.create({
          data: {
            conversationId: conversation.id,
            senderId: conversation.companionId,
            senderName: conversation.companion.name,
            content: "我在，先慢慢说。我们可以继续在平台内沟通。",
            type: "text",
            createdAt: new Date(now + 2)
          }
        });
      }

      const moderationCase = await this.moderationCases.createFromResult({
        result: moderation,
        source: "chat",
        content,
        targetId: conversation.externalId,
        messageId: message?.id ?? null,
        actorId: userId,
        db
      });

      await db.conversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date(now + 3) }
      });

      return { message, safetyMessage, companionReply, moderationCase };
    });

    return {
      moderation: this.toPublicModeration(moderation),
      message: result.message ? this.toMessageDto(result.message, conversation.externalId) : null,
      safetyMessage: result.safetyMessage ? this.toMessageDto(result.safetyMessage, conversation.externalId) : null,
      companionReply: result.companionReply ? this.toMessageDto(result.companionReply, conversation.externalId) : null,
      moderationCase: result.moderationCase ? this.toModerationCaseDto(result.moderationCase) : null
    };
  }

  private async ensureConversation(userId: string, externalId: string) {
    const existing = await this.prisma.conversation.findUnique({
      where: {
        userId_externalId: {
          userId,
          externalId
        }
      },
      include: { companion: true }
    } as any);

    if (existing) {
      return existing;
    }

    // New conversations can only be started with published companions.
    // Existing conversations remain readable/writable even if later unpublished.
    const companion = await this.prisma.companionProfile.findFirst({
      where: { id: externalId, isPublished: true }
    } as any);

    if (!companion) {
      throw new AppException("CONVERSATION_NOT_FOUND", "Conversation not found", HttpStatus.NOT_FOUND);
    }

    return this.prisma.conversation.create({
      data: {
        externalId: companion.id,
        userId,
        companionId: companion.id
      },
      include: { companion: true }
    } as any);
  }

  private participantDto(companion: any) {
    return {
      id: companion.id,
      name: companion.name,
      role: companion.role,
      initials: companion.initials,
      isOnline: companion.isOnline,
      isVerified: companion.isVerified,
      availability: companion.availability,
      responseTime: companion.responseTime
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

  private toModerationCaseDto(item: any) {
    return {
      id: item.id,
      title: item.title,
      category: item.category,
      riskLevel: item.riskLevel,
      status: item.status,
      source: item.source,
      content: item.content,
      targetId: item.targetId,
      aiScore: item.aiScore,
      aiReason: item.aiReason,
      decision: item.decision,
      matchedRules: item.matchedRules,
      usedAI: item.usedAI,
      resolvedAt: item.resolvedAt?.toISOString() ?? null
    };
  }

  private toPublicModeration(result: ModerationResult) {
    return {
      decision: result.decision,
      riskLevel: result.riskLevel,
      score: result.score,
      reasons: result.reasons,
      matchedRules: result.matchedRules,
      usedAI: result.usedAI
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
