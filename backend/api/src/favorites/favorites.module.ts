import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuditModule } from "../common/audit/audit.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { AvailabilityReminderAttemptConsumptionService } from "./availability-reminder-attempt-consumption.service";
import { AvailabilityReminderAttemptDeliveryService } from "./availability-reminder-attempt-delivery.service";
import { AvailabilityReminderDeliveryRunner } from "./availability-reminder-delivery.runner";
import { AvailabilityReminderAttemptService } from "./availability-reminder-attempt.service";
import { AvailabilityReminderCandidateService } from "./availability-reminder-candidate.service";
import { AvailabilityReminderFanoutService } from "./availability-reminder-fanout.service";
import { AvailabilityReminderHandoffService } from "./availability-reminder-handoff.service";
import { AvailabilityReminderOperationsController } from "./availability-reminder-operations.controller";
import { AvailabilityReminderPreparationService } from "./availability-reminder-preparation.service";
import { AvailabilityReminderPreparationRunner } from "./availability-reminder-preparation.runner";
import { AvailabilityReminderPreflightService } from "./availability-reminder-preflight.service";
import { AvailabilityReminderReservationService } from "./availability-reminder-reservation.service";
import { AvailabilityReminderWorkerRetryService } from "./availability-reminder-worker-retry.service";
import { AvailabilityReminderTerminalResolutionService } from "./availability-reminder-terminal-resolution.service";
import { FavoritesController } from "./favorites.controller";
import { FavoritesService } from "./favorites.service";
import { RecentlyViewedCompanionsController } from "./recently-viewed-companions.controller";

@Module({
  imports: [AuthModule, AuditModule, NotificationsModule],
  controllers: [AvailabilityReminderOperationsController, FavoritesController, RecentlyViewedCompanionsController],
  providers: [
    FavoritesService,
    AvailabilityReminderAttemptConsumptionService,
    AvailabilityReminderAttemptDeliveryService,
    AvailabilityReminderDeliveryRunner,
    AvailabilityReminderAttemptService,
    AvailabilityReminderCandidateService,
    AvailabilityReminderFanoutService,
    AvailabilityReminderHandoffService,
    AvailabilityReminderPreparationService,
    AvailabilityReminderPreparationRunner,
    AvailabilityReminderPreflightService,
    AvailabilityReminderReservationService,
    AvailabilityReminderWorkerRetryService,
    AvailabilityReminderTerminalResolutionService,
    RolesGuard
  ],
  exports: [
    AvailabilityReminderAttemptConsumptionService,
    AvailabilityReminderAttemptDeliveryService,
    AvailabilityReminderAttemptService,
    AvailabilityReminderCandidateService,
    AvailabilityReminderFanoutService,
    AvailabilityReminderHandoffService,
    AvailabilityReminderPreparationService,
    AvailabilityReminderPreflightService,
    AvailabilityReminderReservationService,
    AvailabilityReminderTerminalResolutionService
  ]
})
export class FavoritesModule {}
