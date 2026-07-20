import { HttpStatus, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { ChatRestrictionService } from "../moderation/chat-restriction.service";
import { MediaAssetService } from "../moderation/media/media-asset.service";
import { MediaModerationWorker } from "../moderation/media/media-moderation.worker";
import { ModerationCaseService } from "../moderation/moderation-case.service";
import { ModerationService, ModerationResult } from "../moderation/moderation.service";
import { ListMessagesQueryDto } from "./dto/list-messages.dto";
import { ReserveMediaUploadDto } from "./dto/reserve-media-upload.dto";
import { SendMessageDto } from "./dto/send-message.dto";

type Db = any;
const CHAT_ENABLED_ORDER_STATUSES = ["paid", "inService", "completed"] as const;

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
    private readonly moderationCases: ModerationCaseService,
    private readonly chatRestrictions: ChatRestrictionService,
    private readonly mediaAssets: MediaAssetService,
    private readonly mediaWorker: MediaModerationWorker
  ) {}

  status() {
    return {
      module: "conversations",
      status: "active",
      mediaEnabled: this.mediaAssets.isFeatureEnabled()
    };
  }

  async conversationStatus(userId: string, externalId: string) {
    await this.ensureConversation(userId, externalId);
    const restriction: any = await this.chatRestrictions.activeForUser(userId);
    return {
      mediaEnabled: this.mediaAssets.isFeatureEnabled(),
      chatRestriction: restriction
        ? {
            id: restriction.id,
            reason: restriction.reason,
            endsAt: restriction.endsAt.toISOString()
          }
        : null
    };
  }

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
          where: { moderationStatus: "published", visibility: "participants" },
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
            moderationStatus: "published",
            visibility: "participants",
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
            ? await this.toMessageDto(
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
    const visibleToViewer = {
      OR: [
        { moderationStatus: "published", visibility: "participants" },
        { senderId: userId }
      ]
    };
    const cursorMessage = query.cursor
      ? await this.prisma.message.findFirst({
          where: { id: query.cursor, conversationId: conversation.id, AND: [visibleToViewer] }
        } as any)
      : null;
    if (query.cursor && !cursorMessage) {
      throw new AppException("INVALID_CURSOR", "Message cursor is invalid", HttpStatus.BAD_REQUEST);
    }

    const where: any = {
      conversationId: conversation.id,
      AND: [visibleToViewer]
    };
    if (cursorMessage) {
      where.AND.push({
        OR: [
          { createdAt: { lt: cursorMessage.createdAt } },
          { createdAt: cursorMessage.createdAt, id: { lt: cursorMessage.id } }
        ]
      });
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
      messages: await Promise.all(page.map((message: any) => this.toMessageDto(message, externalId))),
      pagination: {
        limit,
        nextCursor: messages.length > limit ? page[0]?.id ?? null : null,
        hasMore: messages.length > limit
      }
    };
  }

  async send(userId: string, externalId: string, dto: SendMessageDto) {
    const content = dto.content?.trim() ?? "";
    const attachmentIds = [...new Set(dto.attachmentIds ?? [])];
    if ((!content && !attachmentIds.length) || attachmentIds.length > 3) {
      throw new AppException("EMPTY_MESSAGE", "Message content or an attachment is required", HttpStatus.BAD_REQUEST);
    }

    await this.chatRestrictions.assertCanSend(userId);

    const conversation: any = await this.ensureConversation(userId, externalId);
    const user: any = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true }
    } as any);
    if (!user) {
      throw new AppException("UNAUTHORIZED", "User not found", HttpStatus.UNAUTHORIZED);
    }
    const isCompanion = conversation.companion.ownerUserId === userId;

    const [recentMessages, recentHighRiskBlocks] = await Promise.all([
      this.prisma.message.findMany({
        where: { conversationId: conversation.id, moderationStatus: "published" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 10,
        select: { content: true }
      } as any),
      this.prisma.moderationCase.count({
        where: {
          subjectUserId: userId,
          decision: "block",
          riskLevel: "high",
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        }
      } as any)
    ]);
    const moderation = await this.moderation.moderateAsync(content || "[media]", "chat", {
      recentMessages: recentMessages.map((message: any) => message.content).reverse(),
      safetyScore: user.profile?.safetyScore ?? 80,
      isVerified: user.profile?.isVerified ?? false,
      recentHighRiskBlocks
    });

    const hasAttachments = attachmentIds.length > 0;
    const directBlock = moderation.decision === "block";
    const moderationStatus = directBlock
      ? "blocked"
      : hasAttachments
        ? "queued"
        : moderation.decision === "allow"
          ? "published"
          : "pendingReview";
    const visibility = moderationStatus === "published" ? "participants" : "senderOnly";

    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as Db;
      const now = Date.now();
      let message: any;
      let safetyMessage: any | null = null;
      let moderationCase: any | null = null;

      message = await db.message.create({
        data: {
          conversationId: conversation.id,
          senderId: userId,
          senderName: isCompanion
            ? conversation.companion.name
            : user.profile?.displayName ?? "用户",
          content,
          type: "text",
          moderationStatus,
          visibility,
          moderationDecision: moderation.decision,
          policyVersion: moderation.policyVersion,
          reviewedAt: moderationStatus === "published" ? new Date(now) : null,
          createdAt: new Date(now)
        }
      });

      if (hasAttachments) {
        const assets = await this.mediaAssets.bindUploadedAssets({
          assetIds: attachmentIds,
          uploaderId: userId,
          conversationId: conversation.id,
          messageId: message.id,
          db
        });
        if (directBlock) {
          await db.mediaAsset.updateMany({
            where: { id: { in: assets.map((asset: any) => asset.id) } },
            data: { status: "blocked", lastError: "关联文本消息已被安全策略拦截" }
          });
        } else if (!content && assets.length === 1) {
          const type = assets[0].kind;
          await db.message.update({ where: { id: message.id }, data: { type } });
          message.type = type;
        }
      }

      if ((!hasAttachments && moderationStatus !== "published") || directBlock) {
        safetyMessage = await db.message.create({
          data: {
            conversationId: conversation.id,
            senderId: userId,
            senderName: "系统",
            content: this.safetyContent(moderation),
            type: "safety",
            moderationStatus: "published",
            visibility: "senderOnly",
            policyVersion: moderation.policyVersion,
            createdAt: new Date(now + 1)
          }
        });
      }

      if ((!hasAttachments && moderation.decision !== "allow") || directBlock) {
        moderationCase = await this.moderationCases.createFromResult({
          result: moderation,
          source: "chat",
          content: content || "[媒体消息]",
          // Moderation evidence must identify this customer's conversation, not
          // the shared public companion id.
          targetId: conversation.id,
          conversationId: conversation.id,
          messageId: message.id,
          subjectUserId: userId,
          actorId: userId,
          db
        });
      }

      await db.conversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date(now + 3) }
      });

      return { message, safetyMessage, moderationCase };
    });

    if (directBlock && result.moderationCase) {
      await this.chatRestrictions.recordAutomaticHighRiskBlock(userId, result.moderationCase.id);
    }
    if (hasAttachments && !directBlock) {
      this.mediaWorker.enqueue(result.message.id);
    }

    return {
      moderation: this.toPublicModeration(moderation, moderationStatus, result.moderationCase?.id ?? null),
      message: directBlock ? null : await this.toMessageDto(result.message, externalId),
      safetyMessage: result.safetyMessage ? await this.toMessageDto(result.safetyMessage, externalId) : null,
      companionReply: null
    };
  }

  async reserveMediaUpload(userId: string, externalId: string, dto: ReserveMediaUploadDto) {
    await this.chatRestrictions.assertCanSend(userId);
    const conversation = await this.ensureConversation(userId, externalId);
    return this.mediaAssets.reserve({
      uploaderId: userId,
      conversationId: conversation.id,
      kind: dto.kind,
      mimeType: dto.mimeType.toLowerCase(),
      sizeBytes: dto.sizeBytes,
      sha256: dto.sha256,
      durationMs: dto.durationMs
    });
  }

  async completeMediaUpload(userId: string, externalId: string, assetId: string) {
    await this.chatRestrictions.assertCanSend(userId);
    const conversation = await this.ensureConversation(userId, externalId);
    return this.mediaAssets.complete(assetId, userId, conversation.id);
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

  private async toMessageDto(message: any, externalConversationId: string) {
    const attachments = await this.mediaAssets.attachmentsForMessage(
      message.id,
      message.moderationStatus === "published" && message.visibility === "participants"
    );
    return {
      id: message.id,
      conversationId: externalConversationId,
      senderId: message.senderId,
      senderName: message.senderName,
      content: message.content,
      type: message.type,
      moderationStatus: message.moderationStatus ?? "published",
      visibility: message.visibility ?? "participants",
      attachments,
      timestamp: message.createdAt.toISOString()
    };
  }

  private toPublicModeration(
    result: ModerationResult,
    deliveryStatus: string,
    caseId: string | null
  ) {
    return {
      decision: result.decision,
      riskLevel: result.riskLevel,
      deliveryStatus,
      caseId,
      appealEligible: result.decision === "block" && Boolean(caseId)
    };
  }

  private safetyContent(result: ModerationResult): string {
    if (result.categories.includes("selfHarm") || result.categories.includes("violence")) {
      return "安全提醒：如果你正处于危险或需要即时帮助，请优先联系可信赖的人或当地紧急求助渠道。你的消息已进入优先复核。";
    }
    switch (result.decision) {
      case "block":
        return "安全提醒：平台不支持线下邀约、私下转账或敏感交易，请在平台内完成沟通。";
      case "warn":
        return "安全提醒：这条消息暂未送达，已进入平台复核，请继续保持平台内沟通。";
      case "review":
        return "安全提醒：这条消息暂未送达，已进入平台复核，请继续保持平台内沟通。";
      case "allow":
        return "";
    }
  }
}
