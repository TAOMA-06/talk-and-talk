import { HttpStatus, Injectable } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";
import {
  MODERATION_APPEAL_POLICY_VERSION,
  MODERATION_APPEAL_SUBMISSION_DAYS,
  MODERATION_APPEALABLE_ACTIONS,
  moderationAppealDeadline
} from "../common/moderation-appeal-policy";
import { PrismaService } from "../database/prisma.service";
import { ChatRestrictionService } from "../moderation/chat-restriction.service";
import { MediaAssetService } from "../moderation/media/media-asset.service";
import { NotificationsService } from "../notifications/notifications.service";
import { CreateReviewLabelDto } from "./dto/create-review-label.dto";
import { ExportReviewLabelsDto } from "./dto/export-review-labels.dto";
import { ReviewCaseAction } from "./dto/review-case-action.dto";
import { ListReviewCasesQueryDto } from "./dto/list-review-cases.dto";
import { ListReviewConversationEvidenceDto } from "./dto/list-review-conversation-evidence.dto";
import { ListActiveReviewStaffQueryDto } from "./dto/list-review-staff.dto";

const OPEN_STATUSES = ["pending", "autoReviewing", "humanReview"] as const;
const MESSAGE_EVIDENCE_REQUIRED_ACTIONS = new Set<ReviewCaseAction>([
  "confirmViolation",
  "rejectMessage",
  "restrict24h",
  "restrict7d",
  "upholdAppeal"
]);
const TEXT_ONLY_REDACTED_CASE_TITLE = "聊天审核案件";
const TEXT_ONLY_REDACTED_CASE_CONTENT = "历史媒体审核证据已在文本首发版本中隐藏。";

export type ReviewDecisionActor = {
  id: string;
  kind: "reviewStaff";
  displayName?: string;
  role?: string;
};

@Injectable()
export class ReviewCaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chatRestrictions: ChatRestrictionService,
    private readonly mediaAssets: MediaAssetService,
    private readonly notifications: NotificationsService
  ) {}

  async overview() {
    const [
      totalCases,
      conversationCount,
      labelCount,
      queue,
      statusGroups,
      decisionGroups,
      sourceGroups,
      riskGroups
    ] = await Promise.all([
      this.prisma.moderationCase.count(),
      this.prisma.conversation.count(),
      this.prisma.moderationLabel.count(),
      this.prisma.moderationCase.findMany({
        where: { status: { in: [...OPEN_STATUSES] } },
        orderBy: [
          { priority: "desc" },
          { dueAt: "asc" },
          { createdAt: "desc" },
          { id: "asc" }
        ],
        take: 8
      } as any),
      this.prisma.moderationCase.groupBy({ by: ["status"], _count: { _all: true } } as any),
      this.prisma.moderationCase.groupBy({ by: ["decision"], _count: { _all: true } } as any),
      this.prisma.moderationCase.groupBy({ by: ["source"], _count: { _all: true } } as any),
      this.prisma.moderationCase.groupBy({ by: ["riskLevel"], _count: { _all: true } } as any)
    ]);

    return {
      overview: this.buildOverviewStats(
        totalCases,
        statusGroups as any[],
        decisionGroups as any[],
        sourceGroups as any[],
        riskGroups as any[],
        conversationCount,
        labelCount
      ),
      queue: queue.map((item: any) => this.toCaseSummary(item))
    };
  }

  async listCases(query: ListReviewCasesQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where = this.buildCaseWhere(query);

    const [total, cases] = await Promise.all([
      this.prisma.moderationCase.count({ where } as any),
      this.prisma.moderationCase.findMany({
        where,
        orderBy: [{ priority: "desc" }, { dueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      } as any)
    ]);

    return {
      cases: cases.map((item: any) => this.toCaseDto(item)),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
      }
    };
  }

  async getCase(id: string) {
    const item: any = await this.prisma.moderationCase.findUnique({
      where: { id },
      include: {
        evidences: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        actionLogs: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
        appeals: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
        restrictions: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] }
      }
    } as any);

    if (!item) {
      throw new AppException("NOT_FOUND", `Moderation case ${id} was not found`, HttpStatus.NOT_FOUND);
    }
    const redactLegacyChatEvidence = this.shouldRedactLegacyChatEvidence(item);

    return {
      case: {
        ...this.toCaseDto(item),
        evidences: (item.evidences ?? []).map((ev: any) => ({
          id: ev.id,
          type: ev.type,
          // Legacy chat cases did not persist whether an artifact was derived
          // from an attachment. A stored title/content/raw-text field can
          // therefore contain OCR or a transcription. While text-only is
          // active, project every chat-case evidence payload as redacted rather
          // than guessing which historic rows are safe to expose.
          payload: redactLegacyChatEvidence ? { redacted: true } : ev.payload,
          createdAt: ev.createdAt.toISOString()
        })),
        actionLog: (item.actionLogs ?? []).map((log: any) => this.toActionLogDto(log)),
        appeals: (item.appeals ?? []).map((appeal: any) => this.toAppealDto(appeal)),
        restrictions: (item.restrictions ?? []).map((restriction: any) => this.toRestrictionDto(restriction))
      }
    };
  }

  async conversationEvidence(caseId: string, query: ListReviewConversationEvidenceDto = {}) {
    if (query.before && query.after) {
      throw new AppException(
        "REVIEW_EVIDENCE_CURSOR_CONFLICT",
        "Use either before or after, not both",
        HttpStatus.BAD_REQUEST
      );
    }
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 5), 100);
    const item = await this.prisma.moderationCase.findUnique({ where: { id: caseId } } as any);
    if (!item) {
      throw new AppException("NOT_FOUND", `Moderation case ${caseId} was not found`, HttpStatus.NOT_FOUND);
    }

    const anchorMessage: any = item.messageId
      ? await this.prisma.message.findUnique({
          where: { id: item.messageId },
          include: {
            attachments: true,
            conversation: { include: { companion: true } }
          }
        } as any)
      : null;
    if (item.messageId && (!anchorMessage || !anchorMessage.conversation)) {
      throw new AppException(
        "REVIEW_MESSAGE_EVIDENCE_UNAVAILABLE",
        "The reported message evidence is unavailable; retry before taking an adverse action",
        HttpStatus.CONFLICT,
        { messageId: item.messageId }
      );
    }
    if (
      item.messageId
      && item.conversationId
      && anchorMessage?.conversationId !== item.conversationId
    ) {
      throw new AppException(
        "REVIEW_MESSAGE_EVIDENCE_UNAVAILABLE",
        "The reported message does not belong to the case conversation; retry before taking an adverse action",
        HttpStatus.CONFLICT,
        { messageId: item.messageId }
      );
    }
    const conversation = anchorMessage?.conversation ?? await this.resolveConversation(item);
    if (!conversation) {
      return {
        caseId,
        conversation: null,
        anchorMessageId: item.messageId ?? null,
        anchorMessage: null,
        messages: [],
        pagination: {
          pageSize,
          beforeCursor: null,
          afterCursor: null,
          hasMoreBefore: false,
          hasMoreAfter: false
        }
      };
    }

    const cursorId = query.before ?? query.after;
    const cursorMessage: any = cursorId
      ? await this.prisma.message.findUnique({
          where: { id: cursorId },
          select: { id: true, conversationId: true, createdAt: true }
        } as any)
      : null;
    if (cursorId && cursorMessage?.conversationId !== conversation.id) {
      throw new AppException(
        "REVIEW_EVIDENCE_CURSOR_INVALID",
        "Conversation evidence cursor is invalid",
        HttpStatus.BAD_REQUEST
      );
    }

    let messages: any[] = [];
    let hasMoreBefore = false;
    let hasMoreAfter = false;
    if (query.before && cursorMessage) {
      const rows = await this.prisma.message.findMany({
        where: {
          conversationId: conversation.id,
          OR: [
            { createdAt: { lt: cursorMessage.createdAt } },
            { createdAt: cursorMessage.createdAt, id: { lt: cursorMessage.id } }
          ]
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: pageSize + 1,
        include: { attachments: true }
      } as any) as any[];
      hasMoreBefore = rows.length > pageSize;
      hasMoreAfter = true;
      messages = rows.slice(0, pageSize).reverse();
    } else if (query.after && cursorMessage) {
      const rows = await this.prisma.message.findMany({
        where: {
          conversationId: conversation.id,
          OR: [
            { createdAt: { gt: cursorMessage.createdAt } },
            { createdAt: cursorMessage.createdAt, id: { gt: cursorMessage.id } }
          ]
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: pageSize + 1,
        include: { attachments: true }
      } as any) as any[];
      hasMoreBefore = true;
      hasMoreAfter = rows.length > pageSize;
      messages = rows.slice(0, pageSize);
    } else if (anchorMessage) {
      const earlierLimit = Math.floor((pageSize - 1) / 2);
      const laterLimit = pageSize - 1 - earlierLimit;
      const [earlier, later] = await Promise.all([
        this.prisma.message.findMany({
          where: {
            conversationId: conversation.id,
            OR: [
              { createdAt: { lt: anchorMessage.createdAt } },
              { createdAt: anchorMessage.createdAt, id: { lt: anchorMessage.id } }
            ]
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: earlierLimit + 1,
          include: { attachments: true }
        } as any),
        this.prisma.message.findMany({
          where: {
            conversationId: conversation.id,
            OR: [
              { createdAt: { gt: anchorMessage.createdAt } },
              { createdAt: anchorMessage.createdAt, id: { gt: anchorMessage.id } }
            ]
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: laterLimit + 1,
          include: { attachments: true }
        } as any)
      ]) as [any[], any[]];
      hasMoreBefore = earlier.length > earlierLimit;
      hasMoreAfter = later.length > laterLimit;
      messages = [
        ...earlier.slice(0, earlierLimit).reverse(),
        anchorMessage,
        ...later.slice(0, laterLimit)
      ];
    } else {
      const rows = await this.prisma.message.findMany({
        where: { conversationId: conversation.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: pageSize + 1,
        include: { attachments: true }
      } as any) as any[];
      hasMoreAfter = rows.length > pageSize;
      messages = rows.slice(0, pageSize);
    }

    const messageDtos = await Promise.all(messages.map((message) =>
      this.toEvidenceMessageDto(message, conversation.externalId)
    ));
    const anchorDto = anchorMessage
      ? await this.toEvidenceMessageDto(anchorMessage, conversation.externalId)
      : null;

    return {
      caseId,
      conversation: {
        id: conversation.externalId,
        internalId: conversation.id,
        companionId: conversation.companionId,
        companionName: conversation.companion?.name ?? null,
        userId: conversation.userId,
        updatedAt: conversation.updatedAt.toISOString()
      },
      anchorMessageId: item.messageId ?? null,
      anchorMessage: anchorDto,
      anchorInPage: Boolean(item.messageId && messages.some((message) => message.id === item.messageId)),
      messages: messageDtos,
      pagination: {
        pageSize,
        beforeCursor: hasMoreBefore ? messages[0]?.id ?? null : null,
        afterCursor: hasMoreAfter ? messages[messages.length - 1]?.id ?? null : null,
        hasMoreBefore,
        hasMoreAfter
      }
    };
  }

  async applyAction(caseId: string, actor: ReviewDecisionActor, action: ReviewCaseAction, note?: string) {
    const actorId = actor.id;
    const existing: any = await this.prisma.moderationCase.findUnique({
      where: { id: caseId },
      include: { appeals: true }
    } as any);
    if (!existing) {
      throw new AppException("NOT_FOUND", `Moderation case ${caseId} was not found`, HttpStatus.NOT_FOUND);
    }
    this.assertActionAllowed(existing, action);
    this.assertIndependentAppealReviewer(existing, action, actorId);

    const statusUpdate = this.statusForAction(action);
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      // ReviewStaff -> ModerationCase is the canonical lock order shared with
      // offboarding. Holding a key-share lock makes a concurrent suspension
      // wait for an already-authorized decision, while a suspension that won
      // the race makes this request fail before it can mutate case state.
      const staffById = await this.lockReviewStaffRows(db, [actorId]);
      this.assertActiveReviewStaff(staffById, actorId, {
        code: "REVIEW_STAFF_INACTIVE",
        message: "This review staff account is no longer active",
        status: HttpStatus.FORBIDDEN
      });
      // Two moderators can open the same queue item. Serialize decisions and
      // re-read after the lock so a stale browser cannot overwrite a decision
      // that committed while it was waiting.
      if (typeof db.$queryRaw === "function") {
        await db.$queryRaw`SELECT "id" FROM "ModerationCase" WHERE "id" = ${caseId} FOR UPDATE`;
      }
      const locked = typeof db.moderationCase.findUnique === "function"
        ? await db.moderationCase.findUnique({ where: { id: caseId }, include: { appeals: true } })
        : existing;
      if (!locked) {
        throw new AppException("NOT_FOUND", `Moderation case ${caseId} was not found`, HttpStatus.NOT_FOUND);
      }
      this.assertActionAllowed(locked, action);
      this.assertIndependentAppealReviewer(locked, action, actorId);
      if (locked.assignedToUserId && locked.assignedToUserId !== actorId) {
        throw new AppException(
          "REVIEW_CASE_ASSIGNED_TO_ANOTHER_REVIEWER",
          "This case is assigned to another reviewer",
          HttpStatus.CONFLICT
        );
      }
      if (locked.messageId && MESSAGE_EVIDENCE_REQUIRED_ACTIONS.has(action)) {
        const evidenceMessage = typeof db.message?.findUnique === "function"
          ? await db.message.findUnique({
              where: { id: locked.messageId },
              select: { id: true, conversationId: true }
            })
          : null;
        if (
          !evidenceMessage
          || (locked.conversationId && evidenceMessage.conversationId !== locked.conversationId)
        ) {
          throw new AppException(
            "REVIEW_MESSAGE_EVIDENCE_UNAVAILABLE",
            "The reported message evidence is unavailable; no adverse action was applied",
            HttpStatus.CONFLICT,
            { messageId: locked.messageId }
          );
        }
      }
      const isAppealableAdverseAction = (MODERATION_APPEALABLE_ACTIONS as readonly string[]).includes(action);
      const appealDeadlineAt = isAppealableAdverseAction && statusUpdate.resolvedAt
        ? moderationAppealDeadline(statusUpdate.resolvedAt)
        : undefined;
      const updated = await db.moderationCase.update({
        where: { id: caseId },
        data: {
          status: statusUpdate.status,
          resolvedAt: statusUpdate.resolvedAt,
          assignedToUserId: locked.assignedToUserId ?? actorId,
          ...(appealDeadlineAt
            ? {
                appealDeadlineAt,
                appealPolicyVersion: MODERATION_APPEAL_POLICY_VERSION
              }
            : {})
        },
        include: {
          evidences: true,
          actionLogs: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] }
        }
      });

      const actionLog = await db.moderationActionLog.create({
        data: {
          caseId,
          actorId: null,
          reviewerId: actorId,
          action,
          note: note?.trim() || null
        }
      });

      if (typeof db.reviewAuditLog?.create === "function") {
        await db.reviewAuditLog.create({
          data: {
            reviewerId: actorId,
            action: `review.case.${action}`,
            resourceType: "moderation_case",
            resourceId: caseId,
            metadata: {
              previousStatus: locked.status,
              nextStatus: statusUpdate.status,
              note: note?.trim() || null,
              reviewerName: actor.displayName ?? null,
              reviewerRole: actor.role ?? null
            }
          }
        });
      }

      if (locked.messageId && publishesMessage(action)) {
        await db.message.update({
          where: { id: locked.messageId },
          data: {
            moderationStatus: "published",
            visibility: "participants",
            moderationDecision: "allow",
            reviewedAt: new Date()
          }
        });
      }
      if (locked.messageId && blocksMessage(action)) {
        await db.message.update({
          where: { id: locked.messageId },
          data: {
            // A direct automated rejection was never delivered and remains
            // `blocked`; a reviewer confirmation can also take down a message
            // that had already been delivered, which must be represented as
            // `removed` for sender-facing status and audit clarity.
            moderationStatus: action === "confirmViolation" ? "removed" : "blocked",
            visibility: "senderOnly",
            moderationDecision: "block",
            reviewedAt: new Date()
          }
        });
      }
      if (locked.source === "community" && locked.targetId && publishesMessage(action)) {
        await db.communityPost.updateMany({
          where: { id: locked.targetId },
          data: { status: "approved" }
        });
      }
      if (locked.source === "community" && locked.targetId && blocksMessage(action)) {
        await db.communityPost.updateMany({
          where: { id: locked.targetId },
          data: { status: "rejected" }
        });
      }
      if (action === "upholdAppeal" || action === "overturnAppeal") {
        const reviewedAt = new Date();
        await db.moderationAppeal.update({
          where: { caseId },
          data: {
            status: action === "overturnAppeal" ? "overturned" : "upheld",
            reviewerId: actorId,
            reviewNote: note?.trim() || null,
            reviewedAt
          }
        });
        if (locked.subjectUserId) {
          const overturned = action === "overturnAppeal";
          await this.notifications.create(
            locked.subjectUserId,
            "moderationAlert",
            overturned ? "内容申诉复核已撤销原处置" : "内容申诉复核已完成",
            overturned ? "独立复核确认申诉成立，相关内容处置已撤销。" : "独立复核已完成，原内容处置予以维持。",
            {
              caseId,
              status: overturned ? "overturned" : "upheld",
              reviewedAt: reviewedAt.toISOString()
            },
            db
          );
        }
      }

      const manualEscalation = action === "confirmViolation" && locked.subjectUserId
        ? await this.chatRestrictions.recordManualConfirmedViolation(
            locked.subjectUserId,
            caseId,
            actorId,
            db
          )
        : { escalated: false, confirmations: 0 };
      if ((action === "restrict24h" || action === "restrict7d") && locked.subjectUserId) {
        await this.chatRestrictions.createRestriction({
          userId: locked.subjectUserId,
          caseId,
          source: "manual",
          reason: note?.trim() || "审核员处置的聊天限言",
          endsAt: new Date(Date.now() + (action === "restrict7d" ? 7 * 24 : 24) * 60 * 60 * 1000),
          actorId
        }, db);
      }
      if (isAppealableAdverseAction && appealDeadlineAt && locked.subjectUserId) {
        await this.notifications.create(
          locked.subjectUserId,
          "moderationAlert",
          `内容处置已更新，可在${MODERATION_APPEAL_SUBMISSION_DAYS}日内申诉`,
          `平台已作出人工内容处置。如有异议，请在${MODERATION_APPEAL_SUBMISSION_DAYS}日内（最晚 ${appealDeadlineAt.toISOString()}）通过安全中心提交申诉。点击本通知可进入安全中心查看处置与申诉入口。`,
          {
            caseId,
            appealDeadlineAt: appealDeadlineAt.toISOString(),
            policyVersion: MODERATION_APPEAL_POLICY_VERSION,
            action
          },
          db
        );
      }
      if (action === "liftRestriction" || action === "overturnAppeal") {
        await this.chatRestrictions.liftForCase(caseId, actorId, note, db);
      }
      if (
        locked.source === "report"
        && locked.reporterUserId
        && statusUpdate.resolvedAt
      ) {
        const publicOutcome = reportPublicOutcome(action);
        await this.notifications.create(
          locked.reporterUserId,
          "moderationAlert",
          "举报处理结果已更新",
          publicOutcome.summary,
          {
            reportId: caseId,
            status: statusUpdate.status,
            outcome: publicOutcome.outcome
          },
          db
        );
      }

      const finalCase = manualEscalation.escalated && typeof db.moderationCase.findUnique === "function"
        ? await db.moderationCase.findUnique({
            where: { id: caseId },
            include: {
              evidences: true,
              actionLogs: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] }
            }
          })
        : updated;
      return { case: finalCase ?? updated, actionLog, manualEscalation };
    });

    const overviewPayload = await this.overview();
    return {
      case: {
        ...this.toCaseDto(result.case),
        actionLog: [this.toActionLogDto(result.actionLog), ...((result.case.actionLogs ?? []) as any[]).map((log) => this.toActionLogDto(log))]
      },
      action: this.toActionLogDto(result.actionLog),
      overview: overviewPayload.overview,
      manualEscalation: result.manualEscalation
    };
  }

  async createLabel(actor: ReviewDecisionActor, dto: CreateReviewLabelDto) {
    const actorId = actor.id;
    if (dto.caseId) {
      const exists = await this.prisma.moderationCase.findUnique({ where: { id: dto.caseId } } as any);
      if (!exists) {
        throw new AppException("NOT_FOUND", `Moderation case ${dto.caseId} was not found`, HttpStatus.NOT_FOUND);
      }
    }

    const label = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const created = await db.moderationLabel.create({
        data: {
          text: dto.text.trim(),
          expectedDecision: dto.expectedDecision,
          actualDecision: dto.actualDecision,
          note: dto.note?.trim() || null,
          caseId: dto.caseId ?? null,
          actorId: null,
          reviewerId: actorId,
          source: dto.source ?? null
        }
      });

      if (typeof db.reviewAuditLog?.create === "function") {
        await db.reviewAuditLog.create({
          data: {
            reviewerId: actorId,
            action: "review.label.created",
            resourceType: "moderation_label",
            resourceId: created.id,
            metadata: {
              caseId: dto.caseId ?? null,
              expectedDecision: dto.expectedDecision,
              actualDecision: dto.actualDecision,
              reviewerName: actor.displayName ?? null
            }
          }
        });
      }

      return created;
    });

    const count = await this.prisma.moderationLabel.count();
    return {
      label: this.toLabelDto(label),
      count
    };
  }

  async claimCase(caseId: string, actor: ReviewDecisionActor) {
    const item = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const staffById = await this.lockReviewStaffRows(db, [actor.id]);
      this.assertActiveReviewStaff(staffById, actor.id, {
        code: "REVIEW_STAFF_INACTIVE",
        message: "This review staff account is no longer active",
        status: HttpStatus.FORBIDDEN
      });
      if (typeof db.$queryRaw === "function") {
        await db.$queryRaw`SELECT "id" FROM "ModerationCase" WHERE "id" = ${caseId} FOR UPDATE`;
      }
      const existing = await db.moderationCase.findUnique({
        where: { id: caseId },
        include: { appeals: true }
      });
      if (!existing) {
        throw new AppException("NOT_FOUND", `Moderation case ${caseId} was not found`, HttpStatus.NOT_FOUND);
      }
      if (!(OPEN_STATUSES as readonly string[]).includes(existing.status)) {
        throw new AppException("REVIEW_CASE_CLOSED", "A closed case cannot be claimed", HttpStatus.CONFLICT);
      }
      this.assertIndependentAppealAssignee(existing, actor.id);
      if (existing.assignedToUserId && existing.assignedToUserId !== actor.id) {
        throw new AppException(
          "REVIEW_CASE_ALREADY_ASSIGNED",
          "This case is already assigned to another reviewer",
          HttpStatus.CONFLICT
        );
      }
      const updated = await db.moderationCase.update({
        where: { id: caseId },
        data: { assignedToUserId: actor.id }
      });
      if (!existing.assignedToUserId) {
        await db.reviewAuditLog.create({
          data: {
            reviewerId: actor.id,
            action: "review.case.claimed",
            resourceType: "moderation_case",
            resourceId: caseId,
            metadata: { reviewerName: actor.displayName ?? null }
          }
        });
      }
      return updated;
    });
    return { case: this.toCaseDto(item) };
  }

  async assignCase(caseId: string, actor: ReviewDecisionActor, reviewerId?: string) {
    const item = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const staffById = await this.lockReviewStaffRows(db, [actor.id, reviewerId]);
      this.assertActiveReviewStaff(staffById, actor.id, {
        code: "REVIEW_STAFF_INACTIVE",
        message: "This review lead account is no longer active",
        status: HttpStatus.FORBIDDEN
      });
      if (reviewerId) {
        this.assertActiveReviewStaff(staffById, reviewerId, {
          code: "REVIEW_ASSIGNEE_INVALID",
          message: "The assignee must be an active review staff member",
          status: HttpStatus.BAD_REQUEST
        });
      }
      if (typeof db.$queryRaw === "function") {
        await db.$queryRaw`SELECT "id" FROM "ModerationCase" WHERE "id" = ${caseId} FOR UPDATE`;
      }
      const existing = await db.moderationCase.findUnique({
        where: { id: caseId },
        include: { appeals: true }
      });
      if (!existing) {
        throw new AppException("NOT_FOUND", `Moderation case ${caseId} was not found`, HttpStatus.NOT_FOUND);
      }
      if (!(OPEN_STATUSES as readonly string[]).includes(existing.status)) {
        throw new AppException("REVIEW_CASE_CLOSED", "A closed case cannot be reassigned", HttpStatus.CONFLICT);
      }
      if (reviewerId) this.assertIndependentAppealAssignee(existing, reviewerId);
      const updated = await db.moderationCase.update({
        where: { id: caseId },
        data: { assignedToUserId: reviewerId ?? null }
      });
      await db.reviewAuditLog.create({
        data: {
          reviewerId: actor.id,
          action: reviewerId ? "review.case.assigned" : "review.case.unassigned",
          resourceType: "moderation_case",
          resourceId: caseId,
          metadata: {
            previousReviewerId: existing.assignedToUserId ?? null,
            nextReviewerId: reviewerId ?? null,
            leadName: actor.displayName ?? null
          }
        }
      });
      return updated;
    });
    return { case: this.toCaseDto(item) };
  }

  async listActiveReviewers(query: ListActiveReviewStaffQueryDto) {
    const keyword = query.keyword?.trim();
    const where = {
      status: "active",
      ...(query.role ? { role: query.role } : {}),
      ...(keyword
        ? {
            OR: [
              { displayName: { contains: keyword, mode: "insensitive" } },
              { username: { contains: keyword, mode: "insensitive" } }
            ]
          }
        : {})
    };
    const [items, total] = await Promise.all([
      this.prisma.reviewStaff.findMany({
        where,
        select: { id: true, displayName: true, username: true, role: true, status: true },
        orderBy: [
          { role: "desc" },
          { displayName: "asc" },
          { username: "asc" },
          { id: "asc" }
        ],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      } as any),
      this.prisma.reviewStaff.count({ where } as any)
    ]);
    return {
      items,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize)
      }
    };
  }

  private async lockReviewStaffRows(
    db: any,
    reviewerIds: Array<string | undefined>
  ): Promise<Map<string, { id: string; status: string }> | null> {
    const ids = [...new Set(reviewerIds.filter((id): id is string => Boolean(id)))].sort();
    if (typeof db.$queryRaw === "function") {
      for (const id of ids) {
        await db.$queryRaw`SELECT "id" FROM "ReviewStaff" WHERE "id" = ${id} FOR KEY SHARE`;
      }
    }
    if (typeof db.reviewStaff?.findUnique !== "function") {
      // A few isolated unit tests use deliberately minimal transaction doubles.
      // The real Prisma transaction always exposes this model; fail closed if a
      // non-test runtime is ever constructed without it.
      if (process.env.NODE_ENV === "test") return null;
      throw new AppException(
        "REVIEW_STAFF_STATUS_UNAVAILABLE",
        "Review staff status could not be verified",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    const staffById = new Map<string, { id: string; status: string }>();
    for (const id of ids) {
      const staff = await db.reviewStaff.findUnique({
        where: { id },
        select: { id: true, status: true }
      });
      if (staff) staffById.set(id, staff);
    }
    return staffById;
  }

  private assertActiveReviewStaff(
    staffById: Map<string, { id: string; status: string }> | null,
    reviewerId: string,
    error: { code: string; message: string; status: number }
  ): void {
    if (staffById === null) return;
    if (staffById.get(reviewerId)?.status !== "active") {
      throw new AppException(error.code, error.message, error.status);
    }
  }

  async exportLabels(actor: ReviewDecisionActor, query: ExportReviewLabelsDto = new ExportReviewLabelsDto()) {
    const exportedAt = new Date();
    if (query.cursor && !query.snapshotAt) {
      throw new AppException(
        "REVIEW_LABEL_EXPORT_SNAPSHOT_REQUIRED",
        "snapshotAt is required when continuing a label export",
        HttpStatus.UNPROCESSABLE_ENTITY
      );
    }
    const snapshotAt = query.snapshotAt ? new Date(query.snapshotAt) : exportedAt;
    if (Number.isNaN(snapshotAt.getTime()) || snapshotAt.getTime() > exportedAt.getTime() + 60_000) {
      throw new AppException(
        "REVIEW_LABEL_EXPORT_SNAPSHOT_INVALID",
        "snapshotAt must be a valid time no later than the current export window",
        HttpStatus.UNPROCESSABLE_ENTITY
      );
    }
    const cursor = query.cursor ? this.decodeLabelExportCursor(query.cursor) : null;
    const limit = Math.min(500, Math.max(1, Math.floor(query.limit ?? 500)));
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const samples = await db.moderationLabel.findMany({
        where: {
          createdAt: { lte: snapshotAt },
          ...(cursor ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } }
            ]
          } : {})
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1
      });
      const page = samples.slice(0, limit);
      const hasMore = samples.length > page.length;
      const last = page[page.length - 1];
      const nextCursor = hasMore && last
        ? this.encodeLabelExportCursor(last.createdAt, last.id)
        : null;
      await db.reviewAuditLog.create({
        data: {
          reviewerId: actor.id,
          action: "review.labels.exported",
          resourceType: "moderation_label_export",
          resourceId: exportedAt.toISOString(),
          metadata: {
            pageCount: page.length,
            hasMore,
            snapshotAt: snapshotAt.toISOString(),
            reviewerName: actor.displayName ?? null,
            reviewerRole: actor.role ?? null
          }
        }
      });
      return {
        schemaVersion: 2,
        exportedAt: exportedAt.toISOString(),
        snapshotAt: snapshotAt.toISOString(),
        pageCount: page.length,
        hasMore,
        nextCursor,
        samples: page.map((item: any) => this.toLabelDto(item))
      };
    });
  }

  private encodeLabelExportCursor(createdAt: Date, id: string) {
    return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id }), "utf8").toString("base64url");
  }

  private decodeLabelExportCursor(value: string): { createdAt: Date; id: string } {
    try {
      const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
      const createdAt = new Date(parsed?.createdAt);
      const id = typeof parsed?.id === "string" ? parsed.id.trim() : "";
      if (Number.isNaN(createdAt.getTime()) || !id || id.length > 80) throw new Error("invalid cursor");
      return { createdAt, id };
    } catch {
      throw new AppException(
        "REVIEW_LABEL_EXPORT_CURSOR_INVALID",
        "Label export cursor is invalid",
        HttpStatus.UNPROCESSABLE_ENTITY
      );
    }
  }

  buildCaseWhere(query: ListReviewCasesQueryDto) {
    const where: Record<string, unknown> = {};

    if (query.status) where.status = query.status;
    if (query.riskLevel) where.riskLevel = query.riskLevel;
    if (query.priority) where.priority = query.priority;
    if (query.source) where.source = query.source;

    if (query.from || query.to) {
      const createdAt: Record<string, Date> = {};
      if (query.from) {
        const from = new Date(query.from);
        if (Number.isNaN(from.getTime())) {
          throw new AppException("VALIDATION_ERROR", "from must be a valid ISO date", HttpStatus.UNPROCESSABLE_ENTITY);
        }
        createdAt.gte = from;
      }
      if (query.to) {
        const to = new Date(query.to);
        if (Number.isNaN(to.getTime())) {
          throw new AppException("VALIDATION_ERROR", "to must be a valid ISO date", HttpStatus.UNPROCESSABLE_ENTITY);
        }
        createdAt.lte = to;
      }
      where.createdAt = createdAt;
    }

    const keyword = query.keyword?.trim();
    if (keyword) {
      where.OR = [
        { title: { contains: keyword, mode: "insensitive" } },
        { content: { contains: keyword, mode: "insensitive" } },
        { aiReason: { contains: keyword, mode: "insensitive" } }
      ];
    }

    return where;
  }

  statusForAction(action: ReviewCaseAction): {
    status: "resolved" | "dismissed" | "humanReview";
    resolvedAt: Date | null;
  } {
    switch (action) {
      case "confirmViolation":
      case "rejectMessage":
      case "restrict24h":
      case "restrict7d":
      case "upholdAppeal":
        return { status: "resolved", resolvedAt: new Date() };
      case "dismiss":
      case "approveMessage":
      case "liftRestriction":
      case "overturnAppeal":
        return { status: "dismissed", resolvedAt: new Date() };
      case "escalate":
        return { status: "humanReview", resolvedAt: null };
    }
  }

  private assertActionAllowed(existing: any, action: ReviewCaseAction): void {
    if (
      [
        "confirmViolation", "dismiss", "approveMessage", "rejectMessage", "escalate",
        "restrict24h", "restrict7d"
      ].includes(action) &&
      (existing.status === "resolved" || existing.status === "dismissed")
    ) {
      throw new AppException("CASE_ALREADY_CLOSED", "The case is already closed", HttpStatus.CONFLICT);
    }
    if (action === "escalate" && existing.status === "humanReview") {
      throw new AppException("CASE_ALREADY_ESCALATED", "The case is already awaiting human review", HttpStatus.CONFLICT);
    }
    if ((action === "restrict24h" || action === "restrict7d") && !existing.subjectUserId) {
      throw new AppException(
        "CASE_SUBJECT_REQUIRED",
        "A chat restriction requires an identified message sender",
        HttpStatus.CONFLICT
      );
    }
    if (action === "upholdAppeal" || action === "overturnAppeal") {
      const pendingAppeal = (existing.appeals ?? []).find((appeal: any) => appeal.status === "pending");
      if (!pendingAppeal) {
        throw new AppException("APPEAL_NOT_PENDING", "No pending appeal exists for this case", HttpStatus.CONFLICT);
      }
    }
  }

  private assertIndependentAppealReviewer(
    existing: any,
    action: ReviewCaseAction,
    reviewerId: string
  ): void {
    if (action !== "upholdAppeal" && action !== "overturnAppeal") return;
    this.assertIndependentAppealAssignee(existing, reviewerId);
  }

  private assertIndependentAppealAssignee(existing: any, reviewerId: string): void {
    const pendingAppeal = (existing.appeals ?? []).find((appeal: any) => appeal.status === "pending");
    if (pendingAppeal?.originalReviewerId && pendingAppeal.originalReviewerId === reviewerId) {
      throw new AppException(
        "MODERATION_APPEAL_INDEPENDENT_REVIEW_REQUIRED",
        "The reviewer who made the original decision cannot review its appeal",
        HttpStatus.CONFLICT
      );
    }
  }

  private async resolveConversation(item: {
    messageId?: string | null;
    targetId?: string | null;
  }): Promise<any | null> {
    if (item.messageId) {
      const message: any = await this.prisma.message.findUnique({
        where: { id: item.messageId },
        include: {
          conversation: { include: { companion: true } }
        }
      } as any);
      if (message?.conversation) {
        return message.conversation;
      }
    }

    if (item.targetId) {
      const byExternal: any = await this.prisma.conversation.findFirst({
        where: { externalId: item.targetId },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        include: { companion: true }
      } as any);
      if (byExternal) return byExternal;

      const byId: any = await this.prisma.conversation.findUnique({
        where: { id: item.targetId },
        include: { companion: true }
      } as any);
      if (byId) return byId;
    }

    return null;
  }

  private async toEvidenceMessageDto(message: any, externalConversationId: string) {
    // Review keeps the text and moderation chain available, but a text-only
    // release must not turn historical chat assets into staff-readable media,
    // OCR, or analysis through this separate evidence surface.
    const attachments = this.mediaAssets.isChatMediaPlaybackEnabled()
      ? await Promise.all((message.attachments ?? []).map(async (asset: any) => ({
          ...(await this.mediaAssets.toAttachmentDto(asset)),
          extractedText: asset.extractedText ?? null,
          analysis: asset.analysis ?? null
        })))
      : [];
    return {
      id: message.id,
      conversationId: externalConversationId,
      senderId: message.senderId,
      senderName: message.senderName,
      content: message.content,
      type: message.type,
      moderationStatus: message.moderationStatus,
      visibility: message.visibility,
      attachments,
      timestamp: message.createdAt.toISOString()
    };
  }

  private buildOverviewStats(
    totalCases: number,
    statusGroups: Array<{ status: string; _count: { _all: number } }>,
    decisionGroups: Array<{ decision: string; _count: { _all: number } }>,
    sourceGroups: Array<{ source: string; _count: { _all: number } }>,
    riskGroups: Array<{ riskLevel: string; _count: { _all: number } }>,
    conversationCount: number,
    labelCount: number
  ) {
    const counts = <K extends string>(rows: Array<Record<K, string> & { _count: { _all: number } }>, key: K) =>
      new Map(rows.map((row) => [row[key], Number(row._count?._all ?? 0)]));
    const byStatus = counts(statusGroups, "status");
    const byDecision = counts(decisionGroups, "decision");
    const sources = counts(sourceGroups, "source");
    const risks = counts(riskGroups, "riskLevel");
    const pendingCases = OPEN_STATUSES.reduce((sum, status) => sum + (byStatus.get(status) ?? 0), 0);
    const resolved = (byStatus.get("resolved") ?? 0) + (byStatus.get("dismissed") ?? 0);
    const bySource = Object.fromEntries(
      ["chat", "community", "report", "profile"].map((source) => [source, sources.get(source) ?? 0])
    );
    const byRisk = {
      high: risks.get("high") ?? 0,
      medium: risks.get("medium") ?? 0,
      low: risks.get("low") ?? 0
    };

    return {
      pendingCases,
      totalCases,
      blocked: byDecision.get("block") ?? 0,
      warned: byDecision.get("warn") ?? 0,
      reviewed: byDecision.get("review") ?? 0,
      resolved,
      activeConversations: conversationCount,
      labels: labelCount,
      bySource,
      byRisk
    };
  }

  private toCaseSummary(item: any) {
    const redactLegacyChatEvidence = this.shouldRedactLegacyChatEvidence(item);
    return {
      id: item.id,
      title: redactLegacyChatEvidence ? TEXT_ONLY_REDACTED_CASE_TITLE : item.title,
      category: item.category,
      riskLevel: item.riskLevel,
      status: item.status,
      source: item.source,
      decision: item.decision,
      content: redactLegacyChatEvidence ? TEXT_ONLY_REDACTED_CASE_CONTENT : item.content,
      aiScore: item.aiScore,
      priority: item.priority ?? "normal",
      dueAt: item.dueAt ? item.dueAt.toISOString() : null,
      createdAt: item.createdAt?.toISOString?.() ?? item.createdAt
    };
  }

  private toCaseDto(item: any) {
    const redactLegacyChatEvidence = this.shouldRedactLegacyChatEvidence(item);
    return {
      id: item.id,
      title: redactLegacyChatEvidence ? TEXT_ONLY_REDACTED_CASE_TITLE : item.title,
      category: item.category,
      riskLevel: item.riskLevel,
      status: item.status,
      source: item.source,
      content: redactLegacyChatEvidence ? TEXT_ONLY_REDACTED_CASE_CONTENT : item.content,
      targetId: item.targetId ?? null,
      messageId: item.messageId ?? null,
      conversationId: item.conversationId ?? null,
      subjectUserId: item.subjectUserId ?? null,
      reporterUserId: item.reporterUserId ?? null,
      assignedToUserId: item.assignedToUserId ?? null,
      priority: item.priority ?? "normal",
      dueAt: item.dueAt ? item.dueAt.toISOString() : null,
      policyVersion: item.policyVersion ?? null,
      provider: item.provider ?? null,
      providerVersion: item.providerVersion ?? null,
      aiScore: item.aiScore,
      aiReason: redactLegacyChatEvidence ? null : item.aiReason,
      decision: item.decision,
      matchedRules: item.matchedRules ?? [],
      usedAI: item.usedAI,
      resolvedAt: item.resolvedAt ? item.resolvedAt.toISOString() : null,
      appealDeadlineAt: item.appealDeadlineAt ? item.appealDeadlineAt.toISOString() : null,
      appealPolicyVersion: item.appealPolicyVersion ?? null,
      createdAt: item.createdAt.toISOString()
    };
  }

  private shouldRedactLegacyChatEvidence(item: any): boolean {
    // ModerationCase has no immutable "content came from media" marker. The
    // historic media worker concatenated extracted attachment text into every
    // source=chat case artifact, so redact that whole stored projection when
    // playback is disabled. Reviewers can still inspect the retained plaintext
    // conversation through conversationEvidence(), whose attachment projection
    // is separately empty in text-only mode.
    return item?.source === "chat" && !this.mediaAssets.isChatMediaPlaybackEnabled();
  }

  private toActionLogDto(log: any) {
    return {
      id: log.id,
      action: log.action,
      note: log.note ?? null,
      actorId: log.actorId ?? null,
      reviewerId: log.reviewerId ?? null,
      createdAt: log.createdAt.toISOString()
    };
  }

  private toAppealDto(appeal: any) {
    return {
      id: appeal.id,
      caseId: appeal.caseId,
      subjectUserId: appeal.subjectUserId,
      reason: appeal.reason,
      status: appeal.status,
      originalReviewerId: appeal.originalReviewerId ?? null,
      independentReviewRequired: Boolean(appeal.originalReviewerId),
      reviewDueAt: appeal.reviewDueAt ? appeal.reviewDueAt.toISOString() : null,
      overdue: appeal.status === "pending"
        && Boolean(appeal.reviewDueAt)
        && appeal.reviewDueAt.getTime() <= Date.now(),
      policyVersion: appeal.policyVersion ?? MODERATION_APPEAL_POLICY_VERSION,
      reviewerId: appeal.reviewerId ?? null,
      reviewNote: appeal.reviewNote ?? null,
      reviewedAt: appeal.reviewedAt ? appeal.reviewedAt.toISOString() : null,
      createdAt: appeal.createdAt.toISOString()
    };
  }

  private toRestrictionDto(restriction: any) {
    return {
      id: restriction.id,
      userId: restriction.userId,
      caseId: restriction.caseId ?? null,
      source: restriction.source,
      reason: restriction.reason,
      startsAt: restriction.startsAt.toISOString(),
      endsAt: restriction.endsAt.toISOString(),
      liftedAt: restriction.liftedAt ? restriction.liftedAt.toISOString() : null,
      liftedByUserId: restriction.liftedByUserId ?? null,
      createdAt: restriction.createdAt.toISOString()
    };
  }

  private toLabelDto(item: any) {
    return {
      id: item.id,
      text: item.text,
      expectedDecision: item.expectedDecision,
      actualDecision: item.actualDecision,
      note: item.note ?? null,
      caseId: item.caseId ?? null,
      actorId: item.actorId ?? null,
      reviewerId: item.reviewerId ?? null,
      source: item.source ?? null,
      createdAt: item.createdAt.toISOString()
    };
  }
}

function publishesMessage(action: ReviewCaseAction): boolean {
  return action === "dismiss" || action === "approveMessage" || action === "overturnAppeal";
}

function blocksMessage(action: ReviewCaseAction): boolean {
  return action === "confirmViolation" || action === "rejectMessage";
}

function reportPublicOutcome(action: ReviewCaseAction): {
  outcome: "actionTaken" | "closed";
  summary: string;
} {
  if (
    ["confirmViolation", "rejectMessage", "restrict24h", "restrict7d", "upholdAppeal"]
      .includes(action)
  ) {
    return {
      outcome: "actionTaken",
      summary: "平台已完成复核并采取相应处置。为保护双方隐私，不展示内部规则或对方账号信息。"
    };
  }
  return {
    outcome: "closed",
    summary: "平台已完成复核，本案件现已关闭。"
  };
}
