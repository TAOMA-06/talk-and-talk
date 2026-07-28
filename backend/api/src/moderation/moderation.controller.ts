import { Body, Controller, Get, HttpStatus, Post, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { AuthenticatedUser } from "../auth/auth.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { PrismaService } from "../database/prisma.service";
import { AppException } from "../common/errors/app.exception";
import { CheckModerationDto } from "./dto/check-moderation.dto";
import { CreateAppealDto } from "./dto/create-appeal.dto";
import { CreateReportDto } from "./dto/create-report.dto";
import { ModerationCaseService } from "./moderation-case.service";
import { ModerationService } from "./moderation.service";

@Controller("moderation")
export class ModerationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
    private readonly moderationCases: ModerationCaseService,
    private readonly config: ConfigService
  ) {}

  @Get("status")
  status() {
    const apiKey = this.config.get<string>("DEEPSEEK_API_KEY")?.trim();
    return {
      module: "moderation",
      status: "active",
      aiConfigured: Boolean(apiKey)
    };
  }

  @Post("check")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("moderator", "admin")
  async check(@Body() dto: CheckModerationDto) {
    void dto;
    throw new AppException(
      "REVIEW_DEPARTMENT_MOVED",
      "Manual moderation checks are available only to the independent review department",
      HttpStatus.GONE
    );
  }

  @Post("reports")
  @UseGuards(JwtAuthGuard)
  async report(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReportDto) {
    const reason = dto.reason.trim();
    const conversation = await this.resolveReportConversation(user.id, dto.conversationId, dto.messageId);
    if (dto.messageId && !conversation) {
      throw new AppException("REPORTED_MESSAGE_NOT_FOUND", "Reported message was not found", HttpStatus.NOT_FOUND);
    }
    const reportedMessage = dto.messageId
      ? await this.prisma.message.findFirst({
          where: {
            id: dto.messageId,
            conversationId: conversation!.id,
            AND: [{
              OR: [
                { moderationStatus: "published", visibility: "participants" },
                { senderId: user.id }
              ]
            }]
          }
        } as any)
      : null;
    if (dto.messageId && !reportedMessage) {
      throw new AppException("REPORTED_MESSAGE_NOT_FOUND", "Reported message was not found", HttpStatus.NOT_FOUND);
    }
    const contextMessages = conversation
      ? await this.prisma.message.findMany({
          where: {
            conversationId: conversation.id,
            AND: [{
              OR: [
                { moderationStatus: "published", visibility: "participants" },
                { senderId: user.id }
              ]
            }]
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 10,
          select: { content: true }
        } as any)
      : [];
    // Context is derived server-side. The legacy recentContext field is kept in
    // the DTO for compatibility but is intentionally never trusted as evidence.
    const content = [reason, ...contextMessages.reverse().map((message: any) => message.content)]
      .filter(Boolean)
      .join("\n")
      .slice(0, 2000);
    const targetId = conversation?.id ?? (dto.targetId?.trim() || null);
    const subjectUserId = reportedMessage?.senderId ?? this.otherParticipantId(conversation, user.id);

    const result = await this.moderation.moderateAsync(content, "report");
    const moderationCase = await this.moderationCases.createReportCase({
      result,
      reason,
      content,
      targetId,
      messageId: reportedMessage?.id ?? null,
      conversationId: conversation?.id ?? null,
      subjectUserId,
      actorId: user.id
    });

    if (!moderationCase) {
      throw new Error("Failed to create report moderation case");
    }

    return {
      report: {
        id: moderationCase.id,
        status: moderationCase.status,
        source: moderationCase.source
      }
    };
  }

  @Post("appeals")
  @UseGuards(JwtAuthGuard)
  async appeal(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAppealDto) {
    const appeal = await this.moderationCases.createAppeal({
      caseId: dto.caseId,
      subjectUserId: user.id,
      reason: dto.reason
    });
    return {
      appeal: {
        id: appeal.id,
        caseId: appeal.caseId,
        status: appeal.status,
        createdAt: appeal.createdAt.toISOString()
      }
    };
  }

  @Get("cases")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("moderator", "admin")
  async cases() {
    throw new AppException(
      "REVIEW_DEPARTMENT_MOVED",
      "Moderation cases are available only to the independent review department",
      HttpStatus.GONE
    );
  }

  private toCaseDto(item: {
    id: string;
    title: string;
    category: string;
    riskLevel: string;
    status: string;
    source: string;
    content: string;
    targetId: string | null;
    aiScore: number;
    aiReason: string;
    decision: string;
    matchedRules: string[];
    usedAI: boolean;
    resolvedAt: Date | null;
  }) {
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

  private async resolveReportConversation(userId: string, externalId?: string, messageId?: string) {
    if (!externalId && !messageId) return null;
    if (messageId && !externalId) {
      const message: any = await this.prisma.message.findUnique({
        where: { id: messageId },
        include: { conversation: { include: { companion: true } } }
      } as any);
      if (!message?.conversation || !this.canViewConversation(message.conversation, userId)) return null;
      return message.conversation;
    }
    if (!externalId) return null;
    return this.prisma.conversation.findFirst({
      where: {
        OR: [
          { userId, externalId },
          { id: externalId, companion: { ownerUserId: userId } }
        ]
      },
      include: { companion: true }
    } as any);
  }

  private canViewConversation(conversation: any, userId: string) {
    return conversation.userId === userId || conversation.companion?.ownerUserId === userId;
  }

  private otherParticipantId(conversation: any | null, userId: string): string | null {
    if (!conversation) return null;
    if (conversation.userId === userId) return conversation.companion?.ownerUserId ?? null;
    return conversation.userId ?? null;
  }
}
