import { Logger } from "@nestjs/common";

import { PaymentsReconciliationWorker } from "./payments-reconciliation.worker";

describe("PaymentsReconciliationWorker", () => {
  const config = {
    get: jest.fn((key: string) => {
      if (key === "PAYMENT_RECONCILIATION_BATCH_SIZE") return 25;
      if (key === "PAYMENT_RECONCILIATION_ENABLED") return true;
      if (key === "PAYMENT_RECONCILIATION_INTERVAL_SECONDS") return 60;
      return undefined;
    })
  } as any;
  const payments = {
    reconcileStaleRefunds: jest.fn().mockResolvedValue({ scanned: 3, submissions: 1, queries: 2, failures: 0 }),
    reconcileExpiredPrepays: jest.fn().mockResolvedValue({ scanned: 2, paidRecovered: 1, closed: 1, failures: 0 }),
    reconcileExpiredServiceWindows: jest.fn().mockResolvedValue({ scanned: 2, refundAttempts: 1, failures: 0 })
  } as any;
const orders = {
  expireUnconfirmedOrders: jest.fn().mockResolvedValue(2),
  expireUnpaidReservations: jest.fn().mockResolvedValue(3)
} as any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it("releases expired reservations and reconciles overdue paid orders in one bounded run", async () => {
    const worker = new PaymentsReconciliationWorker(config, payments, orders);

    await expect(worker.reconcile()).resolves.toEqual({
      expiredRequests: 2,
      expiredReservations: 3,
      refunds: { scanned: 3, submissions: 1, queries: 2, failures: 0 },
      prepays: { scanned: 2, paidRecovered: 1, closed: 1, failures: 0 },
      settlement: { scanned: 2, refundAttempts: 1, failures: 0 }
    });
    expect(orders.expireUnpaidReservations).toHaveBeenCalledWith(25);
    expect(orders.expireUnconfirmedOrders).toHaveBeenCalledWith(25);
    expect(payments.reconcileStaleRefunds).toHaveBeenCalledWith(25);
    expect(payments.reconcileExpiredPrepays).toHaveBeenCalledWith(25);
    expect(payments.reconcileExpiredServiceWindows).toHaveBeenCalledWith(25);
  });
});
