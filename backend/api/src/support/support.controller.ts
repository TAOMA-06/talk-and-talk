import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { AddOrderSupportFactDto } from "./dto/add-order-support-fact.dto";
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

  @Post("tickets/:id/order-facts")
  addOrderFact(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") ticketId: string,
    @Body() dto: AddOrderSupportFactDto
  ) {
    return this.support.addOrderFact(user, ticketId, dto);
  }

  @Get("tickets/me")
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.support.listMine(user.id);
  }
}
