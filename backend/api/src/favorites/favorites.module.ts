import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { RolesGuard } from "../auth/guards/roles.guard";
import { NotificationsModule } from "../notifications/notifications.module";
import { AvailabilityReminderAttemptConsumptionService } from "./availability-reminder-attempt-consumption.service";
import { AvailabilityReminderAttemptDeliveryService } from "./availability-reminder-attempt-delivery.service";
import { AvailabilityReminderDeliveryRunner } from "./availability-reminder-delivery.runner";
import { AvailabilityReminderAttemptService } from "./availability-reminder-attempt.service";
import { AvailabilityReminderCandidateService } from "./availability-reminder-candidate.service";
import { AvailabilityReminderHandoffService } from "./availability-reminder-handoff.service";
import { AvailabilityReminderPreparationService } from "./availability-reminder-preparation.service";
import { AvailabilityReminderPreparationRunner } from "./availability-reminder-preparation.runner";
import { AvailabilityReminderPreflightService } from "./availability-reminder-preflight.service";
import { AvailabilityReminderReadinessService } from "./availability-reminder-readiness.service";
import { FavoritesController } from "./favorites.controller";
import { FavoritesService } from "./favorites.service";
import { RecentlyViewedCompanionsController } from "./recently-viewed-companions.controller";

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [FavoritesController, RecentlyViewedCompanionsController],
  providers: [
    FavoritesService,
    AvailabilityReminderAttemptConsumptionService,
    AvailabilityReminderAttemptDeliveryService,
    AvailabilityReminderDeliveryRunner,
    AvailabilityReminderAttemptService,
    AvailabilityReminderCandidateService,
    AvailabilityReminderHandoffService,
    AvailabilityReminderPreparationService,
    AvailabilityReminderPreparationRunner,
    AvailabilityReminderPreflightService,
    AvailabilityReminderReadinessService,
    RolesGuard
  ],
  exports: [
    AvailabilityReminderAttemptConsumptionService,
    AvailabilityReminderAttemptDeliveryService,
    AvailabilityReminderAttemptService,
    AvailabilityReminderCandidateService,
    AvailabilityReminderHandoffService,
    AvailabilityReminderPreparationService,
    AvailabilityReminderPreflightService,
    AvailabilityReminderReadinessService
  ]
})
export class FavoritesModule {}
