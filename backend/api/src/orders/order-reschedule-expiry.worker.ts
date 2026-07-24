import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { OrdersService } from "./orders.service";

/**
 * Resolves expiring reschedule negotiations without relying on either
 * participant revisiting the order. Row-level rechecks in OrdersService make
 * concurrent runs across replicas safe; this in-process flag only avoids
 * overlapping scans within one Nest instance.
 */
@Injectable()
export class OrderRescheduleExpiryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderRescheduleExpiryWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly orders: OrdersService
  ) {}

  onModuleInit() {
    if (!this.config.get<boolean>("ORDER_RESCHEDULE_EXPIRY_ENABLED")) return;
    const intervalMs = (this.config.get<number>("ORDER_RESCHEDULE_EXPIRY_INTERVAL_SECONDS") ?? 60) * 1_000;
    this.timer = setInterval(() => this.expireDueSafely(), intervalMs);
    this.timer.unref?.();
    this.expireDueSafely();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async expireDue() {
    if (this.running || !this.config.get<boolean>("ORDER_RESCHEDULE_EXPIRY_ENABLED")) {
      return { skipped: true, expired: 0 };
    }
    this.running = true;
    try {
      const batchSize = this.config.get<number>("ORDER_RESCHEDULE_EXPIRY_BATCH_SIZE") ?? 50;
      const expired = await this.orders.expirePendingRescheduleRequests(batchSize);
      if (expired > 0) {
        this.logger.log(`Expired ${expired} reschedule request(s).`);
      }
      return { skipped: false, expired };
    } finally {
      this.running = false;
    }
  }

  private expireDueSafely(): void {
    void this.expireDue().catch((error) => {
      this.logger.error(`Reschedule expiry scan failed (${error instanceof Error ? error.name : "unknown_error"})`);
    });
  }
}
