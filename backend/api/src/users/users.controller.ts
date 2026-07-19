import { Body, Controller, Delete, Get, Post, Query, UseGuards } from "@nestjs/common";

import { AuthenticatedUser } from "../auth/auth.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { SkipLegalConsent } from "../auth/decorators/skip-legal-consent.decorator";
import { CreateLegalConsentDto, GetLegalConsentDto } from "./dto/legal-consent.dto";
import { UsersService } from "./users.service";

@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get("me")
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: AuthenticatedUser) {
    return await this.usersService.getMe(user.id);
  }

  @Post("me/legal-consents")
  @SkipLegalConsent()
  @UseGuards(JwtAuthGuard)
  recordLegalConsent(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateLegalConsentDto
  ) {
    return this.usersService.recordLegalConsent(user.id, dto);
  }

  @Get("me/legal-consents")
  @SkipLegalConsent()
  @UseGuards(JwtAuthGuard)
  getLegalConsent(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetLegalConsentDto
  ) {
    return this.usersService.getLegalConsent(user.id, query.version);
  }

  @Delete("me/legal-consents/current")
  @SkipLegalConsent()
  @UseGuards(JwtAuthGuard)
  withdrawLegalConsent(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.withdrawLegalConsent(user.id);
  }
}
