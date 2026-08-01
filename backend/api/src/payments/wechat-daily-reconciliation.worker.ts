import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { WeChatDailyReconciliationService } from "./wechat-daily-reconciliation.service";

@Injectable()
export class WeChatDailyReconciliationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WeChatDailyReconciliationWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly reconciliation: WeChatDailyReconciliationService
  ) {}

  onModuleInit() {
    if (!this.config.get<boolean>("WECHAT_DAILY_BILL_RECONCILIATION_ENABLED", false)) return;
    const intervalSeconds = this.config.get<number>("PAYMENT_RECONCILIATION_INTERVAL_SECONDS", 60);
    this.timer = setInterval(() => this.reconcileSafely(), intervalSeconds * 1_000);
    this.timer.unref?.();
    this.reconcileSafely();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async reconcile(now = new Date()) {
    if (this.running) return { skipped: true as const };
    this.running = true;
    try {
      const scheduled = await this.reconciliation.ensureExpectedRuns(now);
      const batchSize = this.config.get<number>("WECHAT_DAILY_BILL_RECONCILIATION_BATCH_SIZE", 4);
      const processed = await this.reconciliation.processDue(batchSize, now);
      if (processed.failed > 0) {
        this.logger.warn(`WeChat daily bill reconciliation recorded ${processed.failed} failed run(s).`);
      }
      if (scheduled.created > 0 || processed.processed > 0) {
        this.logger.log(
          `WeChat daily bill reconciliation scheduled ${scheduled.created} and processed ${processed.processed} run(s).`
        );
      }
      return { skipped: false as const, scheduled, processed };
    } finally {
      this.running = false;
    }
  }

  private reconcileSafely() {
    void this.reconcile().catch((error) => {
      this.logger.error(
        `WeChat daily bill reconciliation failed (${error instanceof Error ? error.name : "unknown_error"}).`
      );
    });
  }
}
