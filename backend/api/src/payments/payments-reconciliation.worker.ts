import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { OrdersService } from "../orders/orders.service";
import { PaymentsService } from "./payments.service";

/**
 * A reconciliation loop, rather than an in-memory job list.  Every run reads
 * due database rows, so a restart or a second replica cannot lose financial
 * work; the underlying order/refund updates are already guarded and idempotent.
 */
@Injectable()
export class PaymentsReconciliationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentsReconciliationWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly payments: PaymentsService,
    private readonly orders: OrdersService
  ) {}

  onModuleInit() {
    if (!this.config.get<boolean>("PAYMENT_RECONCILIATION_ENABLED")) return;
    const intervalMs = (this.config.get<number>("PAYMENT_RECONCILIATION_INTERVAL_SECONDS") ?? 60) * 1_000;
    this.timer = setInterval(() => void this.reconcile(), intervalMs);
    this.timer.unref?.();
    void this.reconcile();
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
      const expiredReservations = await this.orders.expireUnpaidReservations(batchSize);
      const settlement = await this.payments.reconcileExpiredServiceWindows(batchSize);
      if (settlement.failures > 0) {
        this.logger.warn(
          `Payment reconciliation completed with ${settlement.failures} failed item(s); ` +
          `${settlement.refundAttempts}/${settlement.scanned} overdue orders were attempted.`
        );
      }
      if (expiredReservations > 0 || settlement.refundAttempts > 0) {
        this.logger.log(
          `Reconciled ${expiredReservations} expired reservation(s) and ${settlement.refundAttempts} overdue service refund(s).`
        );
      }
      return { expiredReservations, ...settlement };
    } finally {
      this.running = false;
    }
  }
}
