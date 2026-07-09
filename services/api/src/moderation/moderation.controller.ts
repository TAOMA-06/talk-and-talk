import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PrismaService } from "../database/prisma.service";
import { CheckModerationDto } from "./dto/check-moderation.dto";
import { ModerationService } from "./moderation.service";

@Controller("moderation")
export class ModerationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
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

  @Get("cases")
  @UseGuards(JwtAuthGuard)
  async cases() {
    const cases = await this.prisma.moderationCase.findMany({
      orderBy: { createdAt: "desc" },
      take: 100
    });

    return {
      cases: cases.map((item) => ({
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
      }))
    };
  }
}
