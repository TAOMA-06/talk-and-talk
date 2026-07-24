import { Module, forwardRef } from "@nestjs/common";

import { NotificationsModule } from "../notifications/notifications.module";
import { PaymentsModule } from "../payments/payments.module";
import { RecommendationsModule } from "../recommendations/recommendations.module";
import { ModerationModule } from "../moderation/moderation.module";
import { OrdersController } from "./orders.controller";
import { OrderRescheduleExpiryWorker } from "./order-reschedule-expiry.worker";
import { OrdersService } from "./orders.service";

@Module({
  imports: [forwardRef(() => PaymentsModule), NotificationsModule, RecommendationsModule, ModerationModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderRescheduleExpiryWorker],
  exports: [OrdersService]
})
export class OrdersModule {}
