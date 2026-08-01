import { HttpStatus, Injectable } from "@nestjs/common";

import { AuditService } from "../common/audit/audit.service";
import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";

const AUTO_STRIKE_WINDOW_MS = 24 * 60 * 60 * 1000;
const AUTO_RESTRICTION_MS = 24 * 60 * 60 * 1000;
const MANUAL_CONFIRM_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class ChatRestrictionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService
  ) {}

  async assertCanSend(userId: string) {
    const restriction = await this.activeForUser(userId);
    if (!restriction) return;

    throw new AppException(
      "CHAT_RESTRICTED",
      `Chat sending is restricted until ${restriction.endsAt.toISOString()}`,
      HttpStatus.FORBIDDEN,
      { endsAt: restriction.endsAt.toISOString(), reason: restriction.reason }
    );
  }

  async activeForUser(userId: string, database: any = this.prisma) {
    const now = new Date();
    return database.chatRestriction.findFirst({
      where: {
        userId,
        startsAt: { lte: now },
        endsAt: { gt: now },
        liftedAt: null
      },
      orderBy: { endsAt: "desc" }
    } as any);
  }

  /** Two high-risk blocks in 24 hours result in a chat-only 24 hour restriction. */
  async recordAutomaticHighRiskBlock(userId: string, caseId: string, database: any = this.prisma) {
    const apply = async (db: any) => {
      // Serialize the rolling strike check per account. Concurrent blocked
      // messages must not both miss the threshold before either commits.
      if (typeof db.$queryRaw === "function") {
        await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      }
      const existing = await this.activeForUser(userId, db);
      if (existing) return existing;

      const since = new Date(Date.now() - AUTO_STRIKE_WINDOW_MS);
      const strikes = await db.moderationCase.count({
        where: {
          subjectUserId: userId,
          decision: "block",
          riskLevel: "high",
          createdAt: { gte: since }
        }
      } as any);
      if (strikes < 2) return null;

      return this.createRestriction({
        userId,
        caseId,
        source: "automatic",
        reason: "24 小时内多次高风险聊天内容被拦截",
        endsAt: new Date(Date.now() + AUTO_RESTRICTION_MS),
        actorId: "system"
      }, db);
    };
    if (database === this.prisma) {
      return this.prisma.$transaction(async (tx) => apply(tx as any));
    }
    return apply(database);
  }

  async createRestriction(input: {
    userId: string;
    caseId?: string | null;
    source: "automatic" | "manual";
    reason: string;
    endsAt: Date;
    actorId?: string | null;
  }, database: any = this.prisma) {
    const restriction = await database.chatRestriction.create({
      data: {
        userId: input.userId,
        caseId: input.caseId ?? null,
        source: input.source,
        reason: input.reason,
        endsAt: input.endsAt
      }
    } as any);
    await this.audit.record({
      actorId: input.actorId ?? "system",
      subjectUserIds: [input.userId],
      action: "moderation.chat_restriction_created",
      resourceType: "chat_restriction",
      resourceId: restriction.id,
      metadata: {
        userId: input.userId,
        caseId: input.caseId ?? null,
        source: input.source,
        endsAt: input.endsAt.toISOString()
      }
    }, database);
    await this.notifications.create(
      input.userId,
      "moderationAlert",
      "聊天功能暂时受限",
      "检测到重复高风险内容，聊天发送功能将暂时受限。",
      { restrictionId: restriction.id, endsAt: input.endsAt.toISOString(), caseId: input.caseId ?? null },
      database
    );
    return restriction;
  }

  /**
   * Three independent staff confirmations within 30 days do not auto-ban the
   * account. They reopen the latest case as a critical human-disposition task,
   * leaving any global account action to an authorized reviewer.
   */
  async recordManualConfirmedViolation(
    userId: string,
    caseId: string,
    actorId: string,
    database: any = this.prisma
  ) {
    const since = new Date(Date.now() - MANUAL_CONFIRM_WINDOW_MS);
    const confirmations = await database.moderationActionLog.count({
      where: {
        action: "confirmViolation",
        createdAt: { gte: since },
        case: { subjectUserId: userId }
      }
    } as any);
    if (confirmations < 3) return { escalated: false, confirmations };

    const escalate = async (db: any) => {
      await db.moderationCase.update({
        where: { id: caseId },
        data: { status: "humanReview", priority: "critical", resolvedAt: null }
      });
      await db.moderationActionLog.create({
        data: {
          caseId,
          actorId: "system",
          action: "manual_escalation_required",
          note: "30 天内已累计三次人工确认违规，需审核员决定是否采用既有全局账号处置。"
        }
      });
      await this.audit.record({
        actorId,
        subjectUserIds: [userId],
        action: "moderation.manual_escalation_required",
        resourceType: "moderation_case",
        resourceId: caseId,
        metadata: { userId, confirmations, windowDays: 30 }
      }, db);
    };
    if (database === this.prisma) {
      await this.prisma.$transaction(async (tx) => escalate(tx as any));
    } else {
      await escalate(database);
    }
    return { escalated: true, confirmations };
  }

  async liftForCase(caseId: string, actorId: string, note?: string, database: any = this.prisma) {
    const now = new Date();
    const restrictedSubject = await database.chatRestriction.findFirst({
      where: { caseId, liftedAt: null, endsAt: { gt: now } },
      select: { userId: true }
    } as any);
    const result = await database.chatRestriction.updateMany({
      where: { caseId, liftedAt: null, endsAt: { gt: now } },
      data: { liftedAt: now, liftedByUserId: actorId }
    } as any);
    if (result.count) {
      if (!restrictedSubject?.userId) {
        throw new Error("Lifted chat restriction is missing its subject user");
      }
      await this.audit.record({
        actorId,
        subjectUserIds: [restrictedSubject.userId],
        action: "moderation.chat_restriction_lifted",
        resourceType: "moderation_case",
        resourceId: caseId,
        metadata: { note: note?.trim() || null, count: result.count }
      }, database);
    }
    return result.count;
  }
}
