import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, UseGuards } from "@nestjs/common";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { SkipLegalConsent } from "../auth/decorators/skip-legal-consent.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CustomerAdultEligibilityService } from "./customer-adult-eligibility.service";
import { SubmitCustomerAdultEligibilityDto } from "./dto/customer-adult-eligibility.dto";
import { UpdateMeDto } from "./dto/update-me.dto";
import { UsersService } from "./users.service";

@Controller()
export class MeController {
  constructor(
    private readonly usersService: UsersService,
    private readonly adultEligibility: CustomerAdultEligibilityService
  ) {}

  @Get("me")
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: AuthenticatedUser) {
    return await this.usersService.getMe(user.id);
  }

  @Patch("me")
  @UseGuards(JwtAuthGuard)
  async updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateMeDto) {
    return await this.usersService.updateMe(user.id, dto);
  }

  @Get("me/adult-eligibility")
  @UseGuards(JwtAuthGuard)
  getAdultEligibility(@CurrentUser() user: AuthenticatedUser) {
    return this.adultEligibility.getMyStatus(user.id);
  }

  @Post("me/adult-eligibility/submissions")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  submitAdultEligibility(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitCustomerAdultEligibilityDto
  ) {
    return this.adultEligibility.submit(user.id, dto);
  }

  @Get("me/deletion-request")
  @SkipLegalConsent()
  @UseGuards(JwtAuthGuard)
  async getDeletionRequest(@CurrentUser() user: AuthenticatedUser) {
    return await this.usersService.getMyDeletionRequest(user.id);
  }

  @Post("me/deletion-request")
  @SkipLegalConsent()
  @UseGuards(JwtAuthGuard)
  async requestDeletion(@CurrentUser() user: AuthenticatedUser) {
    return await this.usersService.requestDeletion(user.id);
  }

  @Post("me/deletion-request/cancel")
  @HttpCode(HttpStatus.OK)
  @SkipLegalConsent()
  @UseGuards(JwtAuthGuard)
  async cancelDeletionRequest(@CurrentUser() user: AuthenticatedUser) {
    return await this.usersService.cancelMyDeletionRequest(user.id);
  }
}
