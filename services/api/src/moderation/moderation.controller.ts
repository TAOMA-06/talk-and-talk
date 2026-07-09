import { Controller, Get, UseGuards } from "@nestjs/common";

import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PrismaService } from "../database/prisma.service";

@Controller("moderation")
export class ModerationController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("status")
  status() {
    return { module: "moderation", status: "planned" };
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
