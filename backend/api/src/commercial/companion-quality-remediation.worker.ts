import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { CompanionLifecycleService } from "./companion-lifecycle.service";

@Injectable()
export class CompanionQualityRemediationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CompanionQualityRemediationWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly lifecycle: CompanionLifecycleService
  ) {}

  onModuleInit() {
    if (!this.config.get<boolean>("COMPANION_REMEDIATION_OVERDUE_WORKER_ENABLED")) return;
    const interval =
      (this.config.get<number>("COMPANION_REMEDIATION_OVERDUE_WORKER_INTERVAL_SECONDS") ?? 60)
      * 1_000;
    this.timer = setInterval(() => this.processSafely(), interval);
    this.timer.unref?.();
    this.processSafely();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async process() {
    if (this.running) return;
    this.running = true;
    try {
      const batchSize =
        this.config.get<number>("COMPANION_REMEDIATION_OVERDUE_WORKER_BATCH_SIZE") ?? 50;
      const result = await this.lifecycle.processOverdueRemediationTasks(batchSize);
      if (result.markedOverdue > 0 || result.restrictionsCreated > 0) {
        this.logger.log(
          `Companion remediation overdue scan: ${result.markedOverdue} overdue, ${result.restrictionsCreated} restrictions`
        );
      }
      return result;
    } finally {
      this.running = false;
    }
  }

  private processSafely(): void {
    void this.process().catch((error) => {
      this.logger.error(
        `Companion remediation overdue scan failed (${error instanceof Error ? error.name : "unknown_error"})`
      );
    });
  }
}
