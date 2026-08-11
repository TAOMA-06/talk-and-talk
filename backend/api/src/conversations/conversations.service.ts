import { HttpStatus, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";

import { AppException } from "../common/errors/app.exception";
import { AuditService } from "../common/audit/audit.service";
import { CrisisInterventionService } from "../crisis-intervention/crisis-intervention.service";
import { PrismaService } from "../database/prisma.service";
import { ChatRestrictionService } from "../moderation/chat-restriction.service";
import { MediaAssetService } from "../moderation/media/media-asset.service";
import { MediaModerationWorker } from "../moderation/media/media-moderation.worker";
import { ModerationCaseService } from "../moderation/moderation-case.service";
import { ModerationService, ModerationResult } from "../moderation/moderation.service";
import { NotificationsService } from "../notifications/notifications.service";
import { assertPublicInteractionIdentity } from "../users/public-interaction-identity.gate";
import { ListConversationsDto } from "./dto/list-conversations.dto";
import { ListMessagesQueryDto } from "./dto/list-messages.dto";
import { ReserveMediaUploadDto } from "./dto/reserve-media-upload.dto";
import { SendMessageDto } from "./dto/send-message.dto";
import { SetConversationBlockDto } from "./dto/set-conversation-block.dto";
import { SetConversationNotificationPreferenceDto } from "./dto/set-conversation-notification-preference.dto";
import { SetFutureBookingBoundaryDto } from "./dto/set-future-booking-boundary.dto";

type Db = any;
const CHAT_ENABLED_ORDER_STATUSES = ["paid", "inService", "completed"] as const;
const DEFAULT_ORDER_CHAT_PRE_SERVICE_WINDOW_MINUTES = 15;
const DEFAULT_ORDER_CHAT_POST_SERVICE_WINDOW_MINUTES = 15;

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
    private readonly moderationCases: ModerationCaseService,
    private readonly chatRestrictions: ChatRestrictionService,
    private readonly mediaAssets: MediaAssetService,
    private readonly mediaWorker: MediaModerationWorker,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly crisisIntervention: CrisisInterventionService,
    @Optional() private readonly config?: ConfigService
  ) {}

  status() {
    return {
      module: "conversations",
      status: "active",
      mediaEnabled: this.mediaAssets.isFeatureEnabled()
    };
  }

  async conversationStatus(userId: string, externalId: string) {
    const conversation = await this.ensureConversation(userId, externalId);
    const viewerCanManageFutureBookingBoundary = conversation.companion.ownerUserId === userId;
    const [restriction, preference, ownBlock, availability, futureBoundary] = await Promise.all([
      this.chatRestrictions.activeForUser(userId),
      this.prisma.conversationNotificationPreference.findUnique({
        where: { conversationId_userId: { conversationId: conversation.id, userId } },
        select: { mutedAt: true }
      } as any),
      this.prisma.conversationBlock.findUnique({
        where: { conversationId_blockedByUserId: { conversationId: conversation.id, blockedByUserId: userId } },
        select: { id: true }
      } as any),
      this.messageAvailability(conversation.id),
      viewerCanManageFutureBookingBoundary
        ? this.prisma.companionCustomerFutureBoundary.findUnique({
            where: {
              companionId_customerUserId: {
                companionId: conversation.companionId,
                customerUserId: conversation.userId
              }
            },
            select: { id: true }
          } as any)
        : Promise.resolve(null)
    ]);
    return {
      mediaEnabled: this.mediaAssets.isFeatureEnabled(),
      messageNotificationsMuted: Boolean(preference?.mutedAt),
      conversationBlockedByYou: Boolean(ownBlock),
      // Viewer-owned state only. Customers always receive false and therefore
      // cannot infer whether the companion set this private marketplace boundary.
      viewerCanManageFutureBookingBoundary,
      futureBookingsDeclinedByYou:
        viewerCanManageFutureBookingBoundary && Boolean(futureBoundary),
      futureBookingBoundaryScope: "newOrdersAndRecommendationsOnly" as const,
      existingOrdersUnaffected: true,
      conversationUnaffected: true,
      ...availability,
      chatRestriction: restriction
        ? {
            id: restriction.id,
            reason: restriction.reason,
            endsAt: restriction.endsAt.toISOString()
          }
        : null
    };
  }

  async summary(userId: string) {
    const activeSupportCount = await this.prisma.supportTicket.count({
      where: { userId, status: { in: ["open", "inProgress"] } }
    } as any);
    return { activeSupportCount };
  }

  async list(userId: string, query: ListConversationsDto = {}) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: any = {
        orders: { some: { status: { in: [...CHAT_ENABLED_ORDER_STATUSES] } } },
        OR: [{ userId }, { companion: { ownerUserId: userId } }],
        ...(query.blockedByYou === true
          ? { blocks: { some: { blockedByUserId: userId } } }
          : {})
    };
    const [conversations, total] = await Promise.all([
      this.prisma.conversation.findMany({
      where,
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
        },
        notificationPreferences: {
          where: { userId },
          select: { mutedAt: true },
          take: 1
        },
        // The response never exposes a block actor. It only receives a
        // boolean describing whether message interaction is available and,
        // for the current user, whether an unblock control is needed.
        blocks: {
          select: { blockedByUserId: true },
          take: 2
        },
        // Interaction availability is resolved below with a database EXISTS
        // predicate; never attach an unbounded paid-order history to the list.
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize
    } as any),
      this.prisma.conversation.count({ where } as any)
    ]);

    const unreadConditions = conversations
      .filter((conversation: any) => conversation.blocks.length === 0)
      .map((conversation: any) => {
        const readState = conversation.readStates[0];
        return {
          conversationId: conversation.id,
          senderId: { not: userId },
          moderationStatus: "published",
          visibility: "participants",
          ...(readState
            ? {
                OR: [
                  { createdAt: { gt: readState.readAt } },
                  ...(readState.lastReadMessageId
                    ? [{ createdAt: readState.readAt, id: { gt: readState.lastReadMessageId } }]
                    : [])
                ]
              }
            : {})
        };
      });
    const unreadRows: Array<{ conversationId: string; _count: { _all: number } }> = unreadConditions.length
      ? await (this.prisma.message as any).groupBy({
          by: ["conversationId"],
          where: { OR: unreadConditions },
          _count: { _all: true }
        })
      : [];
    const unreadByConversation = new Map(
      unreadRows.map((row) => [row.conversationId, Number(row._count?._all ?? 0)])
    );

    const items = await Promise.all(
      conversations.map(async (conversation: any) => {
        const isCustomer = conversation.userId === userId;
        const conversationBlockedByYou = conversation.blocks.some((block: any) => block.blockedByUserId === userId);
        const messageHistoryAvailable = conversation.blocks.length === 0;
        const messageInteractionAvailable = messageHistoryAvailable
          && await this.hasCurrentMessageInteractionWindow(conversation.id);
        const unreadCount = !messageHistoryAvailable
          ? 0
          : unreadByConversation.get(conversation.id) ?? 0;

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
          lastMessage: messageHistoryAvailable && conversation.messages[0]
            ? await this.toMessageDto(
                conversation.messages[0],
                isCustomer ? conversation.externalId : conversation.id
              )
            : null,
          unreadCount,
          // This field is selected with the viewer's user id, so neither
          // participant can learn the other participant's private preference.
          messageNotificationsMuted: Boolean(conversation.notificationPreferences[0]?.mutedAt),
          conversationBlockedByYou,
          messageHistoryAvailable,
          messageInteractionAvailable,
          updatedAt: conversation.updatedAt.toISOString()
        };
      })
    );

    return {
      conversations: items,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    };
  }

  async setMessageNotificationsMuted(
    userId: string,
    externalId: string,
    dto: SetConversationNotificationPreferenceDto
  ) {
    const conversation = await this.ensureConversation(userId, externalId);
    if (dto.muted) {
      await this.prisma.conversationNotificationPreference.upsert({
        where: { conversationId_userId: { conversationId: conversation.id, userId } },
        create: { conversationId: conversation.id, userId, mutedAt: new Date() },
        update: { mutedAt: new Date() }
      } as any);
    } else {
      // The default is enabled. Removing the row restores it and avoids
      // retaining an unnecessary unmuted-conversation behavior record.
      await this.prisma.conversationNotificationPreference.deleteMany({
        where: { conversationId: conversation.id, userId }
      } as any);
    }
    return { messageNotificationsMuted: dto.muted };
  }

  async setConversationBlocked(userId: string, externalId: string, dto: SetConversationBlockDto) {
    const conversation = await this.ensureConversation(userId, externalId);
    return this.prisma.$transaction(async (tx) => {
      const db = tx as Db;
      await this.lockConversationBoundary(db, conversation.id);
      if (dto.blocked) {
        await db.conversationBlock.upsert({
          where: { conversationId_blockedByUserId: { conversationId: conversation.id, blockedByUserId: userId } },
          create: { conversationId: conversation.id, blockedByUserId: userId },
          update: {}
        });
        // Remove only the blocker's outstanding, content-free message notices.
        // Orders, support, moderation, and safety notifications remain intact.
        await db.notification.deleteMany({
          where: {
            userId,
            type: "messageReceived",
            eventKey: { startsWith: `conversation:${conversation.id}:` }
          }
        });
        await this.audit.record({
          actorId: userId,
          subjectUserIds: [conversation.userId, conversation.companion?.ownerUserId]
            .filter((subjectUserId): subjectUserId is string => Boolean(subjectUserId)),
          action: "conversation.blocked",
          resourceType: "conversation",
          resourceId: conversation.id,
          metadata: { scope: "message_interaction_only" }
        }, db);
      } else {
        const removed = await db.conversationBlock.deleteMany({
          where: { conversationId: conversation.id, blockedByUserId: userId }
        });
        if (removed.count) {
          await this.audit.record({
            actorId: userId,
            subjectUserIds: [conversation.userId, conversation.companion?.ownerUserId]
              .filter((subjectUserId): subjectUserId is string => Boolean(subjectUserId)),
            action: "conversation.unblocked",
            resourceType: "conversation",
            resourceId: conversation.id,
            metadata: { scope: "message_interaction_only" }
          }, db);
        }
      }
      const availability = await this.messageAvailability(conversation.id, db);
      return {
        conversationBlockedByYou: dto.blocked,
        ...availability
      };
    });
  }

  async setFutureBookingBoundary(
    userId: string,
    externalId: string,
    dto: SetFutureBookingBoundaryDto
  ) {
    const conversation = await this.ensureConversation(userId, externalId);
    if (conversation.companion.ownerUserId !== userId) {
      throw new AppException(
        "FUTURE_BOOKING_BOUNDARY_COMPANION_ONLY",
        "Only the companion may manage this private future-booking boundary",
        HttpStatus.FORBIDDEN
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const db = tx as Db;
      // Match order-intake lock order. Whichever transaction commits first owns
      // the boundary for that instant; an already-created order remains intact.
      await db.$queryRaw`SELECT "id" FROM "CompanionProfile" WHERE "id" = ${conversation.companionId} FOR UPDATE`;
      await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${conversation.userId} FOR UPDATE`;
      const key = {
        companionId: conversation.companionId,
        customerUserId: conversation.userId
      };
      const existing = await db.companionCustomerFutureBoundary.findUnique({
        where: { companionId_customerUserId: key },
        select: { id: true }
      });
      let changed = false;

      if (dto.declined && !existing) {
        await db.companionCustomerFutureBoundary.create({ data: key });
        changed = true;
      } else if (!dto.declined && existing) {
        await db.companionCustomerFutureBoundary.delete({ where: { id: existing.id } });
        changed = true;
      }

      if (changed) {
        const changedAt = new Date();
        // Invalidate every active cursor for this customer. Historical
        // impressions and existing order attribution remain immutable.
        await db.recommendationRequest.updateMany({
          where: { userId: conversation.userId, expiresAt: { gt: changedAt } },
          data: { expiresAt: changedAt }
        });
        await this.audit.record({
          actorId: userId,
          subjectUserIds: [userId, conversation.userId],
          action: dto.declined
            ? "conversation.future_booking_declined"
            : "conversation.future_booking_restored",
          resourceType: "conversation",
          resourceId: conversation.id,
          metadata: {
            scope: "new_orders_and_recommendations_only",
            existingOrdersUnaffected: true,
            conversationUnaffected: true
          }
        }, db);
      }

      return {
        viewerCanManageFutureBookingBoundary: true,
        futureBookingsDeclinedByYou: dto.declined,
        futureBookingBoundaryScope: "newOrdersAndRecommendationsOnly" as const,
        existingOrdersUnaffected: true,
        conversationUnaffected: true,
        changed
      };
    });
  }

  async messages(userId: string, externalId: string, query: ListMessagesQueryDto) {
    const conversation = await this.ensureConversation(userId, externalId);
    const limit = Math.min(query.limit ?? 50, 100);
    if (await this.findAnyConversationBlock(conversation.id)) {
      // Blocking does not delete records needed for audit, reporting, or an
      // eventual explicit unblock. It stops both sides from receiving or
      // displaying the conversation through ordinary message routes.
      return {
        messages: [],
        pagination: { limit, nextCursor: null, hasMore: false }
      };
    }
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
    // Reject attachments before any conversation lookup, moderation, message,
    // case, or notification work. A text-only surface must not make historical
    // upload rows reachable through the ordinary send endpoint.
    if (attachmentIds.length) this.mediaAssets.assertChatMediaUploadEnabled();

    await this.chatRestrictions.assertCanSend(userId);

    const conversation: any = await this.ensureConversation(userId, externalId);
    await this.assertConversationInteractionAvailable(conversation.id);
    const user: any = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true }
    } as any);
    if (!user) {
      throw new AppException("UNAUTHORIZED", "User not found", HttpStatus.UNAUTHORIZED);
    }
    // Real-time messaging requires the server identity signal before moderation,
    // message rows, cases, or notifications are written.
    assertPublicInteractionIdentity(user);
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
      await this.lockConversationBoundary(db, conversation.id);
      await this.assertConversationInteractionAvailable(conversation.id, db);
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

      // The authenticated sender is authoritative here. Never derive crisis
      // ownership from the recipient, conversation customer, or a later report.
      // The narrow signal excludes message content/id and commits atomically
      // with this delivery decision and its moderation evidence.
      await this.crisisIntervention.recordCriticalChatSignal(
        userId,
        { priority: moderation.priority, categories: moderation.categories },
        db
      );

      await db.conversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date(now + 3) }
      });

      if (moderationStatus === "published") {
        const recipientUserId = isCompanion ? conversation.userId : conversation.companion.ownerUserId;
        if (recipientUserId && recipientUserId !== userId) {
          // The notification helper receives only stable ids. It never reads
          // or renders this message's content, and persists no relation beyond
          // the existing paid conversation.
          await this.notifications.createConversationMessageReceivedIfUnmuted(db, {
            conversationId: conversation.id,
            messageId: message.id,
            recipientUserId,
            recipientConversationId: recipientUserId === conversation.userId
              ? conversation.externalId
              : conversation.id
          });
        }
      }

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
    await this.assertConversationInteractionAvailable(conversation.id);
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
    await this.assertConversationInteractionAvailable(conversation.id);
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
    });

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

  private async lockConversationBoundary(db: Db, conversationId: string) {
    if (typeof db.$queryRaw === "function") {
      await db.$queryRaw`SELECT "id" FROM "Conversation" WHERE "id" = ${conversationId} FOR UPDATE`;
    }
  }

  private async findAnyConversationBlock(conversationId: string, db: Db = this.prisma as any) {
    return db.conversationBlock.findFirst({
      where: { conversationId },
      select: { id: true }
    } as any);
  }

  private async assertConversationInteractionAvailable(conversationId: string, db: Db = this.prisma as any) {
    if (!(await this.messageAvailability(conversationId, db)).messageInteractionAvailable) {
      throw new AppException(
        "CONVERSATION_INTERACTION_UNAVAILABLE",
        "This conversation cannot receive new messages at this time",
        HttpStatus.FORBIDDEN
      );
    }
  }

  /**
   * A block is a privacy boundary and hides history. A closed service window is
   * different: the paid record remains readable for support, reporting, and
   * audit, but no new ordinary message may be created.
   */
  private async messageAvailability(conversationId: string, db: Db = this.prisma as any) {
    if (await this.findAnyConversationBlock(conversationId, db)) {
      return {
        messageHistoryAvailable: false,
        messageInteractionAvailable: false
      };
    }
    return {
      messageHistoryAvailable: true,
      messageInteractionAvailable: await this.hasCurrentMessageInteractionWindow(conversationId, db)
    };
  }

  private async hasCurrentMessageInteractionWindow(conversationId: string, db: Db = this.prisma as any) {
    const now = new Date();
    const preServiceWindowMinutes = this.orderChatPreServiceWindowMinutes();
    const postServiceWindowMinutes = this.orderChatPostServiceWindowMinutes();
    const rows = await db.$queryRaw<Array<{ available: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM "Order"
        WHERE "conversationId" = ${conversationId}
          AND "status"::text IN ('paid', 'inService')
          AND "durationMinutes" > 0
          AND ${now} >= LEAST(
            "scheduledAt" - (${preServiceWindowMinutes} * INTERVAL '1 minute'),
            COALESCE("serviceStartedAt", "scheduledAt")
          )
          AND ${now} < GREATEST(
            "scheduledAt",
            COALESCE("serviceStartedAt", "scheduledAt")
          ) + ("durationMinutes" * INTERVAL '1 minute')
            + (${postServiceWindowMinutes} * INTERVAL '1 minute')
      ) AS "available"
    `;
    return rows[0]?.available === true;
  }

  private orderChatPreServiceWindowMinutes(): number {
    return this.config?.get<number>(
      "ORDER_CHAT_PRE_SERVICE_WINDOW_MINUTES",
      DEFAULT_ORDER_CHAT_PRE_SERVICE_WINDOW_MINUTES
    ) ?? DEFAULT_ORDER_CHAT_PRE_SERVICE_WINDOW_MINUTES;
  }

  private orderChatPostServiceWindowMinutes(): number {
    return this.config?.get<number>(
      "ORDER_CHAT_POST_SERVICE_WINDOW_MINUTES",
      DEFAULT_ORDER_CHAT_POST_SERVICE_WINDOW_MINUTES
    ) ?? DEFAULT_ORDER_CHAT_POST_SERVICE_WINDOW_MINUTES;
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
