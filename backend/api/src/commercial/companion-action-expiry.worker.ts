import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { CompanionLifecycleService } from "./companion-lifecycle.service";

const EXPIRY_CONTINUATION_DELAY_MS = 1_000;

/**
 * Materializes expired temporary suspensions as durable reactivation work.
 * The service uses a row lock and compare-and-set transition, so concurrent
 * replicas may scan the same id but only one writes the state/audit/notification.
 */
@Injectable()
export class CompanionActionExpiryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CompanionActionExpiryWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private continuationTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly lifecycle: CompanionLifecycleService
  ) {}

  onModuleInit() {
    if (!this.config.get<boolean>("COMPANION_ACTION_EXPIRY_ENABLED", true)) return;
    const intervalMs = (
      this.config.get<number>("COMPANION_ACTION_EXPIRY_INTERVAL_SECONDS", 60) ?? 60
    ) * 1_000;
    this.timer = setInterval(() => this.scanSafely(), intervalMs);
    this.timer.unref?.();
    this.scanSafely();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.continuationTimer) clearTimeout(this.continuationTimer);
    this.timer = null;
    this.continuationTimer = null;
  }

  async scan() {
    if (
      this.running
      || !this.config.get<boolean>("COMPANION_ACTION_EXPIRY_ENABLED", true)
    ) {
      return { skipped: true, scanned: 0, materialized: 0 };
    }
    this.running = true;
    try {
      const batchSize = this.config.get<number>("COMPANION_ACTION_EXPIRY_BATCH_SIZE", 50) ?? 50;
      const result = await this.lifecycle.materializeExpiredSuspensionReactivations(batchSize);
      if (result.materialized > 0) {
        this.logger.log(
          `Materialized ${result.materialized} expired companion suspension reactivation(s).`
        );
      }
      if (result.hasMore) this.scheduleContinuation();
      return { skipped: false, ...result };
    } finally {
      this.running = false;
    }
  }

  private scanSafely() {
    void this.scan().catch((error) => {
      this.logger.error(
        `Companion action expiry scan failed (${error instanceof Error ? error.name : "unknown_error"})`
      );
    });
  }

  private scheduleContinuation() {
    if (this.continuationTimer) return;
    this.continuationTimer = setTimeout(() => {
      this.continuationTimer = null;
      this.scanSafely();
    }, EXPIRY_CONTINUATION_DELAY_MS);
    this.continuationTimer.unref?.();
  }
}
