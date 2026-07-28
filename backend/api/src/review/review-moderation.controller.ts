import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";

import { CurrentReviewer } from "./decorators/current-reviewer.decorator";
import { ReviewRoles } from "./decorators/review-roles.decorator";
import { CreateReviewLabelDto } from "./dto/create-review-label.dto";
import { ReviewCaseAction, ReviewCaseActionDto } from "./dto/review-case-action.dto";
import { ListReviewCasesQueryDto } from "./dto/list-review-cases.dto";
import { ReviewJwtAuthGuard } from "./guards/review-jwt-auth.guard";
import { ReviewRolesGuard } from "./guards/review-roles.guard";
import { AuthenticatedReviewer } from "./review-auth.types";
import { ReviewModerationService } from "./review-moderation.service";

@Controller("review")
@UseGuards(ReviewJwtAuthGuard, ReviewRolesGuard)
@ReviewRoles("reviewer", "lead")
export class ReviewModerationController {
  constructor(private readonly reviewModeration: ReviewModerationService) {}

  @Get("overview")
  overview() {
    return this.reviewModeration.overview();
  }

  @Get("cases")
  listCases(@Query() query: ListReviewCasesQueryDto) {
    return this.reviewModeration.listCases(query);
  }

  @Get("cases/:id")
  getCase(@Param("id") id: string) {
    return this.reviewModeration.getCase(id);
  }

  @Get("cases/:id/conversation")
  conversation(@Param("id") id: string) {
    return this.reviewModeration.conversationEvidence(id);
  }

  @Post("cases/:id/actions")
  applyAction(
    @CurrentReviewer() reviewer: AuthenticatedReviewer,
    @Param("id") id: string,
    @Body() dto: ReviewCaseActionDto
  ) {
    return this.reviewModeration.applyAction(id, reviewer, dto.action as ReviewCaseAction, dto.note);
  }

  @Post("labels")
  createLabel(@CurrentReviewer() reviewer: AuthenticatedReviewer, @Body() dto: CreateReviewLabelDto) {
    return this.reviewModeration.createLabel(reviewer, dto);
  }

  @Get("labels/export")
  exportLabels() {
    return this.reviewModeration.exportLabels();
  }
}
