import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AvailabilityReminderFanoutService } from "./availability-reminder-fanout.service";
import { AvailabilityReminderReservationService } from "./availability-reminder-reservation.service";
import { AvailabilityReminderWorkerRetryService } from "./availability-reminder-worker-retry.service";
import { AvailabilityReminderTerminalResolutionService } from "./availability-reminder-terminal-resolution.service";
import { ResolveAvailabilityReminderTerminalDto } from "./dto/resolve-availability-reminder-terminal.dto";

@Controller("admin/commercial/availability-reminders")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("operations", "admin")
export class AvailabilityReminderOperationsController {
  constructor(
    private readonly fanout: AvailabilityReminderFanoutService,
    private readonly reservations: AvailabilityReminderReservationService,
    private readonly workerRetries: AvailabilityReminderWorkerRetryService,
    private readonly terminalResolutions: AvailabilityReminderTerminalResolutionService
  ) {}

  @Get("readiness")
  async readiness() {
    const [fanout, pipeline] = await Promise.all([
      this.fanout.operationalReadiness(),
      this.reservations.operationalReadiness()
    ]);
    const status = [fanout.status, pipeline.status].includes("attentionRequired")
      ? "attentionRequired"
      : [fanout.status, pipeline.status].includes("processing") ? "processing" : "clear";
    return { ...fanout, status, pipeline };
  }

  @Post("fanout-jobs/:id/retry")
  @HttpCode(200)
  retryFailedJob(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") jobId: string
  ) {
    return this.fanout.retryFailedJob(actor.id, jobId);
  }

  @Post("preparation-candidates/:id/retry")
  @HttpCode(200)
  retryFailedPreparation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") candidateId: string
  ) {
    return this.workerRetries.retryPreparation(actor.id, candidateId);
  }

  @Post("reservation-handoffs/:id/retry")
  @HttpCode(200)
  retryFailedReservation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") handoffId: string
  ) {
    return this.workerRetries.retryReservation(actor.id, handoffId);
  }

  @Post("delivery-attempts/:id/retry")
  @HttpCode(200)
  retryFailedDelivery(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") attemptId: string
  ) {
    return this.workerRetries.retryDelivery(actor.id, attemptId);
  }

  @Post("terminal-attempts/:id/resolve")
  @HttpCode(200)
  resolveTerminalAttempt(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") attemptId: string,
    @Body() dto: ResolveAvailabilityReminderTerminalDto
  ) {
    return this.terminalResolutions.resolve(actor.id, attemptId, dto);
  }
}
