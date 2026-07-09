import { Body, Controller, Get, Patch, Post, UseGuards } from "@nestjs/common";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UpdateMeDto } from "./dto/update-me.dto";
import { UsersService } from "./users.service";

@Controller()
export class MeController {
  constructor(private readonly usersService: UsersService) {}

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

  @Post("me/deletion-request")
  @UseGuards(JwtAuthGuard)
  async requestDeletion(@CurrentUser() user: AuthenticatedUser) {
    return await this.usersService.requestDeletion(user.id);
  }
}
