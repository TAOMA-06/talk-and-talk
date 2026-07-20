import { Module, forwardRef } from "@nestjs/common";

import { NotificationsModule } from "../notifications/notifications.module";
import { PaymentsModule } from "../payments/payments.module";
import { RecommendationsModule } from "../recommendations/recommendations.module";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";

@Module({
  imports: [forwardRef(() => PaymentsModule), NotificationsModule, RecommendationsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService]
})
export class OrdersModule {}
