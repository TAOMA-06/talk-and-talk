import { Body, Controller, Get, NotFoundException, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ConversationsService } from "./conversations.service";
import { ListConversationsDto } from "./dto/list-conversations.dto";
import { ListMessagesQueryDto } from "./dto/list-messages.dto";
import { ReserveMediaUploadDto } from "./dto/reserve-media-upload.dto";
import { SendMessageDto } from "./dto/send-message.dto";
import { SetConversationBlockDto } from "./dto/set-conversation-block.dto";
import { SetConversationNotificationPreferenceDto } from "./dto/set-conversation-notification-preference.dto";
import { SetFutureBookingBoundaryDto } from "./dto/set-future-booking-boundary.dto";

@Controller("conversations")
export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly config: ConfigService
  ) {}

  @Get("status")
  status() {
    const appEnv = this.config.getOrThrow<string>("APP_ENV");
    if (appEnv === "production" || appEnv === "staging") {
      throw new NotFoundException();
    }
    return this.conversationsService.status();
  }

  @Get(":id/status")
  @UseGuards(JwtAuthGuard)
  conversationStatus(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.conversationsService.conversationStatus(user.id, id);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListConversationsDto) {
    return this.conversationsService.list(user.id, query);
  }

  @Get("summary")
  @UseGuards(JwtAuthGuard)
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.conversationsService.summary(user.id);
  }

  @Put(":id/notification-preference")
  @UseGuards(JwtAuthGuard)
  setNotificationPreference(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: SetConversationNotificationPreferenceDto
  ) {
    return this.conversationsService.setMessageNotificationsMuted(user.id, id, dto);
  }

  @Put(":id/block")
  @UseGuards(JwtAuthGuard)
  setBlock(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: SetConversationBlockDto
  ) {
    return this.conversationsService.setConversationBlocked(user.id, id, dto);
  }

  @Put(":id/future-booking-boundary")
  @UseGuards(JwtAuthGuard)
  setFutureBookingBoundary(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: SetFutureBookingBoundaryDto
  ) {
    return this.conversationsService.setFutureBookingBoundary(user.id, id, dto);
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

  @Post(":id/media-uploads")
  @UseGuards(JwtAuthGuard)
  reserveMediaUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: ReserveMediaUploadDto
  ) {
    return this.conversationsService.reserveMediaUpload(user.id, id, dto);
  }

  @Post(":id/media-uploads/:assetId/complete")
  @UseGuards(JwtAuthGuard)
  completeMediaUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("assetId") assetId: string
  ) {
    return this.conversationsService.completeMediaUpload(user.id, id, assetId);
  }
}
