import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { AuthenticatedUser } from "../auth/auth.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { PrismaService } from "../database/prisma.service";
import { CheckModerationDto } from "./dto/check-moderation.dto";
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
  @UseGuards(JwtAuthGuard)
  async check(@Body() dto: CheckModerationDto) {
    const moderation = await this.moderation.moderateAsync(dto.text, dto.source ?? "chat");
    return {
      moderation: {
        decision: moderation.decision,
        riskLevel: moderation.riskLevel,
        score: moderation.score,
        reasons: moderation.reasons,
        matchedRules: moderation.matchedRules,
        usedAI: moderation.usedAI
      }
    };
  }

  @Post("reports")
  @UseGuards(JwtAuthGuard)
  async report(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReportDto) {
    const reason = dto.reason.trim();
    const recent = dto.recentContext?.trim() ?? "";
    const content = recent ? `${reason} ${recent}` : reason;
    const targetId = dto.conversationId?.trim() || dto.targetId?.trim() || null;

    const result = await this.moderation.moderateAsync(content, "report");
    const moderationCase = await this.moderationCases.createReportCase({
      result,
      reason,
      content,
      targetId,
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
      },
      moderationCase: this.toCaseDto(moderationCase)
    };
  }

  @Get("cases")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("moderator", "admin")
  async cases() {
    const cases = await this.prisma.moderationCase.findMany({
      orderBy: { createdAt: "desc" },
      take: 100
    });

    return {
      cases: cases.map((item) => this.toCaseDto(item))
    };
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
}
