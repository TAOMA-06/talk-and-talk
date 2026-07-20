import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import {
  ListRecommendedCompanionsDto,
  RecordRecommendationEventsDto,
  UpdateRecommendationPreferencesDto
} from "./dto/recommendation.dto";
import { RecommendationsService } from "./recommendations.service";

@Controller("recommendations")
@UseGuards(JwtAuthGuard)
export class RecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  @Get("topics")
  topics() {
    return this.recommendations.topics();
  }

  @Get("me/preferences")
  preferences(@CurrentUser() user: AuthenticatedUser) {
    return this.recommendations.getPreferences(user.id);
  }

  @Patch("me/preferences")
  updatePreferences(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateRecommendationPreferencesDto) {
    return this.recommendations.updatePreferences(user.id, dto);
  }

  @Delete("me/tags/:id")
  deleteBehavioralTag(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.recommendations.deleteBehavioralTag(user.id, id);
  }

  @Get("companions")
  companions(@CurrentUser() user: AuthenticatedUser, @Query() query: ListRecommendedCompanionsDto) {
    return this.recommendations.listCompanions(user.id, query);
  }

  @Post("events")
  recordEvents(@CurrentUser() user: AuthenticatedUser, @Body() dto: RecordRecommendationEventsDto) {
    return this.recommendations.recordEvents(user.id, dto);
  }
}
