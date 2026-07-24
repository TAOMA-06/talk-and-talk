import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CompanionsService } from "./companions.service";
import { ApplyCompanionDto, UpdateOwnCompanionDto } from "./dto/apply-companion.dto";
import { ListCompanionAvailabilityQueryDto } from "./dto/list-companion-availability.dto";
import { ListCompanionsQueryDto } from "./dto/list-companions.dto";
import { CreateOwnAvailabilityWindowDto, UpdateOwnAvailabilityWindowDto } from "./dto/manage-availability-window.dto";
import {
  CreateOwnAvailabilityBlackoutDto,
  CreateOwnRecurringAvailabilityRuleDto
} from "./dto/manage-availability-schedule.dto";
import { OwnRecurringAvailabilityDraftParamsDto } from "./dto/manage-recurring-availability-draft.dto";
import { CreateOwnServiceOfferingDto, UpdateOwnServiceOfferingDto } from "./dto/manage-service-offering.dto";

@Controller("companions")
export class CompanionsController {
  constructor(private readonly companionsService: CompanionsService) {}

  @Get("status")
  status() {
    return { module: "companions", status: "active" };
  }

  @Get()
  list(@Query() query: ListCompanionsQueryDto) {
    return this.companionsService.list(query);
  }

  @Get("me/profile")
  @UseGuards(JwtAuthGuard)
  getOwn(@CurrentUser() user: AuthenticatedUser) {
    return this.companionsService.getOwn(user.id);
  }

  @Post("me/application")
  @UseGuards(JwtAuthGuard)
  apply(@CurrentUser() user: AuthenticatedUser, @Body() dto: ApplyCompanionDto) {
    return this.companionsService.apply(user.id, dto);
  }

  @Patch("me/profile")
  @UseGuards(JwtAuthGuard)
  updateOwn(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateOwnCompanionDto) {
    return this.companionsService.updateOwn(user.id, dto);
  }

  @Get("me/service-offerings")
  @UseGuards(JwtAuthGuard)
  listOwnServiceOfferings(@CurrentUser() user: AuthenticatedUser) {
    return this.companionsService.listOwnServiceOfferings(user.id);
  }

  @Post("me/service-offerings")
  @UseGuards(JwtAuthGuard)
  createOwnServiceOffering(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOwnServiceOfferingDto) {
    return this.companionsService.createOwnServiceOffering(user.id, dto);
  }

  @Patch("me/service-offerings/:id")
  @UseGuards(JwtAuthGuard)
  updateOwnServiceOffering(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: UpdateOwnServiceOfferingDto
  ) {
    return this.companionsService.updateOwnServiceOffering(user.id, id, dto);
  }

  @Get("me/availability-windows")
  @UseGuards(JwtAuthGuard)
  listOwnAvailabilityWindows(@CurrentUser() user: AuthenticatedUser) {
    return this.companionsService.listOwnAvailabilityWindows(user.id);
  }

  @Post("me/availability-windows")
  @UseGuards(JwtAuthGuard)
  createOwnAvailabilityWindow(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOwnAvailabilityWindowDto) {
    return this.companionsService.createOwnAvailabilityWindow(user.id, dto);
  }

  @Patch("me/availability-windows/:id")
  @UseGuards(JwtAuthGuard)
  updateOwnAvailabilityWindow(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: UpdateOwnAvailabilityWindowDto
  ) {
    return this.companionsService.updateOwnAvailabilityWindow(user.id, id, dto);
  }

  @Get("me/availability-schedule/rules")
  @UseGuards(JwtAuthGuard)
  listOwnRecurringAvailabilityRules(@CurrentUser() user: AuthenticatedUser) {
    return this.companionsService.listOwnRecurringAvailabilityRules(user.id);
  }

  @Post("me/availability-schedule/rules")
  @UseGuards(JwtAuthGuard)
  createOwnRecurringAvailabilityRule(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOwnRecurringAvailabilityRuleDto
  ) {
    return this.companionsService.createOwnRecurringAvailabilityRule(user.id, dto);
  }

  @Patch("me/availability-schedule/rules/:id/deactivate")
  @UseGuards(JwtAuthGuard)
  deactivateOwnRecurringAvailabilityRule(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.companionsService.deactivateOwnRecurringAvailabilityRule(user.id, id);
  }

  @Get("me/availability-schedule/blackouts")
  @UseGuards(JwtAuthGuard)
  listOwnAvailabilityBlackouts(@CurrentUser() user: AuthenticatedUser) {
    return this.companionsService.listOwnAvailabilityBlackouts(user.id);
  }

  @Post("me/availability-schedule/blackouts")
  @UseGuards(JwtAuthGuard)
  createOwnAvailabilityBlackout(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOwnAvailabilityBlackoutDto) {
    return this.companionsService.createOwnAvailabilityBlackout(user.id, dto);
  }

  @Patch("me/availability-schedule/blackouts/:id/deactivate")
  @UseGuards(JwtAuthGuard)
  deactivateOwnAvailabilityBlackout(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.companionsService.deactivateOwnAvailabilityBlackout(user.id, id);
  }

  @Get("me/availability-schedule/drafts")
  @UseGuards(JwtAuthGuard)
  listOwnRecurringAvailabilityDrafts(@CurrentUser() user: AuthenticatedUser) {
    return this.companionsService.listOwnRecurringAvailabilityDrafts(user.id);
  }

  @Patch("me/availability-schedule/drafts/:id/activate")
  @UseGuards(JwtAuthGuard)
  activateOwnRecurringAvailabilityDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: OwnRecurringAvailabilityDraftParamsDto
  ) {
    return this.companionsService.activateOwnRecurringAvailabilityDraft(user.id, params);
  }

  @Get(":id/service-offerings")
  listServiceOfferings(@Param("id") id: string) {
    return this.companionsService.listPublishedServiceOfferings(id);
  }

  @Get(":id/availability")
  listAvailability(@Param("id") id: string, @Query() query: ListCompanionAvailabilityQueryDto) {
    return this.companionsService.listPublishedAvailability(id, query);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.companionsService.getPublished(id);
  }
}
