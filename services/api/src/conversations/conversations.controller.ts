import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";

import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ConversationsService } from "./conversations.service";
import { ListMessagesQueryDto } from "./dto/list-messages.dto";
import { SendMessageDto } from "./dto/send-message.dto";

@Controller("conversations")
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get("status")
  status() {
    return { module: "conversations", status: "active" };
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.conversationsService.list(user.id);
  }

  @Get(":id/messages")
  @UseGuards(JwtAuthGuard)
  messages(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Query() query: ListMessagesQueryDto
  ) {
    return this.conversationsService.messages(user.id, id, query);
  }

  @Post(":id/messages")
  @UseGuards(JwtAuthGuard)
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: SendMessageDto
  ) {
    return this.conversationsService.send(user.id, id, dto);
  }
}
