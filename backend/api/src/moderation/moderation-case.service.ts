import { HttpStatus, Injectable } from "@nestjs/common";

import { AuditService } from "../common/audit/audit.service";
import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { MediaAssetService } from "./media/media-asset.service";
import { ModerationResult, ModerationSource } from "./moderation.service";

export interface CreateModerationCaseInput {
  result: ModerationResult;
  source: ModerationSource;
  content: string;
  targetId?: string | null;
  messageId?: string | null;
  conversationId?: string | null;
  subjectUserId?: string | null;
  reporterUserId?: string | null;
  actorId?: string | null;
  title?: string;
  status?: "pending" | "autoReviewing" | "humanReview" | "resolved" | "dismissed";
  dueAt?: Date | null;
  assignedToUserId?: string | null;
  /** When true, create even if decision is allow (used for user reports). */
  forceCreate?: boolean;
  /** A user report is intake only and must not notify the reported subject. */
  notifySubject?: boolean;
  /** When provided, all case, evidence, notification, and audit writes use it. */
  db?: any;
}

export interface CreateReportCaseInput {
  result: ModerationResult;
  reason: string;
  content: string;
  targetId?: string | null;
  messageId?: string | null;
  conversationId?: string | null;
  subjectUserId?: string | null;
  actorId?: string | null;
  /** Use an existing outer transaction when report receipt and case must commit together. */
  db?: any;
  /** Allows intake callers to omit reporter prose from audit metadata. */
  auditMetadata?: Record<string, unknown>;
}

export interface AppendCommunityReportToCaseInput {
  caseId: string;
  reportId: string;
  postId: string;
  reporterUserId: string;
  reason: string;
  result: ModerationResult;
  /** Must share the caller's post/case-lock transaction. */
  db: any;
}

@Injectable()
export class ModerationCaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly mediaAssets: MediaAssetService
  ) {}

  async createFromResult(input: CreateModerationCaseInput): Promise<any | null> {
    const {
      result,
      source,
      content,
      targetId,
      messageId,
      conversationId,
      subjectUserId,
      reporterUserId,
      actorId,
      title,
      status,
      dueAt,
      assignedToUserId,
      forceCreate,
      notifySubject,
      db
    } = input;
    if (result.decision === "allow" && !forceCreate) {
      return null;
    }

    if (!db) {
      return this.prisma.$transaction(async (tx) => this.createFromResult({
        ...input,
        db: tx as any
      }));
    }

    const client = db;
    const created = await client.moderationCase.create({
      data: {
        title: title ?? this.caseTitle(result, content),
        category: this.categoryFor(source, result),
        riskLevel: result.riskLevel,
        status:
          status ??
          (result.priority === "critical"
            ? "humanReview"
            : result.decision === "review" || result.decision === "allow"
              ? "pending"
              : "humanReview"),
        source,
        content,
        targetId: targetId ?? null,
        messageId: messageId ?? null,
        automaticCaseKey: source === "chat" && messageId ? `chat:${messageId}` : null,
        conversationId: conversationId ?? null,
        subjectUserId: subjectUserId ?? null,
        reporterUserId: reporterUserId ?? null,
        priority: result.priority,
        dueAt: dueAt ?? this.defaultDueAt(result.priority),
        assignedToUserId: assignedToUserId ?? null,
        policyVersion: result.policyVersion,
        provider: result.provider ?? null,
        providerVersion: result.providerVersion ?? null,
        aiScore: result.score,
        aiReason: result.reasons.join("；"),
        decision: result.decision,
        matchedRules: result.matchedRules,
        usedAI: result.usedAI,
        evidences: {
          create: this.buildEvidences(result, content)
        },
        actionLogs: {
          create: {
            actorId: actorId ?? "system",
            action: "created",
            note: `decision=${result.decision}`
          }
        }
      },
      include: {
        evidences: true,
        actionLogs: true
      }
    } as any);

    if (messageId) {
      await this.mediaAssets.preserveEvidenceForMessage(
        messageId,
        "mediaAsset" in db ? db : undefined
      );
    }

    await this.afterCaseCreated(
      created,
      result,
      subjectUserId,
      actorId,
      conversationId,
      client,
      notifySubject !== false
    );

    return created;
  }

  async createReportCase(input: CreateReportCaseInput) {
    const {
      result,
      reason,
      content,
      targetId,
      messageId,
      conversationId,
      subjectUserId,
      actorId,
      db: providedDatabase,
      auditMetadata
    } = input;
    const status = result.score >= 0.55 ? "humanReview" : "pending";
    const create = async (db: any) => {
      const created = await this.createFromResult({
        result,
        source: "report",
        content,
        targetId,
        messageId,
        conversationId,
        subjectUserId,
        reporterUserId: actorId,
        actorId,
        title: `举报：${reason.slice(0, 40)}`,
        status,
        forceCreate: true,
        notifySubject: false,
        db
      });

      if (!created) {
        throw new Error("Expected report case creation to succeed");
      }

      if (actorId) {
        await this.audit.record({
          actorId,
          action: "create_report",
          resourceType: "moderation_case",
          resourceId: created.id,
          metadata: auditMetadata ?? {
            reason: reason.slice(0, 200),
            source: "report",
            decision: result.decision
          }
        }, db);
      }

      return created;
    };
    return providedDatabase ? create(providedDatabase) : this.prisma.$transaction(create);
  }

  /**
   * Adds a later independent community-report signal to an already open case.
   * It intentionally does not alter case status, decision, priority, the post,
   * or any user notification: joining staff evidence is not a disposition.
   */
  async appendCommunityReportToCase(input: AppendCommunityReportToCaseInput) {
    const { caseId, reportId, postId, reporterUserId, reason, result, db } = input;
    await db.moderationEvidence.create({
      data: {
        caseId,
        type: "community_report_attachment",
        payload: {
          reportId,
          reason: reason.slice(0, 500),
          moderation: {
            decision: result.decision,
            riskLevel: result.riskLevel,
            priority: result.priority,
            score: result.score,
            reasons: result.reasons,
            matchedRules: result.matchedRules,
            categories: result.categories,
            policyVersion: result.policyVersion
          }
        }
      }
    });
    await db.moderationActionLog.create({
      data: {
        caseId,
        actorId: reporterUserId,
        action: "community_report.attached",
        // Keep reporter prose in the evidence record only, not duplicated in
        // action-log summaries that are routinely scanned by operations.
        note: "An additional independent community report was attached."
      }
    });
    await this.audit.record({
      actorId: reporterUserId,
      action: "community.report_attached",
      resourceType: "moderation_case",
      resourceId: caseId,
      metadata: {
        source: "community_post_report",
        postId,
        reportId,
        attachedToExistingCase: true
      }
    }, db);
  }

  async createAppeal(input: { caseId: string; subjectUserId: string; reason: string }) {
    const item: any = await this.prisma.moderationCase.findUnique({
      where: { id: input.caseId },
      include: {
        restrictions: { where: { liftedAt: null }, take: 1 },
        actionLogs: { where: { action: "confirmViolation" }, take: 1 }
      }
    } as any);
    if (!item || item.subjectUserId !== input.subjectUserId) {
      // Do not disclose whether another account owns the case.
      throw new AppException("MODERATION_CASE_NOT_FOUND", "Moderation case was not found", HttpStatus.NOT_FOUND);
    }
    const appealEligible =
      item.decision === "block" ||
      (item.restrictions?.length ?? 0) > 0 ||
      (item.actionLogs?.length ?? 0) > 0;
    if (!appealEligible) {
      throw new AppException(
        "APPEAL_NOT_ELIGIBLE",
        "Only blocked content, confirmed violations, or chat restrictions can be appealed",
        HttpStatus.CONFLICT
      );
    }

    try {
      const appeal = await this.prisma.$transaction(async (tx) => {
        const db = tx as any;
        const created = await db.moderationAppeal.create({
          data: {
            caseId: item.id,
            subjectUserId: input.subjectUserId,
            reason: input.reason.trim()
          }
        });
        await db.moderationActionLog.create({
          data: {
            caseId: item.id,
            actorId: input.subjectUserId,
            action: "appeal.created",
            note: input.reason.trim()
          }
        });
        await db.auditLog.create({
          data: {
            actorId: input.subjectUserId,
            action: "moderation.appeal_created",
            resourceType: "moderation_case",
            resourceId: item.id,
            metadata: { appealId: created.id }
          }
        });
        return created;
      });
      return appeal;
    } catch (error: any) {
      if (error?.code === "P2002") {
        throw new AppException("APPEAL_ALREADY_EXISTS", "An appeal has already been submitted", HttpStatus.CONFLICT);
      }
      throw error;
    }
  }

  private async afterCaseCreated(
    created: { id: string },
    result: ModerationResult,
    subjectUserId?: string | null,
    actorId?: string | null,
    conversationId?: string | null,
    database: any = this.prisma,
    notifySubject = true
  ) {
    if (notifySubject && (subjectUserId ?? actorId)) {
      await this.notifications.create(
        subjectUserId ?? actorId!,
        "moderationAlert",
        "内容安全提醒",
        "你的内容已触发平台安全机制，请继续在平台内合规沟通。",
        {
          caseId: created.id,
          decision: result.decision,
          ...(conversationId ? { conversationId } : {})
        },
        database
      );
    }
    await this.audit.record({
      actorId: actorId ?? subjectUserId ?? "system",
      action: "moderation.case_created",
      resourceType: "moderation_case",
      resourceId: created.id,
      metadata: { decision: result.decision, riskLevel: result.riskLevel }
    }, database);
  }

  private buildEvidences(result: ModerationResult, content: string) {
    const evidences: Array<{ type: string; payload: Record<string, unknown> }> = [
      {
        type: "raw_text",
        payload: { text: content.slice(0, 500) }
      },
      {
        type: "rule_match",
        payload: {
          matchedRules: result.matchedRules,
          categories: result.categories,
          priority: result.priority,
          policyVersion: result.policyVersion,
          score: result.score,
          reasons: result.reasons
        }
      }
    ];

    if (result.usedAI) {
      evidences.push({
        type: "ai_score",
        payload: {
          score: result.score,
          reasons: result.reasons,
          categories: result.categories,
          provider: result.provider ?? null,
          providerVersion: result.providerVersion ?? null,
          usedAI: true
        }
      });
    }

    return evidences;
  }

  private categoryFor(source: ModerationSource, result: ModerationResult): string {
    if (source === "chat" && result.categories.some((category) => category !== "normal")) {
      return result.categories.filter((category) => category !== "normal").join("、");
    }
    switch (source) {
      case "chat":
        return "实时风控";
      case "community":
        return "广场内容";
      case "report":
        return "用户举报";
      case "profile":
        return "资料审核";
    }
  }

  private defaultDueAt(priority: ModerationResult["priority"]): Date | null {
    const now = Date.now();
    switch (priority) {
      case "critical":
        return new Date(now + 30 * 60 * 1000);
      case "high":
        return new Date(now + 2 * 60 * 60 * 1000);
      case "normal":
        return new Date(now + 24 * 60 * 60 * 1000);
    }
  }

  private caseTitle(result: ModerationResult, content: string): string {
    const prefix =
      result.decision === "block" ? "聊天拦截" : result.decision === "warn" ? "聊天预警" : "聊天待复核";
    return `${prefix}：${content.slice(0, 32)}`;
  }
}
