import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { localOnlyModuleStatus } from "../common/status/local-only-module-status";
import { ListNotificationsQueryDto } from "./dto/list-notifications.dto";
import { CreateSubscriptionGrantDto } from "./dto/create-subscription-grant.dto";
import { NotificationsService } from "./notifications.service";
import { WeChatSubscriptionService } from "./wechat/wechat-subscription.service";

@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly subscriptions: WeChatSubscriptionService,
    private readonly config: ConfigService
  ) {}

  @Get("status")
  status() {
    return localOnlyModuleStatus(this.config, "notifications");
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListNotificationsQueryDto) {
    return this.notificationsService.list(user.id, query);
  }

  @Get("unread-count")
  @UseGuards(JwtAuthGuard)
  unreadCount(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.unreadCount(user.id);
  }

  @Get("subscription-templates")
  @UseGuards(JwtAuthGuard)
  subscriptionTemplates(@Query("keys") keys?: string) {
    const requested = keys?.split(",").map((key) => key.trim()).filter(Boolean);
    return this.subscriptions.listTemplates(requested);
  }

  @Get("channels/availability-reminder")
  @UseGuards(JwtAuthGuard)
  availabilityReminderChannel() {
    return this.subscriptions.availabilityReminderChannel();
  }

  @Post("subscription-grants")
  @UseGuards(JwtAuthGuard)
  subscriptionGrant(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSubscriptionGrantDto
  ) {
    return this.subscriptions.recordGrant(user.id, dto.templateKey, dto.granted);
  }

  @Post("read-all")
  @UseGuards(JwtAuthGuard)
  readAll(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.markAllRead(user.id);
  }

  @Post(":id/read")
  @UseGuards(JwtAuthGuard)
  readOne(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.notificationsService.markRead(user.id, id);
  }
}
