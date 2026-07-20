import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CreateSupportTicketDto } from "./dto/create-support-ticket.dto";
import { SupportService } from "./support.service";

@Controller("support")
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post("tickets")
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSupportTicketDto) {
    return this.support.create(user, dto);
  }

  @Get("tickets/me")
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.support.listMine(user.id);
  }
}
