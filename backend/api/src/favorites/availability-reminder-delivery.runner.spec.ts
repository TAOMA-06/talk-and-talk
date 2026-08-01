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
  errors: 0,
  retryScheduled: 0,
  failed: 0,
  leaseLost: 0
};

function createRunner(values: Record<string, unknown> = {}) {
  const config = {
    get: jest.fn((key: string) => values[key])
  } as any;
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    availabilityReminderAttempt: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) }
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
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("does nothing by default, including when only the delivery switch is set", async () => {
    const { prisma, runner } = createRunner({ AVAILABILITY_REMINDER_DELIVERY_ENABLED: true });
    const interval = jest.spyOn(global, "setInterval");

    runner.onModuleInit();

    expect(interval).not.toHaveBeenCalled();
    await expect(runner.deliverDue()).resolves.toBeUndefined();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    runner.onModuleDestroy();
  });

  it("quarantines only expired active leases, then sends only through fresh reserved leases", async () => {
    const { prisma, consumption, delivery, metrics, runner } = createRunner({
      AVAILABILITY_REMINDER_DELIVERY_ENABLED: true,
      WECHAT_SUBSCRIBE_MESSAGES_ENABLED: true,
      AVAILABILITY_REMINDER_DELIVERY_BATCH_SIZE: 4
    });
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: "expired-attempt", status: "readyToSend", deliveryFailureCount: 0 }])
      .mockResolvedValueOnce([{ id: "fresh-attempt", status: "reserved", deliveryFailureCount: 0 }])
      .mockResolvedValueOnce([{ id: "skipped-attempt", status: "reserved", deliveryFailureCount: 0 }])
      .mockResolvedValueOnce([]);
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
      errors: 0,
      retryScheduled: 0,
      failed: 0,
      leaseLost: 0
    });

    const claimSql = Array.from(prisma.$queryRaw.mock.calls[0][0] as string[]).join("");
    expect(claimSql).toContain("FOR UPDATE SKIP LOCKED");
    expect(claimSql).toContain("deliveryNextAttemptAt");
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
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: "expired-ready", status: "readyToSend", deliveryFailureCount: 0 }])
      .mockResolvedValueOnce([{ id: "expired-sending", status: "sending", deliveryFailureCount: 0 }])
      .mockResolvedValueOnce([]);
    consumption.recoverExpiredSendLease.mockResolvedValue({ decision: "recoveryRequired" });

    await expect(runner.deliverDue()).resolves.toEqual({
      ...EMPTY_RESULT,
      scanned: 2,
      recovered: 2,
      uncertain: 2
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it("contains per-attempt failures, retains aggregate-only output, and continues the bounded pass", async () => {
    const { prisma, consumption, delivery, metrics, runner } = createRunner({
      AVAILABILITY_REMINDER_DELIVERY_ENABLED: true,
      WECHAT_SUBSCRIBE_MESSAGES_ENABLED: true
    });
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: "bad-attempt", status: "reserved", deliveryFailureCount: 0 }])
      .mockResolvedValueOnce([{ id: "good-attempt", status: "reserved", deliveryFailureCount: 0 }])
      .mockResolvedValueOnce([]);
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
      errors: 1,
      retryScheduled: 1
    });

    expect(delivery.deliver).toHaveBeenCalledWith("good-attempt", "new-lease", expect.any(Date));
    expect(metrics.recordAvailabilityReminderDeliveryFailure).toHaveBeenCalledTimes(2);
    expect(log.mock.calls.flat().join(" ")).not.toContain("bad-attempt");
  });

  it("uses fresh wall time for each claim, authorization, and provider handoff", async () => {
    const now = new Date("2026-08-01T08:00:00.000Z");
    jest.useFakeTimers().setSystemTime(now);
    const { prisma, consumption, delivery, runner } = createRunner({
      AVAILABILITY_REMINDER_DELIVERY_ENABLED: true,
      WECHAT_SUBSCRIBE_MESSAGES_ENABLED: true,
      AVAILABILITY_REMINDER_DELIVERY_BATCH_SIZE: 3
    });
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: "attempt-1", status: "reserved", deliveryFailureCount: 0 }])
      .mockResolvedValueOnce([{ id: "attempt-2", status: "reserved", deliveryFailureCount: 0 }])
      .mockResolvedValueOnce([]);
    consumption.acquireFinalSendAuthorization.mockResolvedValue({
      decision: "authorized",
      sendLeaseToken: "send-lease"
    });
    delivery.deliver
      .mockImplementationOnce(async () => {
        jest.setSystemTime(new Date(now.getTime() + 30_000));
        return { decision: "sent" };
      })
      .mockResolvedValueOnce({ decision: "sent" });

    await expect(runner.deliverDue()).resolves.toMatchObject({ scanned: 2, authorized: 2, sent: 2 });
    const firstAuthorizationAt = consumption.acquireFinalSendAuthorization.mock.calls[0][1] as Date;
    const secondAuthorizationAt = consumption.acquireFinalSendAuthorization.mock.calls[1][1] as Date;
    expect(firstAuthorizationAt.toISOString()).toBe(now.toISOString());
    expect(secondAuthorizationAt.toISOString()).toBe(new Date(now.getTime() + 30_000).toISOString());
    expect((delivery.deliver.mock.calls[1][2] as Date).toISOString()).toBe(secondAuthorizationAt.toISOString());
  });

  it("stops refilling after the wall budget and schedules failures from current time", async () => {
    const now = new Date("2026-08-01T08:00:00.000Z");
    jest.useFakeTimers().setSystemTime(now);
    const { prisma, consumption, runner } = createRunner({
      AVAILABILITY_REMINDER_DELIVERY_ENABLED: true,
      WECHAT_SUBSCRIBE_MESSAGES_ENABLED: true,
      AVAILABILITY_REMINDER_DELIVERY_BATCH_SIZE: 3
    });
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: "slow-attempt", status: "reserved", deliveryFailureCount: 0 }])
      .mockResolvedValueOnce([{ id: "must-wait-next-tick", status: "reserved", deliveryFailureCount: 0 }]);
    consumption.acquireFinalSendAuthorization.mockImplementation(async () => {
      jest.setSystemTime(new Date(now.getTime() + 121_000));
      throw new Error("provider boundary stalled");
    });

    await expect(runner.deliverDue()).resolves.toMatchObject({
      scanned: 1,
      errors: 1,
      retryScheduled: 1
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.availabilityReminderAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        deliveryNextAttemptAt: new Date(now.getTime() + 126_000)
      })
    }));
  });

  it("prevents overlapping passes and starts an unref'd immediate pass only after both switches are enabled", async () => {
    const { prisma, runner } = createRunner({
      AVAILABILITY_REMINDER_DELIVERY_ENABLED: true,
      WECHAT_SUBSCRIBE_MESSAGES_ENABLED: true,
      AVAILABILITY_REMINDER_DELIVERY_INTERVAL_SECONDS: 45
    });
    let resolveScan: ((value: Array<{ id: string }>) => void) | undefined;
    prisma.$queryRaw.mockImplementationOnce(() => new Promise((resolve) => {
      resolveScan = resolve;
    }));
    const interval = jest.spyOn(global, "setInterval");
    const clear = jest.spyOn(global, "clearInterval");

    runner.onModuleInit();
    await Promise.resolve();
    await expect(runner.deliverDue()).resolves.toBeUndefined();
    expect(interval).toHaveBeenCalledWith(expect.any(Function), 45_000);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);

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
    prisma.$queryRaw.mockRejectedValue(new Error("database unavailable"));
    const error = jest.spyOn((runner as any).logger, "error").mockImplementation(() => undefined);

    (runner as any).deliverDueSafely();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(metrics.recordAvailabilityReminderDeliveryFailure).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("Error"));
    expect(error.mock.calls.flat().join(" ")).not.toContain("database unavailable");
    runner.onModuleDestroy();
  });
});
