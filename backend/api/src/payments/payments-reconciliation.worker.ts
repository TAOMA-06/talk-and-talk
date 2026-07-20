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
    this.timer = setInterval(() => this.reconcileSafely(), intervalMs);
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
      const expiredRequests = await this.orders.expireUnconfirmedOrders(batchSize);
      const expiredReservations = await this.orders.expireUnpaidReservations(batchSize);
      const refunds = await this.payments.reconcileStaleRefunds(batchSize);
      const prepays = await this.payments.reconcileExpiredPrepays(batchSize);
      const settlement = await this.payments.reconcileExpiredServiceWindows(batchSize);
      if (refunds.failures > 0 || prepays.failures > 0 || settlement.failures > 0) {
        this.logger.warn(
          `Payment reconciliation completed with ${refunds.failures} refund, ${prepays.failures} prepay and ` +
          `${settlement.failures} service-window failure(s).`
        );
      }
      if (
        expiredRequests > 0 || expiredReservations > 0 || refunds.submissions > 0 ||
        refunds.queries > 0 || prepays.paidRecovered > 0 ||
        prepays.closed > 0 || settlement.refundAttempts > 0
      ) {
        this.logger.log(
          `Reconciled ${expiredRequests} expired request(s), ${expiredReservations} expired reservation(s), ` +
          `${refunds.submissions} refund submission(s), ${refunds.queries} refund query(s), ` +
          `${prepays.paidRecovered} recovered payment(s), ${prepays.closed} closed prepay(s), and ` +
          `${settlement.refundAttempts} overdue service refund(s).`
        );
      }
      return { expiredRequests, expiredReservations, refunds, prepays, settlement };
    } finally {
      this.running = false;
    }
  }

  private reconcileSafely(): void {
    void this.reconcile().catch((error) => {
      this.logger.error(`Payment reconciliation scan failed (${error instanceof Error ? error.name : "unknown_error"})`);
    });
  }
}
