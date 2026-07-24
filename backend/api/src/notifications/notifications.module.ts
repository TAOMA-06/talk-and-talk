import { Module } from "@nestjs/common";

import { NotificationsController } from "./notifications.controller";
import { NotificationDeliveryWorker } from "./notification-delivery.worker";
import { NotificationsService } from "./notifications.service";
import { WeChatSubscribeMessageProvider } from "./wechat/wechat-subscribe-message.provider";
import { WeChatSubscriptionService } from "./wechat/wechat-subscription.service";

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    WeChatSubscriptionService,
    WeChatSubscribeMessageProvider,
    NotificationDeliveryWorker
  ],
  exports: [NotificationsService, WeChatSubscribeMessageProvider]
})
export class NotificationsModule {}
