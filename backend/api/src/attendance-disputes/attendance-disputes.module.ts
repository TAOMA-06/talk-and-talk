import { Module } from "@nestjs/common";

import { CommercialModule } from "../commercial/commercial.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ModerationModule } from "../moderation/moderation.module";
import { PaymentsModule } from "../payments/payments.module";
import {
  AdminAttendanceDisputesController,
  AttendanceDisputesController
} from "./attendance-disputes.controller";
import { AttendanceDisputesService } from "./attendance-disputes.service";

@Module({
  imports: [CommercialModule, PaymentsModule, NotificationsModule, ModerationModule],
  controllers: [AttendanceDisputesController, AdminAttendanceDisputesController],
  providers: [AttendanceDisputesService],
  exports: [AttendanceDisputesService]
})
export class AttendanceDisputesModule {}
