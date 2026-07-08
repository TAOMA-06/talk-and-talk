import { Controller, Get } from "@nestjs/common";

@Controller("notifications")
export class NotificationsController {
  @Get("status")
  status() {
    return { module: "notifications", status: "planned" };
  }
}
