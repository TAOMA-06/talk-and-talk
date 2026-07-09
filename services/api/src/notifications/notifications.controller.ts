import { Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ListNotificationsQueryDto } from "./dto/list-notifications.dto";
import { NotificationsService } from "./notifications.service";

@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get("status")
  status() {
    return { module: "notifications", status: "active" };
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
