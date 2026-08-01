import { Body, Controller, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuditService } from "../common/audit/audit.service";
import {
  RecommendationMetricsQueryDto,
  UpdateRecommendationPolicyDto
} from "./dto/recommendation.dto";
import { RecommendationsService } from "./recommendations.service";

@Controller("admin/recommendations")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("operations", "admin")
export class AdminRecommendationsController {
  constructor(
    private readonly recommendations: RecommendationsService,
    private readonly audit: AuditService
  ) {}

  @Get("metrics")
  metrics(@Query() query: RecommendationMetricsQueryDto) {
    return this.recommendations.metrics(query);
  }

  @Patch("companions/:id/policies/:placement")
  async updatePolicy(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") companionId: string,
    @Param("placement") placement: string,
    @Body() dto: UpdateRecommendationPolicyDto
  ) {
    const { policy, subjectUserId } = await this.recommendations.updatePolicy(companionId, placement, dto);
    await this.audit.record({
      actorId: user.id,
      subjectUserIds: subjectUserId ? [subjectUserId] : [],
      action: "recommendation.policy.update",
      resourceType: "companionRecommendationPolicy",
      resourceId: policy.id,
      metadata: { companionId, placement, fields: Object.keys(dto) }
    });
    return policy;
  }
}
