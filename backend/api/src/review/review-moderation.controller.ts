import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";

import { CurrentReviewer } from "./decorators/current-reviewer.decorator";
import { ReviewRoles } from "./decorators/review-roles.decorator";
import { CreateReviewLabelDto } from "./dto/create-review-label.dto";
import { AssignReviewCaseDto } from "./dto/assign-review-case.dto";
import { SuspendReviewStaffDto } from "./dto/suspend-review-staff.dto";
import { ReviewCaseAction, ReviewCaseActionDto } from "./dto/review-case-action.dto";
import { ListReviewCasesQueryDto } from "./dto/list-review-cases.dto";
import { ListReviewConversationEvidenceDto } from "./dto/list-review-conversation-evidence.dto";
import { ExportReviewLabelsDto } from "./dto/export-review-labels.dto";
import {
  ListActiveReviewStaffQueryDto,
  ListReviewStaffOffboardingQueryDto
} from "./dto/list-review-staff.dto";
import { ReviewJwtAuthGuard } from "./guards/review-jwt-auth.guard";
import { ReviewRolesGuard } from "./guards/review-roles.guard";
import { AuthenticatedReviewer } from "./review-auth.types";
import { ReviewModerationService } from "./review-moderation.service";
import { ReviewStaffOffboardingService } from "./review-staff-offboarding.service";

@Controller("review")
@UseGuards(ReviewJwtAuthGuard, ReviewRolesGuard)
@ReviewRoles("reviewer", "lead")
export class ReviewModerationController {
  constructor(
    private readonly reviewModeration: ReviewModerationService,
    private readonly staffOffboarding: ReviewStaffOffboardingService
  ) {}

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
  conversation(
    @Param("id") id: string,
    @Query() query: ListReviewConversationEvidenceDto
  ) {
    return this.reviewModeration.conversationEvidence(id, query);
  }

  @Post("cases/:id/claim")
  claimCase(
    @CurrentReviewer() reviewer: AuthenticatedReviewer,
    @Param("id") id: string
  ) {
    return this.reviewModeration.claimCase(id, reviewer);
  }

  @Post("cases/:id/assignment")
  @ReviewRoles("lead")
  assignCase(
    @CurrentReviewer() reviewer: AuthenticatedReviewer,
    @Param("id") id: string,
    @Body() dto: AssignReviewCaseDto
  ) {
    return this.reviewModeration.assignCase(id, reviewer, dto.reviewerId);
  }

  @Get("staff")
  @ReviewRoles("lead")
  activeReviewers(
    @CurrentReviewer() reviewer: AuthenticatedReviewer,
    @Query() query: ListActiveReviewStaffQueryDto
  ) {
    return this.reviewModeration.listActiveReviewers(reviewer, query);
  }

  @Get("staff/offboarding")
  @ReviewRoles("lead")
  reviewStaffOffboarding(
    @CurrentReviewer() reviewer: AuthenticatedReviewer,
    @Query() query: ListReviewStaffOffboardingQueryDto
  ) {
    return this.staffOffboarding.listStaff(reviewer, query);
  }

  @Post("staff/:id/suspension")
  @ReviewRoles("lead")
  suspendReviewStaff(
    @CurrentReviewer() reviewer: AuthenticatedReviewer,
    @Param("id") id: string,
    @Body() dto: SuspendReviewStaffDto
  ) {
    return this.staffOffboarding.suspend(reviewer, id, dto);
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
  @ReviewRoles("lead")
  exportLabels(
    @CurrentReviewer() reviewer: AuthenticatedReviewer,
    @Query() query: ExportReviewLabelsDto
  ) {
    return this.reviewModeration.exportLabels(reviewer, query);
  }
}
