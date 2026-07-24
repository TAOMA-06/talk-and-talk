import { AvailabilityReminderDeliveryRunner } from "./availability-reminder-delivery.runner";

const EMPTY_RESULT = {
  scanned: 0,
  recovered: 0,
  authorized: 0,
  sent: 0,
  skipped: 0,
  failedBeforeSend: 0,
  rejected: 0,
  uncertain: 0,
  inFlight: 0,
  notReady: 0,
  errors: 0
};

function createRunner(values: Record<string, unknown> = {}) {
  const config = {
    get: jest.fn((key: string) => values[key])
  } as any;
  const prisma = {
    availabilityReminderAttempt: { findMany: jest.fn().mockResolvedValue([]) }
  } as any;
  const consumption = {
    acquireFinalSendAuthorization: jest.fn(),
    recoverExpiredSendLease: jest.fn()
  } as any;
  const delivery = { deliver: jest.fn() } as any;
  const metrics = {
    recordAvailabilityReminderDeliveryFailure: jest.fn(),
    recordAvailabilityReminderDeliverySuccess: jest.fn(),
    recordAvailabilityReminderDeliverySkipped: jest.fn()
  } as any;
  const runner = new AvailabilityReminderDeliveryRunner(config, prisma, consumption, delivery, metrics);
  return { config, prisma, consumption, delivery, metrics, runner };
}

describe("AvailabilityReminderDeliveryRunner", () => {
  afterEach(() => jest.restoreAllMocks());

  it("does nothing by default, including when only the delivery switch is set", async () => {
    const { prisma, runner } = createRunner({ AVAILABILITY_REMINDER_DELIVERY_ENABLED: true });
    const interval = jest.spyOn(global, "setInterval");

    runner.onModuleInit();

    expect(interval).not.toHaveBeenCalled();
    await expect(runner.deliverDue()).resolves.toBeUndefined();
    expect(prisma.availabilityReminderAttempt.findMany).not.toHaveBeenCalled();
    runner.onModuleDestroy();
  });

  it("quarantines only expired active leases, then sends only through fresh reserved leases", async () => {
    const { prisma, consumption, delivery, metrics, runner } = createRunner({
      AVAILABILITY_REMINDER_DELIVERY_ENABLED: true,
      WECHAT_SUBSCRIBE_MESSAGES_ENABLED: true,
      AVAILABILITY_REMINDER_DELIVERY_BATCH_SIZE: 4
    });
    prisma.availabilityReminderAttempt.findMany
      .mockResolvedValueOnce([{ id: "expired-attempt" }])
      .mockResolvedValueOnce([{ id: "fresh-attempt" }, { id: "skipped-attempt" }]);
    consumption.recoverExpiredSendLease.mockResolvedValue({ decision: "recoveryRequired" });
    consumption.acquireFinalSendAuthorization
      .mockResolvedValueOnce({ decision: "authorized", sendLeaseToken: "fresh-lease" })
      .mockResolvedValueOnce({ decision: "skipped", sendLeaseToken: null });
    delivery.deliver.mockResolvedValue({ decision: "sent" });
    const log = jest.spyOn((runner as any).logger, "log").mockImplementation(() => undefined);

    await expect(runner.deliverDue()).resolves.toEqual({
      scanned: 3,
      recovered: 1,
      authorized: 1,
      sent: 1,
      skipped: 1,
      failedBeforeSend: 0,
      rejected: 0,
      uncertain: 1,
      inFlight: 0,
      notReady: 0,
      errors: 0
    });

    expect(prisma.availabilityReminderAttempt.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ status: { in: ["readyToSend", "sending"] } }),
      select: { id: true },
      take: 4
    }));
    expect(prisma.availabilityReminderAttempt.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { status: "reserved" },
      select: { id: true },
      take: 3
    }));
    expect(consumption.recoverExpiredSendLease).toHaveBeenCalledWith("expired-attempt", expect.any(Date));
    expect(consumption.acquireFinalSendAuthorization).toHaveBeenNthCalledWith(
      1, "fresh-attempt", expect.any(Date)
    );
    expect(delivery.deliver).toHaveBeenCalledWith("fresh-attempt", "fresh-lease", expect.any(Date));
    expect(delivery.deliver).toHaveBeenCalledTimes(1);
    expect(metrics.recordAvailabilityReminderDeliveryFailure).toHaveBeenCalledTimes(1);
    expect(metrics.recordAvailabilityReminderDeliverySuccess).toHaveBeenCalledTimes(1);
    expect(metrics.recordAvailabilityReminderDeliverySkipped).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("scanned=3 recovered=1 authorized=1 sent=1"));
    expect(log.mock.calls.flat().join(" ")).not.toContain("fresh-attempt");
  });

  it("uses the entire bounded pass to quarantine expired leases without sending or scanning old live leases", async () => {
    const { prisma, consumption, delivery, runner } = createRunner({
      AVAILABILITY_REMINDER_DELIVERY_ENABLED: true,
      WECHAT_SUBSCRIBE_MESSAGES_ENABLED: true,
      AVAILABILITY_REMINDER_DELIVERY_BATCH_SIZE: 2
    });
    prisma.availabilityReminderAttempt.findMany.mockResolvedValueOnce([
      { id: "expired-ready" },
      { id: "expired-sending" }
    ]);
    consumption.recoverExpiredSendLease.mockResolvedValue({ decision: "recoveryRequired" });

    await expect(runner.deliverDue()).resolves.toEqual({
      ...EMPTY_RESULT,
      scanned: 2,
      recovered: 2,
      uncertain: 2
    });

    expect(prisma.availabilityReminderAttempt.findMany).toHaveBeenCalledTimes(1);
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it("contains per-attempt failures, retains aggregate-only output, and continues the bounded pass", async () => {
    const { prisma, consumption, delivery, metrics, runner } = createRunner({
      AVAILABILITY_REMINDER_DELIVERY_ENABLED: true,
      WECHAT_SUBSCRIBE_MESSAGES_ENABLED: true
    });
    prisma.availabilityReminderAttempt.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "bad-attempt" }, { id: "good-attempt" }]);
    consumption.acquireFinalSendAuthorization
      .mockRejectedValueOnce(new Error("private identifier must not be logged"))
      .mockResolvedValueOnce({ decision: "authorized", sendLeaseToken: "new-lease" });
    delivery.deliver.mockResolvedValue({ decision: "rejected" });
    const log = jest.spyOn((runner as any).logger, "log").mockImplementation(() => undefined);

    await expect(runner.deliverDue()).resolves.toEqual({
      ...EMPTY_RESULT,
      scanned: 2,
      authorized: 1,
      rejected: 1,
      errors: 1
    });

    expect(delivery.deliver).toHaveBeenCalledWith("good-attempt", "new-lease", expect.any(Date));
    expect(metrics.recordAvailabilityReminderDeliveryFailure).toHaveBeenCalledTimes(2);
    expect(log.mock.calls.flat().join(" ")).not.toContain("bad-attempt");
  });

  it("prevents overlapping passes and starts an unref'd immediate pass only after both switches are enabled", async () => {
    const { prisma, runner } = createRunner({
      AVAILABILITY_REMINDER_DELIVERY_ENABLED: true,
      WECHAT_SUBSCRIBE_MESSAGES_ENABLED: true,
      AVAILABILITY_REMINDER_DELIVERY_INTERVAL_SECONDS: 45
    });
    let resolveScan: ((value: Array<{ id: string }>) => void) | undefined;
    prisma.availabilityReminderAttempt.findMany.mockImplementationOnce(() => new Promise((resolve) => {
      resolveScan = resolve;
    }));
    const interval = jest.spyOn(global, "setInterval");
    const clear = jest.spyOn(global, "clearInterval");

    runner.onModuleInit();
    await Promise.resolve();
    await expect(runner.deliverDue()).resolves.toBeUndefined();
    expect(interval).toHaveBeenCalledWith(expect.any(Function), 45_000);
    expect(prisma.availabilityReminderAttempt.findMany).toHaveBeenCalledTimes(1);

    resolveScan!([]);
    await Promise.resolve();
    await Promise.resolve();
    runner.onModuleDestroy();
    expect(clear).toHaveBeenCalled();
  });

  it("contains lifecycle-level failures without logging attempt details", async () => {
    const { prisma, metrics, runner } = createRunner({
      AVAILABILITY_REMINDER_DELIVERY_ENABLED: true,
      WECHAT_SUBSCRIBE_MESSAGES_ENABLED: true
    });
    prisma.availabilityReminderAttempt.findMany.mockRejectedValue(new Error("database unavailable"));
    const error = jest.spyOn((runner as any).logger, "error").mockImplementation(() => undefined);

    (runner as any).deliverDueSafely();
    await Promise.resolve();
    await Promise.resolve();

    expect(metrics.recordAvailabilityReminderDeliveryFailure).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("Error"));
    expect(error.mock.calls.flat().join(" ")).not.toContain("database unavailable");
    runner.onModuleDestroy();
  });
});
