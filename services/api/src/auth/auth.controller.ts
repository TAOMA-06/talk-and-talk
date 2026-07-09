import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";

import { AuthService } from "./auth.service";
import { SendCodeDto } from "./dto/send-code.dto";
import { PhoneLoginDto } from "./dto/phone-login.dto";
import { AppleLoginDto } from "./dto/apple-login.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("sms/send-code")
  async sendCode(@Body() dto: SendCodeDto, @Req() req: Request) {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip;
    return this.authService.sendCode(dto.phone, ip);
  }

  @Post("phone/login")
  async phoneLogin(@Body() dto: PhoneLoginDto) {
    return this.authService.loginWithPhone(dto.phone, dto.code);
  }

  @Post("apple")
  async appleLogin(@Body() dto: AppleLoginDto) {
    return this.authService.loginWithApple(dto.identityToken);
  }

  @Post("refresh")
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post("logout")
  @UseGuards(JwtAuthGuard)
  async logout(@Body() dto: RefreshTokenDto) {
    await this.authService.logout(dto.refreshToken);
    return { success: true };
  }
}
