import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import {
  CreateCompanionAccountActionDto,
  ListCompanionLifecycleAdminDto,
  ResolveCompanionAppealDto,
  ResolveCompanionIncidentDto,
  ReviewCompanionVoiceIntroDto,
  UpdateWithdrawalRequestDto
} from "./dto/companion-lifecycle.dto";
import { CompanionLifecycleService } from "./companion-lifecycle.service";

@Controller("admin/commercial/companion-lifecycle")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("supply", "finance", "admin")
export class CompanionLifecycleAdminController {
  constructor(private readonly lifecycle: CompanionLifecycleService) {}

  @Post("actions")
  @Roles("supply", "admin")
  createAction(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateCompanionAccountActionDto
  ) {
    return this.lifecycle.createAccountAction(actor.id, dto);
  }

  @Post("appeals/:id/resolution")
  @Roles("supply", "admin")
  resolveAppeal(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") appealId: string,
    @Body() dto: ResolveCompanionAppealDto
  ) {
    return this.lifecycle.resolveAppeal(actor.id, appealId, dto);
  }

  @Get("appeals")
  @Roles("supply", "admin")
  appeals(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListCompanionLifecycleAdminDto
  ) {
    return this.lifecycle.adminAppeals(
      actor.id,
      query.appealStatus,
      query.page,
      query.pageSize
    );
  }

  @Get("voice-intros")
  @Roles("supply", "admin")
  voiceIntros(@Query() query: ListCompanionLifecycleAdminDto) {
    return this.lifecycle.adminVoiceIntros(query.voiceIntroStatus, query.page, query.pageSize);
  }

  @Get("companions/:id/voice-intro-read")
  @Roles("supply", "admin")
  voiceIntroRead(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") companionId: string
  ) {
    return this.lifecycle.createVoiceIntroReadUrl(actor.id, companionId);
  }

  @Post("companions/:id/voice-intro-review")
  @Roles("supply", "admin")
  reviewVoiceIntro(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") companionId: string,
    @Body() dto: ReviewCompanionVoiceIntroDto
  ) {
    return this.lifecycle.reviewVoiceIntro(actor.id, companionId, dto);
  }

  @Get("training")
  @Roles("supply", "admin")
  training(@Query() query: ListCompanionLifecycleAdminDto) {
    return this.lifecycle.adminTraining(query.trainingStatus, query.page, query.pageSize);
  }

  @Get("review-due")
  @Roles("supply", "admin")
  reviewDue(@Query() query: ListCompanionLifecycleAdminDto) {
    return this.lifecycle.adminReviewDue(query.page, query.pageSize);
  }

  @Get("actions")
  @Roles("supply", "admin")
  actions(@Query() query: ListCompanionLifecycleAdminDto) {
    return this.lifecycle.adminAccountActions(
      query.active === undefined ? undefined : query.active === "true",
      query.page,
      query.pageSize
    );
  }

  @Get("incidents")
  @Roles("supply", "admin")
  incidents(@Query() query: ListCompanionLifecycleAdminDto) {
    return this.lifecycle.adminIncidents(query.incidentStatus, query.page, query.pageSize);
  }

  @Post("incidents/:id/status")
  @Roles("supply", "admin")
  resolveIncident(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") incidentId: string,
    @Body() dto: ResolveCompanionIncidentDto
  ) {
    return this.lifecycle.resolveIncident(actor.id, incidentId, dto);
  }

  @Get("withdrawals")
  @Roles("finance", "admin")
  withdrawals(@Query() query: ListCompanionLifecycleAdminDto) {
    return this.lifecycle.adminWithdrawals(query.withdrawalStatus, query.page, query.pageSize);
  }

  @Post("withdrawals/:id/status")
  @Roles("finance", "admin")
  updateWithdrawal(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") requestId: string,
    @Body() dto: UpdateWithdrawalRequestDto
  ) {
    return this.lifecycle.updateWithdrawal(actor.id, requestId, dto);
  }
}
