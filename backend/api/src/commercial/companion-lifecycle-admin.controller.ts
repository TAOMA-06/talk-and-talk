import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import {
  AssignCompanionAppealDto,
  AssignCompanionIncidentDto,
  CompleteCompanionReactivationDto,
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

  @Post("actions/:id/reactivation")
  @Roles("supply", "admin")
  completeExpiredSuspensionReactivation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") actionId: string,
    @Body() dto: CompleteCompanionReactivationDto
  ) {
    return this.lifecycle.completeExpiredSuspensionReactivation(actor.id, actionId, dto);
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

  @Get("appeals/claimable")
  @Roles("supply")
  claimableAppeals(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListCompanionLifecycleAdminDto
  ) {
    return this.lifecycle.claimableAppeals(actor.id, query.page, query.pageSize);
  }

  @Post("appeals/:id/claims")
  @HttpCode(200)
  @Roles("supply")
  claimAppeal(@CurrentUser() actor: AuthenticatedUser, @Param("id") appealId: string) {
    return this.lifecycle.claimAppeal(actor.id, appealId);
  }

  @Post("appeals/:id/assignments")
  @HttpCode(200)
  @Roles("admin")
  assignAppeal(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") appealId: string,
    @Body() dto: AssignCompanionAppealDto
  ) {
    return this.lifecycle.assignAppeal(actor.id, appealId, dto);
  }

  @Post("appeals/:id/reactivation")
  @Roles("supply", "admin")
  completeReactivation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") appealId: string,
    @Body() dto: CompleteCompanionReactivationDto
  ) {
    return this.lifecycle.completeAppealReactivation(actor.id, appealId, dto);
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
      query.pageSize,
      query.reactivationStatus
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
  actions(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListCompanionLifecycleAdminDto
  ) {
    return this.lifecycle.adminAccountActions(
      actor.id,
      query.active === undefined ? undefined : query.active === "true",
      query.page,
      query.pageSize,
      query.reactivationStatus
    );
  }

  @Get("incidents")
  @Roles("supply", "admin")
  incidents(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListCompanionLifecycleAdminDto
  ) {
    return this.lifecycle.adminIncidents(
      actor.id,
      query.incidentStatus,
      query.page,
      query.pageSize
    );
  }

  @Get("incidents/claimable")
  @Roles("supply")
  claimableIncidents(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListCompanionLifecycleAdminDto
  ) {
    return this.lifecycle.claimableIncidents(
      actor.id,
      query.incidentStatus,
      query.page,
      query.pageSize
    );
  }

  @Get("incidents/:id")
  @Roles("supply", "admin")
  incident(@CurrentUser() actor: AuthenticatedUser, @Param("id") incidentId: string) {
    return this.lifecycle.adminIncident(actor.id, incidentId);
  }

  @Post("incidents/:id/claims")
  @HttpCode(200)
  @Roles("supply")
  claimIncident(@CurrentUser() actor: AuthenticatedUser, @Param("id") incidentId: string) {
    return this.lifecycle.claimIncident(actor.id, incidentId);
  }

  @Post("incidents/:id/assignments")
  @HttpCode(200)
  @Roles("admin")
  assignIncident(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") incidentId: string,
    @Body() dto: AssignCompanionIncidentDto
  ) {
    return this.lifecycle.assignIncident(actor.id, incidentId, dto);
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
