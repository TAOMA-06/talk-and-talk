import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import {
  AvailabilityReminderPreparationResult,
  AvailabilityReminderPreparationService
} from "./availability-reminder-preparation.service";
import {
  AvailabilityReminderFanoutRunResult,
  AvailabilityReminderFanoutService
} from "./availability-reminder-fanout.service";
import {
  AvailabilityReminderReservationRunResult,
  AvailabilityReminderReservationService
} from "./availability-reminder-reservation.service";

const DEFAULT_INTERVAL_SECONDS = 60;
const DEFAULT_BATCH_SIZE = 100;
const BATCHES_PER_TICK = 5;

/**
 * Explicitly opt-in executor for the internal reminder-preparation pass. It is
 * intentionally isolated from Notification, NotificationDelivery, WeChat, and
 * all provider code: enabling it can only produce private preflight, handoff,
 * and unconsumed attempt-reservation state, never an external send or a
 * user-visible notification.
 */
@Injectable()
export class AvailabilityReminderPreparationRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AvailabilityReminderPreparationRunner.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly preparation: AvailabilityReminderPreparationService,
    @Optional() private readonly fanout: AvailabilityReminderFanoutService | undefined,
    private readonly reservations: AvailabilityReminderReservationService
  ) {}

  onModuleInit() {
    if (!this.isEnabled()) return;

    const intervalMs = (this.config.get<number>("AVAILABILITY_REMINDER_PREPARATION_INTERVAL_SECONDS")
      ?? DEFAULT_INTERVAL_SECONDS) * 1_000;
    this.timer = setInterval(() => this.prepareDueSafely(), intervalMs);
    this.timer.unref?.();
    this.prepareDueSafely();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async prepareDue(): Promise<AvailabilityReminderPreparationResult | undefined> {
    if (this.running || !this.isEnabled()) return;

    this.running = true;
    try {
      // Fanout commits bounded candidate pages before preflight; the final
      // reservation pass may bind, but never consume, the one-time grant. None
      // of these stages crosses the provider boundary.
      const fanout = await this.fanout?.fanOutDue();
      if (fanout && this.hasFanoutActivity(fanout)) this.logFanoutAggregate(fanout);
      const batchSize = this.config.get<number>("AVAILABILITY_REMINDER_PREPARATION_BATCH_SIZE")
        ?? DEFAULT_BATCH_SIZE;
      const result = this.emptyPreparationResult();
      const reservationAggregate = this.emptyReservationResult();
      for (let batch = 0; batch < BATCHES_PER_TICK; batch += 1) {
        const prepared = await this.preparation.preparePending(batchSize);
        this.addCounts(result, prepared);
        const reservations = await this.reservations.reservePending(batchSize);
        this.addCounts(reservationAggregate, reservations);
        if (prepared.scanned < batchSize && reservations.scanned < batchSize) break;
      }
      if (result.scanned > 0) this.logAggregate(result);
      if (reservationAggregate.scanned > 0) this.logReservationAggregate(reservationAggregate);
      return result;
    } finally {
      this.running = false;
    }
  }

  private isEnabled() {
    return this.config.get<boolean>("AVAILABILITY_REMINDER_PREPARATION_ENABLED") === true;
  }

  private prepareDueSafely(): void {
    void this.prepareDue().catch((error) => {
      this.logger.error(
        `Availability reminder preparation failed (${error instanceof Error ? error.name : "unknown_error"})`
      );
    });
  }

  private logAggregate(result: AvailabilityReminderPreparationResult) {
    this.logger.log(
      `Availability reminder preparation scanned=${result.scanned} eligible=${result.eligible} `
      + `skipped=${result.skipped} handedOff=${result.handedOff} `
      + `alreadyHandedOff=${result.alreadyHandedOff} disappeared=${result.disappeared} `
      + `retryScheduled=${result.retryScheduled} failed=${result.failed} leaseLost=${result.leaseLost}`
    );
  }

  private hasFanoutActivity(result: AvailabilityReminderFanoutRunResult) {
    return result.claimed > 0 || result.recoveredExpiredLeases > 0 || result.failed > 0;
  }

  private logFanoutAggregate(result: AvailabilityReminderFanoutRunResult) {
    this.logger.log(
      `Availability reminder fanout claimed=${result.claimed} batches=${result.batches} `
      + `favoritesScanned=${result.favoritesScanned} candidatesCreated=${result.candidatesCreated} `
      + `completed=${result.completed} recoveredExpiredLeases=${result.recoveredExpiredLeases} `
      + `retryScheduled=${result.retryScheduled} failed=${result.failed} leaseLost=${result.leaseLost}`
    );
  }

  private logReservationAggregate(result: AvailabilityReminderReservationRunResult) {
    this.logger.log(
      `Availability reminder reservation scanned=${result.scanned} reserved=${result.reserved} `
      + `alreadyProcessed=${result.alreadyProcessed} skipped=${result.skipped} `
      + `disappeared=${result.disappeared} retryScheduled=${result.retryScheduled} `
      + `failed=${result.failed} leaseLost=${result.leaseLost}`
    );
  }

  private emptyPreparationResult(): AvailabilityReminderPreparationResult {
    return {
      scanned: 0,
      eligible: 0,
      skipped: 0,
      handedOff: 0,
      alreadyHandedOff: 0,
      disappeared: 0,
      retryScheduled: 0,
      failed: 0,
      leaseLost: 0
    };
  }

  private emptyReservationResult(): AvailabilityReminderReservationRunResult {
    return {
      scanned: 0,
      reserved: 0,
      alreadyProcessed: 0,
      skipped: 0,
      disappeared: 0,
      retryScheduled: 0,
      failed: 0,
      leaseLost: 0
    };
  }

  private addCounts<T extends Record<string, number>>(aggregate: T, partial: T) {
    for (const key of Object.keys(aggregate) as Array<keyof T>) {
      aggregate[key] = (aggregate[key] + partial[key]) as T[keyof T];
    }
  }
}
