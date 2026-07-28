import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";

import { clientIp } from "../common/rate-limit/ip-rate-limit.middleware";
import { CurrentReviewer } from "./decorators/current-reviewer.decorator";
import { ReviewLoginDto } from "./dto/review-login.dto";
import { ReviewRefreshTokenDto } from "./dto/review-refresh-token.dto";
import { ReviewJwtAuthGuard } from "./guards/review-jwt-auth.guard";
import { ReviewAuthService } from "./review-auth.service";
import { AuthenticatedReviewer } from "./review-auth.types";

@Controller("review/auth")
export class ReviewAuthController {
  constructor(private readonly reviewAuth: ReviewAuthService) {}

  @Post("login")
  login(@Body() dto: ReviewLoginDto, @Req() req: Request) {
    return this.reviewAuth.login(dto.username, dto.password, dto.totpCode, clientIp(req));
  }

  @Post("refresh")
  refresh(@Body() dto: ReviewRefreshTokenDto) {
    return this.reviewAuth.refresh(dto.refreshToken);
  }

  @Post("logout")
  @UseGuards(ReviewJwtAuthGuard)
  async logout(@CurrentReviewer() reviewer: AuthenticatedReviewer, @Body() dto: ReviewRefreshTokenDto) {
    await this.reviewAuth.logout(reviewer.id, dto.refreshToken);
    return { success: true };
  }

  @Get("me")
  @UseGuards(ReviewJwtAuthGuard)
  me(@CurrentReviewer() reviewer: AuthenticatedReviewer) {
    return { reviewer };
  }
}
