import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { CommercialService } from "./commercial.service";

@Injectable()
export class CommercialSettlementWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CommercialSettlementWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly commercial: CommercialService
  ) {}

  onModuleInit() {
    if (!this.config.get<boolean>("PAYMENT_RECONCILIATION_ENABLED")) return;
    const interval = (this.config.get<number>("PAYMENT_RECONCILIATION_INTERVAL_SECONDS") ?? 60) * 1_000;
    this.timer = setInterval(() => this.reconcileSafely(), interval);
    this.timer.unref?.();
    this.reconcileSafely();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async reconcile() {
    if (this.running) return;
    this.running = true;
    try {
      const batchSize = this.config.get<number>("PAYMENT_RECONCILIATION_BATCH_SIZE") ?? 50;
      const result = await this.commercial.reconcileEarnings(batchSize);
      if (result.available > 0 || result.held > 0) {
        this.logger.log(`Settlement ledger updated: ${result.available} available, ${result.held} held.`);
      }
      return result;
    } finally {
      this.running = false;
    }
  }

  private reconcileSafely(): void {
    void this.reconcile().catch((error) => {
      this.logger.error(`Settlement reconciliation scan failed (${error instanceof Error ? error.name : "unknown_error"})`);
    });
  }
}
