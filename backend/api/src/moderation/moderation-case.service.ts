import { HttpStatus, Injectable } from "@nestjs/common";

import { AuditService } from "../common/audit/audit.service";
import { AppException } from "../common/errors/app.exception";
import {
  MODERATION_APPEAL_POLICY_VERSION,
  MODERATION_APPEAL_SUBMISSION_DAYS,
  MODERATION_APPEALABLE_ACTIONS,
  moderationAppealDeadline,
  moderationAppealReviewDueAt
} from "../common/moderation-appeal-policy";
import { PrismaService } from "../database/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { MediaAssetService } from "./media/media-asset.service";
import { ListPersonalModerationDto, ListReporterCasesDto } from "./dto/list-personal-moderation.dto";
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
  subjectUserId: string;
  reason: string;
  result: ModerationResult;
  /** Must share the caller's post/case-lock transaction. */
  db: any;
}

const REPORTER_FOLLOW_UP_LIMIT = 5;

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
          subjectUserIds: [actorId, subjectUserId]
            .filter((candidate): candidate is string => Boolean(candidate)),
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

  async listReporterCases(
    reporterUserId: string,
    query: ListReporterCasesDto = new ListReporterCasesDto()
  ) {
    const where = { source: "report", reporterUserId };
    const [items, total] = await Promise.all([
      this.prisma.moderationCase.findMany({
        where,
        include: {
          actionLogs: {
            where: {
              action: {
                in: [
                  "confirmViolation", "dismiss", "approveMessage", "rejectMessage",
                  "restrict24h", "restrict7d", "liftRestriction", "upholdAppeal", "overturnAppeal"
                ]
              }
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1
          },
          _count: {
            select: {
              actionLogs: true,
              evidences: { where: { type: "reporter_follow_up" } }
            }
          }
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      } as any),
      this.prisma.moderationCase.count({ where } as any)
    ]);
    return {
      items: (items as any[]).map((item) => this.toReporterCaseDto(item, false)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize)
      }
    };
  }

  async getReporterCase(reporterUserId: string, caseId: string) {
    const item: any = await this.prisma.moderationCase.findFirst({
      where: {
        id: caseId,
        source: "report",
        reporterUserId
      },
      include: {
        actionLogs: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 20
        },
        evidences: {
          where: { type: "reporter_follow_up" },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }]
        },
        _count: { select: { actionLogs: true } }
      }
    } as any);
    if (!item) {
      // Use one non-probing response for missing and other users' reports.
      throw new AppException("REPORT_CASE_NOT_FOUND", "Report case was not found", HttpStatus.NOT_FOUND);
    }
    return this.toReporterCaseDto(item);
  }

  async addReporterFollowUp(reporterUserId: string, caseId: string, statement: string) {
    const normalizedStatement = statement.trim();
    if (normalizedStatement.length < 5 || normalizedStatement.length > 500) {
      throw new AppException(
        "REPORT_FOLLOW_UP_INVALID",
        "Report follow-up must contain between 5 and 500 non-whitespace characters",
        HttpStatus.BAD_REQUEST
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      if (typeof db.$queryRaw === "function") {
        await db.$queryRaw`SELECT "id" FROM "ModerationCase" WHERE "id" = ${caseId} FOR UPDATE`;
      }
      const item = await db.moderationCase.findFirst({
        where: {
          id: caseId,
          source: "report",
          reporterUserId
        }
      });
      if (!item) {
        throw new AppException("REPORT_CASE_NOT_FOUND", "Report case was not found", HttpStatus.NOT_FOUND);
      }
      if (!["pending", "autoReviewing", "humanReview"].includes(item.status)) {
        throw new AppException(
          "REPORT_CASE_CLOSED",
          "Resolved report cases cannot receive additional information",
          HttpStatus.CONFLICT
        );
      }
      const existingFollowUps = await db.moderationEvidence.count({
        where: { caseId, type: "reporter_follow_up" }
      });
      if (existingFollowUps >= REPORTER_FOLLOW_UP_LIMIT) {
        throw new AppException(
          "REPORT_FOLLOW_UP_LIMIT_REACHED",
          "This report already has the maximum number of follow-up statements",
          HttpStatus.CONFLICT,
          { limit: REPORTER_FOLLOW_UP_LIMIT }
        );
      }
      const evidence = await db.moderationEvidence.create({
        data: {
          caseId,
          type: "reporter_follow_up",
          payload: { statement: normalizedStatement }
        }
      });
      await db.moderationActionLog.create({
        data: {
          caseId,
          actorId: reporterUserId,
          reviewerId: null,
          action: "reporter.follow_up_added",
          note: "The reporter added private follow-up information."
        }
      });
      await this.audit.record({
        actorId: reporterUserId,
        subjectUserIds: [reporterUserId, item.subjectUserId]
          .filter((candidate): candidate is string => Boolean(candidate)),
        action: "moderation.report_follow_up_added",
        resourceType: "moderation_case",
        resourceId: caseId,
        metadata: { evidenceId: evidence.id }
      }, db);
      return {
        id: evidence.id,
        statement: normalizedStatement,
        createdAt: evidence.createdAt.toISOString()
      };
    });
  }

  /**
   * Adds a later independent community-report signal to an already open case.
   * It intentionally does not alter case status, decision, priority, the post,
   * or any user notification: joining staff evidence is not a disposition.
   */
  async appendCommunityReportToCase(input: AppendCommunityReportToCaseInput) {
    const { caseId, reportId, postId, reporterUserId, subjectUserId, reason, result, db } = input;
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
      subjectUserIds: [reporterUserId, subjectUserId],
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
        actionLogs: {
          where: { action: { in: [...MODERATION_APPEALABLE_ACTIONS] } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1
        }
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
    const now = new Date();
    const appealDeadlineAt = item.appealDeadlineAt
      ?? moderationAppealDeadline(item.resolvedAt ?? item.createdAt);
    if (appealDeadlineAt.getTime() <= now.getTime()) {
      throw new AppException(
        "MODERATION_APPEAL_WINDOW_CLOSED",
        "The moderation appeal submission window has closed",
        HttpStatus.CONFLICT,
        { appealDeadlineAt: appealDeadlineAt.toISOString() }
      );
    }
    const reviewDueAt = moderationAppealReviewDueAt(now);
    const originalReviewerId = item.actionLogs?.[0]?.reviewerId ?? null;

    try {
      const appeal = await this.prisma.$transaction(async (tx) => {
        const db = tx as any;
        const created = await db.moderationAppeal.create({
          data: {
            caseId: item.id,
            subjectUserId: input.subjectUserId,
            reason: input.reason.trim(),
            originalReviewerId,
            reviewDueAt,
            policyVersion: MODERATION_APPEAL_POLICY_VERSION
          }
        });
        await db.moderationCase.update({
          where: { id: item.id },
          data: {
            status: "humanReview",
            dueAt: reviewDueAt,
            resolvedAt: null,
            assignedToUserId: null,
            appealDeadlineAt,
            appealPolicyVersion: MODERATION_APPEAL_POLICY_VERSION
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
        await this.audit.record({
          actorId: input.subjectUserId,
          subjectUserIds: [input.subjectUserId],
          action: "moderation.appeal_created",
          resourceType: "moderation_case",
          resourceId: item.id,
          metadata: {
            appealId: created.id,
            appealDeadlineAt: appealDeadlineAt.toISOString(),
            reviewDueAt: reviewDueAt.toISOString(),
            policyVersion: MODERATION_APPEAL_POLICY_VERSION,
            independentReviewRequired: Boolean(originalReviewerId)
          }
        }, db);
        await this.notifications.create(
          input.subjectUserId,
          "moderationAlert",
          "内容申诉已进入独立复核",
          `平台计划在 ${reviewDueAt.toISOString()} 前完成复核；可在安全中心查看进度。`,
          {
            caseId: item.id,
            appealId: created.id,
            status: "pending",
            reviewDueAt: reviewDueAt.toISOString()
          },
          db
        );
        return created;
      });
      return { ...appeal, appealDeadlineAt };
    } catch (error: any) {
      if (error?.code === "P2002") {
        throw new AppException("APPEAL_ALREADY_EXISTS", "An appeal has already been submitted", HttpStatus.CONFLICT);
      }
      throw error;
    }
  }

  async listAppealsForUser(
    subjectUserId: string,
    query: ListPersonalModerationDto = Object.assign(new ListPersonalModerationDto(), { page: 1, pageSize: 20 })
  ) {
    const now = new Date();
    const where = {
      subjectUserId,
      ...(query.appealId ? { id: query.appealId } : {}),
      ...(query.caseId ? { caseId: query.caseId } : {}),
      ...(query.status ? { status: query.status } : {})
    };
    const [items, total]: [any[], number] = await Promise.all([
      this.prisma.moderationAppeal.findMany({
      where,
      include: {
        case: {
          select: {
            appealDeadlineAt: true,
            appealPolicyVersion: true
          }
        }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize
    } as any),
      this.prisma.moderationAppeal.count({ where } as any)
    ]);
    return {
      items: items.map((appeal) => ({
        id: appeal.id,
        caseId: appeal.caseId,
        status: appeal.status,
        reason: appeal.reason,
        appealDeadlineAt: appeal.case?.appealDeadlineAt?.toISOString?.() ?? null,
        reviewDueAt: appeal.reviewDueAt.toISOString(),
        overdue: appeal.status === "pending" && appeal.reviewDueAt.getTime() <= now.getTime(),
        policyVersion: appeal.policyVersion
          ?? appeal.case?.appealPolicyVersion
          ?? MODERATION_APPEAL_POLICY_VERSION,
        resolution: appeal.status === "overturned"
          ? "申诉成立，相关处置已撤销"
          : appeal.status === "upheld"
            ? "复核后维持原处置"
            : appeal.status === "dismissed"
              ? "申诉已结束"
              : null,
        reviewedAt: appeal.reviewedAt?.toISOString?.() ?? null,
        createdAt: appeal.createdAt.toISOString()
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize)
      }
    };
  }

  async listAppealableCasesForUser(
    subjectUserId: string,
    query: ListPersonalModerationDto = Object.assign(new ListPersonalModerationDto(), { page: 1, pageSize: 20 })
  ) {
    const now = new Date();
    const legacyCutoff = new Date(
      now.getTime() - MODERATION_APPEAL_SUBMISSION_DAYS * 24 * 60 * 60_000
    );
    const where: any = {
        subjectUserId,
        ...(query.caseId ? { id: query.caseId } : {}),
        ...(query.restrictionId ? { restrictions: { some: { id: query.restrictionId } } } : {}),
        appeals: { none: {} },
        AND: [
          {
            OR: [
              { decision: "block" },
              { restrictions: { some: { liftedAt: null } } },
              { actionLogs: { some: { action: { in: [...MODERATION_APPEALABLE_ACTIONS] } } } }
            ]
          },
          {
            OR: [
              { appealDeadlineAt: { gt: now } },
              { appealDeadlineAt: null, resolvedAt: { gt: legacyCutoff } },
              { appealDeadlineAt: null, resolvedAt: null, createdAt: { gt: legacyCutoff } }
            ]
          }
        ]
      };
    const [items, total]: [any[], number] = await Promise.all([
      this.prisma.moderationCase.findMany({
      where,
      include: {
        restrictions: {
          where: { liftedAt: null },
          orderBy: { createdAt: "desc" },
          take: 1
        },
        actionLogs: {
          where: { action: { in: [...MODERATION_APPEALABLE_ACTIONS] } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1
        }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize
    } as any),
      this.prisma.moderationCase.count({ where } as any)
    ]);

    return {
      items: items.flatMap((item) => {
        const appealDeadlineAt = item.appealDeadlineAt
          ?? moderationAppealDeadline(item.resolvedAt ?? item.createdAt);
        if (appealDeadlineAt.getTime() <= now.getTime()) return [];
        const action = item.actionLogs?.[0]?.action ?? null;
        const restriction = item.restrictions?.[0] ?? null;
        const kind = restriction
          ? "chatRestriction"
          : action === "restrict24h" || action === "restrict7d"
            ? "chatRestriction"
            : "contentAction";
        return [{
          caseId: item.id,
          kind,
          source: item.source,
          summary: kind === "chatRestriction"
            ? "聊天发送功能受到限制"
            : action === "confirmViolation"
              ? "内容经人工复核后被处置"
              : "内容未送达或已被移除",
          contentPreview: String(item.content ?? "").slice(0, 160),
          restrictionEndsAt: restriction?.endsAt?.toISOString?.() ?? null,
          appealDeadlineAt: appealDeadlineAt.toISOString(),
          policyVersion: item.appealPolicyVersion ?? MODERATION_APPEAL_POLICY_VERSION,
          createdAt: item.createdAt.toISOString()
        }];
      }),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize)
      }
    };
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
      subjectUserIds: [subjectUserId ?? actorId]
        .filter((candidate): candidate is string => Boolean(candidate)),
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

  private toReporterCaseDto(item: any, includeFollowUps = true) {
    const finalAction = (item.actionLogs ?? []).find((log: any) => [
      "confirmViolation",
      "dismiss",
      "approveMessage",
      "rejectMessage",
      "restrict24h",
      "restrict7d",
      "liftRestriction",
      "upholdAppeal",
      "overturnAppeal"
    ].includes(log.action));
    const outcome = !["resolved", "dismissed"].includes(item.status)
      ? item.status === "humanReview" || item.status === "autoReviewing" ? "reviewing" : "received"
      : ["confirmViolation", "rejectMessage", "restrict24h", "restrict7d", "upholdAppeal"].includes(finalAction?.action)
        ? "actionTaken"
        : "closed";
    const outcomeSummary = outcome === "actionTaken"
      ? "平台已完成复核并采取相应处置。为保护双方隐私，不展示内部规则或对方账号信息。"
      : outcome === "closed"
        ? "平台已完成复核，本案件现已关闭。"
        : outcome === "reviewing"
          ? "案件正在由独立审核部门复核。"
          : "平台已收到举报，等待进入复核队列。";
    const summary = {
      id: item.id,
      category: item.category,
      riskLevel: item.riskLevel,
      priority: item.priority,
      status: item.status,
      outcome,
      outcomeSummary,
      submittedSummary: this.reporterSubmittedSummary(item),
      dueAt: item.dueAt?.toISOString?.() ?? null,
      resolvedAt: item.resolvedAt?.toISOString?.() ?? null,
      createdAt: item.createdAt.toISOString(),
      followUpCount: item._count?.evidences ?? item.evidences?.length ?? 0,
      actionHistoryWindow: {
        limit: 20,
        total: item._count?.actionLogs ?? item.actionLogs?.length ?? 0,
        hasMore: (item._count?.actionLogs ?? item.actionLogs?.length ?? 0) > 20,
        purpose: "outcomeSummaryOnly"
      }
    };
    if (!includeFollowUps) return summary;
    return {
      ...summary,
      followUps: (item.evidences ?? []).map((evidence: any) => ({
        id: evidence.id,
        statement: typeof evidence.payload?.statement === "string" ? evidence.payload.statement : "",
        createdAt: evidence.createdAt.toISOString()
      }))
    };
  }

  private reporterSubmittedSummary(item: any): string | null {
    // Report content may also contain a bounded server-selected conversation
    // context. Only return the reporter's first-line reason to the owner; never
    // expose the context, subject identity, model output, or internal notes.
    const firstLine = typeof item.content === "string" ? item.content.split("\n", 1)[0] : "";
    const fromContent = firstLine.startsWith("举报原因：") ? firstLine.slice("举报原因：".length) : "";
    const fromTitle = typeof item.title === "string" && item.title.startsWith("举报：")
      ? item.title.slice("举报：".length)
      : "";
    const normalized = (fromContent || fromTitle)
      .replace(/[\u0000-\u001F\u007F]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
    return normalized || null;
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
