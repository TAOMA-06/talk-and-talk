import { Injectable } from "@nestjs/common";

import { PrismaService } from "../database/prisma.service";
import { ModerationResult, ModerationSource } from "./moderation.service";

export interface CreateModerationCaseInput {
  result: ModerationResult;
  source: ModerationSource;
  content: string;
  targetId?: string | null;
  messageId?: string | null;
  actorId?: string | null;
  title?: string;
  status?: "pending" | "autoReviewing" | "humanReview" | "resolved" | "dismissed";
  /** When true, create even if decision is allow (used for user reports). */
  forceCreate?: boolean;
  /** When provided, writes inside an existing Prisma interactive transaction. */
  db?: { moderationCase: PrismaService["moderationCase"] };
}

export interface CreateReportCaseInput {
  result: ModerationResult;
  reason: string;
  content: string;
  targetId?: string | null;
  actorId?: string | null;
}

@Injectable()
export class ModerationCaseService {
  constructor(private readonly prisma: PrismaService) {}

  async createFromResult(input: CreateModerationCaseInput) {
    const { result, source, content, targetId, messageId, actorId, title, status, forceCreate, db } =
      input;
    if (result.decision === "allow" && !forceCreate) {
      return null;
    }

    const client = db ?? this.prisma;
    return client.moderationCase.create({
      data: {
        title: title ?? this.caseTitle(result, content),
        category: this.categoryFor(source),
        riskLevel: result.riskLevel,
        status:
          status ??
          (result.decision === "review" || result.decision === "allow" ? "pending" : "humanReview"),
        source,
        content,
        targetId: targetId ?? null,
        messageId: messageId ?? null,
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
  }

  async createReportCase(input: CreateReportCaseInput) {
    const { result, reason, content, targetId, actorId } = input;
    const status = result.score >= 0.55 ? "humanReview" : "pending";
    const created = await this.createFromResult({
      result,
      source: "report",
      content,
      targetId,
      actorId,
      title: `举报：${reason.slice(0, 40)}`,
      status,
      forceCreate: true
    });

    if (!created) {
      throw new Error("Expected report case creation to succeed");
    }

    if (actorId) {
      await this.prisma.auditLog.create({
        data: {
          actorId,
          action: "create_report",
          resourceType: "moderation_case",
          resourceId: created.id,
          metadata: {
            reason: reason.slice(0, 200),
            source: "report",
            decision: result.decision
          }
        }
      } as any);
    }

    return created;
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
          usedAI: true
        }
      });
    }

    return evidences;
  }

  private categoryFor(source: ModerationSource): string {
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

  private caseTitle(result: ModerationResult, content: string): string {
    const prefix =
      result.decision === "block" ? "聊天拦截" : result.decision === "warn" ? "聊天预警" : "聊天待复核";
    return `${prefix}：${content.slice(0, 32)}`;
  }
}
