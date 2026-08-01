import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import {
  CreateCompanionAppealDto,
  CreateCompanionIncidentDto,
  CreateWithdrawalRequestDto,
  ListCompanionLifecycleAdminDto,
  SubmitTrainingAttemptDto
} from "./dto/companion-lifecycle.dto";
import { UpsertCompanionCommercialProfileDto } from "./dto/upsert-companion-commercial-profile.dto";
import { CompanionLifecycleService } from "./companion-lifecycle.service";

@Controller("commercial/companion")
@UseGuards(JwtAuthGuard)
export class CompanionLifecycleController {
  constructor(private readonly lifecycle: CompanionLifecycleService) {}

  @Get("overview")
  overview(@CurrentUser() user: AuthenticatedUser) {
    return this.lifecycle.overview(user.id);
  }

  @Get("profile")
  profile(@CurrentUser() user: AuthenticatedUser) {
    return this.lifecycle.commercialProfile(user.id);
  }

  @Post("profile/submissions")
  submitProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpsertCompanionCommercialProfileDto
  ) {
    return this.lifecycle.submitCommercialProfile(user.id, dto);
  }

  @Get("training")
  training(@CurrentUser() user: AuthenticatedUser) {
    return this.lifecycle.training(user.id);
  }

  @Post("training/attempts")
  submitTrainingAttempt(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitTrainingAttemptDto
  ) {
    return this.lifecycle.submitTrainingAttempt(user.id, dto);
  }

  @Get("quality")
  quality(@CurrentUser() user: AuthenticatedUser) {
    return this.lifecycle.quality(user.id);
  }

  @Get("actions")
  actions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListCompanionLifecycleAdminDto = new ListCompanionLifecycleAdminDto()
  ) {
    return this.lifecycle.actions(
      user.id,
      query.active === undefined ? undefined : query.active === "true",
      query.page,
      query.pageSize,
      query.actionId
    );
  }

  @Post("actions/:id/appeals")
  appeal(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") actionId: string,
    @Body() dto: CreateCompanionAppealDto
  ) {
    return this.lifecycle.appeal(user.id, actionId, dto);
  }

  @Get("incidents")
  incidents(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListCompanionLifecycleAdminDto = new ListCompanionLifecycleAdminDto()
  ) {
    return this.lifecycle.incidents(user.id, query.incidentStatus, query.page, query.pageSize);
  }

  @Post("incidents")
  createIncident(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCompanionIncidentDto
  ) {
    return this.lifecycle.createIncident(user.id, dto);
  }

  @Get("withdrawals")
  withdrawals(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListCompanionLifecycleAdminDto = new ListCompanionLifecycleAdminDto()
  ) {
    return this.lifecycle.withdrawals(user.id, query.withdrawalStatus, query.page, query.pageSize);
  }

  @Post("withdrawals")
  requestWithdrawal(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWithdrawalRequestDto
  ) {
    return this.lifecycle.requestWithdrawal(user.id, dto);
  }

  @Post("withdrawals/:id/cancel")
  cancelWithdrawal(@CurrentUser() user: AuthenticatedUser, @Param("id") requestId: string) {
    return this.lifecycle.cancelWithdrawal(user.id, requestId);
  }
}
