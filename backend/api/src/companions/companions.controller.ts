import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CompanionsService } from "./companions.service";
import { ApplyCompanionDto, UpdateOwnCompanionDto } from "./dto/apply-companion.dto";
import { ListCompanionsQueryDto } from "./dto/list-companions.dto";

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

  @Get(":id")
  get(@Param("id") id: string) {
    return this.companionsService.getPublished(id);
  }
}
