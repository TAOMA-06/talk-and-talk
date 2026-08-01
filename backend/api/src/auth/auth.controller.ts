import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";

import { clientIp } from "../common/rate-limit/ip-rate-limit.middleware";
import { AuthenticatedUser, AuthService } from "./auth.service";
import { SendCodeDto } from "./dto/send-code.dto";
import { PhoneLoginDto } from "./dto/phone-login.dto";
import { AppleLoginDto } from "./dto/apple-login.dto";
import { WechatMiniProgramLoginDto } from "./dto/wechat-mini-program-login.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
import { StaffLoginDto } from "./dto/staff-login.dto";
import { CurrentUser } from "./decorators/current-user.decorator";
import { SkipLegalConsent } from "./decorators/skip-legal-consent.decorator";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";

function safeHeader(req: Request | undefined, name: string, maxLength: number): string | null {
  const raw = req?.headers?.[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
  return cleaned || null;
}

function sessionMetadata(req?: Request) {
  const sessionLabel =
    safeHeader(req, "x-client-label", 80)
    ?? safeHeader(req, "x-session-label", 80)
    ?? safeHeader(req, "user-agent", 80);
  const clientPlatform = safeHeader(req, "x-client-platform", 32);
  return sessionLabel || clientPlatform ? { sessionLabel, clientPlatform } : undefined;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("sms/send-code")
  async sendCode(@Body() dto: SendCodeDto, @Req() req: Request) {
    return this.authService.sendCode(dto.phone, clientIp(req));
  }

  @Post("phone/login")
  async phoneLogin(@Body() dto: PhoneLoginDto, @Req() req?: Request) {
    const metadata = sessionMetadata(req);
    return metadata
      ? this.authService.loginWithPhone(dto.phone, dto.code, metadata)
      : this.authService.loginWithPhone(dto.phone, dto.code);
  }

  @Post("staff/login")
  async staffLogin(@Body() dto: StaffLoginDto, @Req() req: Request) {
    return this.authService.loginStaff(
      dto.username,
      dto.password,
      dto.totpCode,
      clientIp(req),
      sessionMetadata(req)
    );
  }

  @Post("apple")
  async appleLogin(@Body() dto: AppleLoginDto, @Req() req?: Request) {
    const metadata = sessionMetadata(req);
    return metadata
      ? this.authService.loginWithApple(dto.identityToken, metadata)
      : this.authService.loginWithApple(dto.identityToken);
  }

  @Post("wechat/mini-program")
  async wechatMiniProgramLogin(@Body() dto: WechatMiniProgramLoginDto, @Req() req?: Request) {
    const metadata = sessionMetadata(req);
    return metadata
      ? this.authService.loginWithWechatMiniProgram(dto.code, metadata)
      : this.authService.loginWithWechatMiniProgram(dto.code);
  }

  @Get("wechat/mini-program/status")
  wechatMiniProgramStatus() {
    return this.authService.wechatMiniProgramStatus();
  }

  @Post("refresh")
  async refresh(@Body() dto: RefreshTokenDto, @Req() req?: Request) {
    const metadata = sessionMetadata(req);
    return metadata
      ? this.authService.refresh(dto.refreshToken, metadata)
      : this.authService.refresh(dto.refreshToken);
  }

  @Post("logout")
  @SkipLegalConsent()
  @UseGuards(JwtAuthGuard)
  async logout(@CurrentUser() user: AuthenticatedUser, @Body() dto: RefreshTokenDto) {
    await this.authService.logout(user.id, dto.refreshToken);
    return { success: true };
  }
}
