import { Logger } from "@nestjs/common";

import { OrderRescheduleExpiryWorker } from "./order-reschedule-expiry.worker";

describe("OrderRescheduleExpiryWorker", () => {
  const config = {
    get: jest.fn((key: string) => {
      if (key === "ORDER_RESCHEDULE_EXPIRY_ENABLED") return true;
      if (key === "ORDER_RESCHEDULE_EXPIRY_INTERVAL_SECONDS") return 60;
      if (key === "ORDER_RESCHEDULE_EXPIRY_BATCH_SIZE") return 25;
      return undefined;
    })
  } as any;
  const orders = {
    expirePendingRescheduleRequests: jest.fn().mockResolvedValue(2)
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it("runs a bounded expiry batch when the worker is enabled", async () => {
    const worker = new OrderRescheduleExpiryWorker(config, orders);

    await expect(worker.expireDue()).resolves.toEqual({ skipped: false, expired: 2 });
    expect(orders.expirePendingRescheduleRequests).toHaveBeenCalledWith(25);
  });

  it("does not scan while the explicit expiry switch is off", async () => {
    config.get.mockImplementation((key: string) => key === "ORDER_RESCHEDULE_EXPIRY_ENABLED" ? false : 25);
    const worker = new OrderRescheduleExpiryWorker(config, orders);

    await expect(worker.expireDue()).resolves.toEqual({ skipped: true, expired: 0 });
    expect(orders.expirePendingRescheduleRequests).not.toHaveBeenCalled();
  });
});
