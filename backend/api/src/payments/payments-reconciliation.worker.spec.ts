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
    reconcileExpiredServiceWindows: jest.fn().mockResolvedValue({ scanned: 2, refundAttempts: 1, failures: 0 })
  } as any;
  const orders = {
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
      expiredReservations: 3,
      scanned: 2,
      refundAttempts: 1,
      failures: 0
    });
    expect(orders.expireUnpaidReservations).toHaveBeenCalledWith(25);
    expect(payments.reconcileExpiredServiceWindows).toHaveBeenCalledWith(25);
  });
});
