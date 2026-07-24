import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import {
  AvailabilityReminderPreparationResult,
  AvailabilityReminderPreparationService
} from "./availability-reminder-preparation.service";

const DEFAULT_INTERVAL_SECONDS = 60;
const DEFAULT_BATCH_SIZE = 20;

/**
 * Explicitly opt-in executor for the internal reminder-preparation pass. It is
 * intentionally isolated from Notification, NotificationDelivery, WeChat, and
 * all provider code: enabling it can only produce private preflight and
 * handoff state, never an external send or a user-visible notification.
 */
@Injectable()
export class AvailabilityReminderPreparationRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AvailabilityReminderPreparationRunner.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly preparation: AvailabilityReminderPreparationService
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
      const batchSize = this.config.get<number>("AVAILABILITY_REMINDER_PREPARATION_BATCH_SIZE")
        ?? DEFAULT_BATCH_SIZE;
      const result = await this.preparation.preparePending(batchSize);
      if (result.scanned > 0) this.logAggregate(result);
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
      + `alreadyHandedOff=${result.alreadyHandedOff} disappeared=${result.disappeared}`
    );
  }
}
