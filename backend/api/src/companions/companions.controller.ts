import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Redirect, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { localOnlyModuleStatus } from "../common/status/local-only-module-status";
import { CompanionsService } from "./companions.service";
import { ApplyCompanionDto, UpdateOwnCompanionDto } from "./dto/apply-companion.dto";
import { ListCompanionAvailabilityQueryDto } from "./dto/list-companion-availability.dto";
import { ListCompanionsQueryDto } from "./dto/list-companions.dto";
import { ListOwnScheduleItemsDto } from "./dto/list-own-schedule-items.dto";
import { ListServiceOfferingsDto } from "./dto/list-service-offerings.dto";
import { CreateOwnAvailabilityWindowDto, UpdateOwnAvailabilityWindowDto } from "./dto/manage-availability-window.dto";
import {
  CreateOwnAvailabilityBlackoutDto,
  CreateOwnRecurringAvailabilityRuleDto
} from "./dto/manage-availability-schedule.dto";
import { OwnRecurringAvailabilityDraftParamsDto } from "./dto/manage-recurring-availability-draft.dto";
import { CreateOwnServiceOfferingDto, UpdateOwnServiceOfferingDto } from "./dto/manage-service-offering.dto";
import { ReserveCompanionProfileMediaDto } from "./dto/reserve-companion-profile-media.dto";

@Controller("companions")
export class CompanionsController {
  constructor(
    private readonly companionsService: CompanionsService,
    private readonly config: ConfigService
  ) {}

  @Get("status")
  status() {
    return localOnlyModuleStatus(this.config, "companions");
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

  @Post("me/profile-media/:slot/uploads")
  @UseGuards(JwtAuthGuard)
  reserveOwnProfileMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param("slot") slot: string,
    @Body() dto: ReserveCompanionProfileMediaDto
  ) {
    return this.companionsService.reserveOwnProfileMedia(user.id, slot, dto);
  }

  @Post("me/profile-media/:slot/uploads/:assetId/complete")
  @UseGuards(JwtAuthGuard)
  completeOwnProfileMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param("slot") slot: string,
    @Param("assetId") assetId: string
  ) {
    return this.companionsService.completeOwnProfileMedia(user.id, slot, assetId);
  }

  @Get("me/profile-media/:slot/uploads/:assetId")
  @UseGuards(JwtAuthGuard)
  ownProfileMediaStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param("slot") slot: string,
    @Param("assetId") assetId: string
  ) {
    return this.companionsService.ownProfileMediaStatus(user.id, slot, assetId);
  }

  @Delete("me/profile-media/:slot")
  @UseGuards(JwtAuthGuard)
  removeOwnProfileMedia(@CurrentUser() user: AuthenticatedUser, @Param("slot") slot: string) {
    return this.companionsService.removeOwnProfileMedia(user.id, slot);
  }

  @Get("me/service-offerings")
  @UseGuards(JwtAuthGuard)
  listOwnServiceOfferings(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListServiceOfferingsDto = new ListServiceOfferingsDto()
  ) {
    return this.companionsService.listOwnServiceOfferings(user.id, query);
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
  listOwnAvailabilityWindows(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListOwnScheduleItemsDto = new ListOwnScheduleItemsDto()
  ) {
    return this.companionsService.listOwnAvailabilityWindows(user.id, query);
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
  listOwnRecurringAvailabilityRules(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListOwnScheduleItemsDto = new ListOwnScheduleItemsDto()
  ) {
    return this.companionsService.listOwnRecurringAvailabilityRules(user.id, query);
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
  listOwnAvailabilityBlackouts(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListOwnScheduleItemsDto = new ListOwnScheduleItemsDto()
  ) {
    return this.companionsService.listOwnAvailabilityBlackouts(user.id, query);
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
  listOwnRecurringAvailabilityDrafts(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListOwnScheduleItemsDto = new ListOwnScheduleItemsDto()
  ) {
    return this.companionsService.listOwnRecurringAvailabilityDrafts(user.id, query);
  }

  @Post("me/availability-schedule/drafts/materialize")
  @UseGuards(JwtAuthGuard)
  materializeOwnRecurringAvailabilityDrafts(@CurrentUser() user: AuthenticatedUser) {
    return this.companionsService.materializeOwnRecurringAvailabilityDrafts(user.id);
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
  listServiceOfferings(
    @Param("id") id: string,
    @Query() query: ListServiceOfferingsDto = new ListServiceOfferingsDto()
  ) {
    return this.companionsService.listPublishedServiceOfferings(id, query);
  }

  @Get(":id/availability")
  listAvailability(@Param("id") id: string, @Query() query: ListCompanionAvailabilityQueryDto) {
    return this.companionsService.listPublishedAvailability(id, query);
  }

  @Get(":id/media/:slot")
  @Redirect(undefined, 302)
  @HttpCode(302)
  async profileMedia(@Param("id") id: string, @Param("slot") slot: string) {
    return { url: await this.companionsService.publicProfileMediaReadUrl(id, slot) };
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.companionsService.getPublished(id);
  }
}
