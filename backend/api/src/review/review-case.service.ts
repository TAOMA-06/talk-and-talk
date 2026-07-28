import { HttpStatus, Injectable } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { ChatRestrictionService } from "../moderation/chat-restriction.service";
import { MediaAssetService } from "../moderation/media/media-asset.service";
import { CreateReviewLabelDto } from "./dto/create-review-label.dto";
import { ReviewCaseAction } from "./dto/review-case-action.dto";
import { ListReviewCasesQueryDto } from "./dto/list-review-cases.dto";

const OPEN_STATUSES = ["pending", "autoReviewing", "humanReview"] as const;

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
    private readonly mediaAssets: MediaAssetService
  ) {}

  async overview() {
    const [cases, conversationCount, labelCount, queue] = await Promise.all([
      this.prisma.moderationCase.findMany({
        select: {
          id: true,
          title: true,
          category: true,
          riskLevel: true,
          status: true,
          source: true,
          decision: true,
          content: true,
          aiScore: true,
          createdAt: true
        },
        orderBy: { createdAt: "desc" }
      } as any),
      this.prisma.conversation.count(),
      this.prisma.moderationLabel.count(),
      this.prisma.moderationCase.findMany({
        where: { status: { in: [...OPEN_STATUSES] } },
        orderBy: [{ priority: "desc" }, { dueAt: "asc" }, { createdAt: "desc" }],
        take: 8
      } as any)
    ]);

    return {
      overview: this.buildOverviewStats(cases, conversationCount, labelCount),
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
        orderBy: { createdAt: "desc" },
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
        evidences: { orderBy: { createdAt: "asc" } },
        actionLogs: { orderBy: { createdAt: "desc" } },
        appeals: true,
        restrictions: { orderBy: { createdAt: "desc" } }
      }
    } as any);

    if (!item) {
      throw new AppException("NOT_FOUND", `Moderation case ${id} was not found`, HttpStatus.NOT_FOUND);
    }

    return {
      case: {
        ...this.toCaseDto(item),
        evidences: (item.evidences ?? []).map((ev: any) => ({
          id: ev.id,
          type: ev.type,
          payload: ev.payload,
          createdAt: ev.createdAt.toISOString()
        })),
        actionLog: (item.actionLogs ?? []).map((log: any) => this.toActionLogDto(log)),
        appeals: (item.appeals ?? []).map((appeal: any) => this.toAppealDto(appeal)),
        restrictions: (item.restrictions ?? []).map((restriction: any) => this.toRestrictionDto(restriction))
      }
    };
  }

  async conversationEvidence(caseId: string, limit = 100) {
    const item = await this.prisma.moderationCase.findUnique({ where: { id: caseId } } as any);
    if (!item) {
      throw new AppException("NOT_FOUND", `Moderation case ${caseId} was not found`, HttpStatus.NOT_FOUND);
    }

    const conversation = await this.resolveConversation(item);
    if (!conversation) {
      return {
        caseId,
        conversation: null,
        messages: []
      };
    }

    const messages = await this.prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: Math.min(Math.max(limit, 1), 200),
      include: { attachments: true }
    } as any);

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
      messages: await Promise.all(messages.map(async (message: any) => ({
        id: message.id,
        conversationId: conversation.externalId,
        senderId: message.senderId,
        senderName: message.senderName,
        content: message.content,
        type: message.type,
        moderationStatus: message.moderationStatus,
        visibility: message.visibility,
        attachments: await Promise.all((message.attachments ?? []).map(async (asset: any) => ({
          ...(await this.mediaAssets.toAttachmentDto(asset)),
          extractedText: asset.extractedText ?? null,
          analysis: asset.analysis ?? null
        }))),
        timestamp: message.createdAt.toISOString()
      })))
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

    const statusUpdate = this.statusForAction(action);
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
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
      const updated = await db.moderationCase.update({
        where: { id: caseId },
        data: {
          status: statusUpdate.status,
          resolvedAt: statusUpdate.resolvedAt
        },
        include: {
          evidences: true,
          actionLogs: { orderBy: { createdAt: "desc" } }
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

      await db.auditLog.create({
        data: {
          actorId,
          action,
          resourceType: "moderation_case",
          resourceId: caseId,
          metadata: {
            previousStatus: locked.status,
            nextStatus: statusUpdate.status,
            note: note?.trim() || null,
            actorKind: "reviewStaff"
          }
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
        await db.moderationAppeal.update({
          where: { caseId },
          data: {
            status: action === "overturnAppeal" ? "overturned" : "upheld",
            reviewerId: actorId,
            reviewNote: note?.trim() || null,
            reviewedAt: new Date()
          }
        });
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
      if (action === "liftRestriction" || action === "overturnAppeal") {
        await this.chatRestrictions.liftForCase(caseId, actorId, note, db);
      }

      const finalCase = manualEscalation.escalated && typeof db.moderationCase.findUnique === "function"
        ? await db.moderationCase.findUnique({
            where: { id: caseId },
            include: {
              evidences: true,
              actionLogs: { orderBy: { createdAt: "desc" } }
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

      await db.auditLog.create({
        data: {
          actorId,
          action: "create_label",
          resourceType: "moderation_label",
          resourceId: created.id,
          metadata: {
            caseId: dto.caseId ?? null,
            expectedDecision: dto.expectedDecision,
            actualDecision: dto.actualDecision,
            actorKind: "reviewStaff"
          }
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

  async exportLabels() {
    const samples = await this.prisma.moderationLabel.findMany({
      orderBy: { createdAt: "desc" }
    } as any);

    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      count: samples.length,
      samples: samples.map((item: any) => this.toLabelDto(item))
    };
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
        orderBy: { updatedAt: "desc" },
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

  private buildOverviewStats(
    cases: Array<{
      status: string;
      decision: string;
      riskLevel: string;
      source: string;
    }>,
    conversationCount: number,
    labelCount: number
  ) {
    const pendingCases = cases.filter((item) =>
      (OPEN_STATUSES as readonly string[]).includes(item.status)
    ).length;
    const resolved = cases.filter(
      (item) => item.status === "resolved" || item.status === "dismissed"
    ).length;

    const sources = ["chat", "community", "report", "profile"] as const;
    const bySource = Object.fromEntries(
      sources.map((source) => [source, cases.filter((item) => item.source === source).length])
    );
    const byRisk = {
      high: cases.filter((item) => item.riskLevel === "high").length,
      medium: cases.filter((item) => item.riskLevel === "medium").length,
      low: cases.filter((item) => item.riskLevel === "low").length
    };

    return {
      pendingCases,
      totalCases: cases.length,
      blocked: cases.filter((item) => item.decision === "block").length,
      warned: cases.filter((item) => item.decision === "warn").length,
      reviewed: cases.filter((item) => item.decision === "review").length,
      resolved,
      activeConversations: conversationCount,
      labels: labelCount,
      bySource,
      byRisk
    };
  }

  private toCaseSummary(item: any) {
    return {
      id: item.id,
      title: item.title,
      category: item.category,
      riskLevel: item.riskLevel,
      status: item.status,
      source: item.source,
      decision: item.decision,
      content: item.content,
      aiScore: item.aiScore,
      priority: item.priority ?? "normal",
      dueAt: item.dueAt ? item.dueAt.toISOString() : null,
      createdAt: item.createdAt?.toISOString?.() ?? item.createdAt
    };
  }

  private toCaseDto(item: any) {
    return {
      id: item.id,
      title: item.title,
      category: item.category,
      riskLevel: item.riskLevel,
      status: item.status,
      source: item.source,
      content: item.content,
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
      aiReason: item.aiReason,
      decision: item.decision,
      matchedRules: item.matchedRules ?? [],
      usedAI: item.usedAI,
      resolvedAt: item.resolvedAt ? item.resolvedAt.toISOString() : null,
      createdAt: item.createdAt.toISOString()
    };
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
