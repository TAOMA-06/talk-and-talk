import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { PaymentDisputesService } from "./payment-disputes.service";

@Injectable()
export class PaymentDisputesWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentDisputesWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private scanCounter = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly disputes: PaymentDisputesService
  ) {}

  onModuleInit() {
    if (!this.config.get<boolean>("WECHAT_PAY_COMPLAINTS_ENABLED")) return;
    const interval = (this.config.get<number>("WECHAT_PAY_COMPLAINT_POLL_INTERVAL_SECONDS") ?? 300) * 1_000;
    this.timer = setInterval(() => this.runSafely(), interval);
    this.timer.unref?.();
    this.runSafely();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async run() {
    if (this.running) return;
    this.running = true;
    try {
      const batchSize = this.config.get<number>("WECHAT_PAY_COMPLAINT_BATCH_SIZE") ?? 50;
      const reconciled = await this.disputes.reconcileDue(batchSize);
      // The callback is primary, while this periodic list query compensates for
      // the missed/delayed notifications explicitly called out by WeChat Pay.
      const polled = this.scanCounter++ % 3 === 0
        ? await this.disputes.pollRecentWechatComplaints()
        : { discovered: 0 };
      if (reconciled.synced || polled.discovered) {
        this.logger.log(`Complaint reconciliation: ${reconciled.synced} synced, ${polled.discovered} discovered.`);
      }
      return { ...reconciled, ...polled };
    } finally {
      this.running = false;
    }
  }

  private runSafely() {
    void this.run().catch((error) => {
      this.logger.error(`Complaint reconciliation failed (${error instanceof Error ? error.name : "unknown_error"})`);
    });
  }
}
