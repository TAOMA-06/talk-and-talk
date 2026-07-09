import { HttpStatus, Injectable } from "@nestjs/common";

import { AppException } from "../../common/errors/app.exception";
import { PrismaService } from "../../database/prisma.service";
import { AdminCaseAction } from "./dto/case-action.dto";
import { CreateLabelDto } from "./dto/create-label.dto";
import { ListAdminCasesQueryDto } from "./dto/list-admin-cases.dto";

const OPEN_STATUSES = ["pending", "autoReviewing", "humanReview"] as const;

@Injectable()
export class AdminModerationService {
  constructor(private readonly prisma: PrismaService) {}

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
        orderBy: [{ createdAt: "desc" }],
        take: 8
      } as any)
    ]);

    return {
      overview: this.buildOverviewStats(cases, conversationCount, labelCount),
      queue: queue.map((item: any) => this.toCaseSummary(item))
    };
  }

  async listCases(query: ListAdminCasesQueryDto) {
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
        actionLogs: { orderBy: { createdAt: "desc" } }
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
        actionLog: (item.actionLogs ?? []).map((log: any) => this.toActionLogDto(log))
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
      take: Math.min(Math.max(limit, 1), 200)
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
      messages: messages.map((message: any) => ({
        id: message.id,
        conversationId: conversation.externalId,
        senderId: message.senderId,
        senderName: message.senderName,
        content: message.content,
        type: message.type,
        timestamp: message.createdAt.toISOString()
      }))
    };
  }

  async applyAction(caseId: string, actorId: string, action: AdminCaseAction, note?: string) {
    const existing = await this.prisma.moderationCase.findUnique({ where: { id: caseId } } as any);
    if (!existing) {
      throw new AppException("NOT_FOUND", `Moderation case ${caseId} was not found`, HttpStatus.NOT_FOUND);
    }

    const statusUpdate = this.statusForAction(action);
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
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
          actorId,
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
            previousStatus: existing.status,
            nextStatus: statusUpdate.status,
            note: note?.trim() || null
          }
        }
      });

      return { case: updated, actionLog };
    });

    const overviewPayload = await this.overview();
    return {
      case: {
        ...this.toCaseDto(result.case),
        actionLog: [this.toActionLogDto(result.actionLog), ...((result.case.actionLogs ?? []) as any[]).map((log) => this.toActionLogDto(log))]
      },
      action: this.toActionLogDto(result.actionLog),
      overview: overviewPayload.overview
    };
  }

  async createLabel(actorId: string, dto: CreateLabelDto) {
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
          actorId,
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
            actualDecision: dto.actualDecision
          }
        }
      });

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

  buildCaseWhere(query: ListAdminCasesQueryDto) {
    const where: Record<string, unknown> = {};

    if (query.status) where.status = query.status;
    if (query.riskLevel) where.riskLevel = query.riskLevel;
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

  statusForAction(action: AdminCaseAction): {
    status: "resolved" | "dismissed" | "humanReview";
    resolvedAt: Date | null;
  } {
    switch (action) {
      case "confirmViolation":
        return { status: "resolved", resolvedAt: new Date() };
      case "dismiss":
        return { status: "dismissed", resolvedAt: new Date() };
      case "escalate":
        return { status: "humanReview", resolvedAt: null };
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
      createdAt: log.createdAt.toISOString()
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
      source: item.source ?? null,
      createdAt: item.createdAt.toISOString()
    };
  }
}
