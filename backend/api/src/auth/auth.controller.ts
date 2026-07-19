import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";

import { clientIp } from "../common/rate-limit/ip-rate-limit.middleware";
import { AuthService } from "./auth.service";
import { SendCodeDto } from "./dto/send-code.dto";
import { PhoneLoginDto } from "./dto/phone-login.dto";
import { AppleLoginDto } from "./dto/apple-login.dto";
import { WechatMiniProgramLoginDto } from "./dto/wechat-mini-program-login.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
import { StaffLoginDto } from "./dto/staff-login.dto";
import { SkipLegalConsent } from "./decorators/skip-legal-consent.decorator";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("sms/send-code")
  async sendCode(@Body() dto: SendCodeDto, @Req() req: Request) {
    return this.authService.sendCode(dto.phone, clientIp(req));
  }

  @Post("phone/login")
  async phoneLogin(@Body() dto: PhoneLoginDto) {
    return this.authService.loginWithPhone(dto.phone, dto.code);
  }

  @Post("staff/login")
  async staffLogin(@Body() dto: StaffLoginDto, @Req() req: Request) {
    return this.authService.loginStaff(dto.username, dto.password, dto.totpCode, clientIp(req));
  }

  @Post("apple")
  async appleLogin(@Body() dto: AppleLoginDto) {
    return this.authService.loginWithApple(dto.identityToken);
  }

  @Post("wechat/mini-program")
  async wechatMiniProgramLogin(@Body() dto: WechatMiniProgramLoginDto) {
    return this.authService.loginWithWechatMiniProgram(dto.code);
  }

  @Get("wechat/mini-program/status")
  wechatMiniProgramStatus() {
    return this.authService.wechatMiniProgramStatus();
  }

  @Post("refresh")
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post("logout")
  @SkipLegalConsent()
  @UseGuards(JwtAuthGuard)
  async logout(@Body() dto: RefreshTokenDto) {
    await this.authService.logout(dto.refreshToken);
    return { success: true };
  }
}
