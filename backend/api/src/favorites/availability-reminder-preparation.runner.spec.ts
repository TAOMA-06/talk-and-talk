import { AvailabilityReminderPreparationRunner } from "./availability-reminder-preparation.runner";

const EMPTY_RESULT = {
  scanned: 0,
  eligible: 0,
  skipped: 0,
  handedOff: 0,
  alreadyHandedOff: 0,
  disappeared: 0,
  retryScheduled: 0,
  failed: 0,
  leaseLost: 0
};

function createRunner(values: Record<string, unknown> = {}) {
  const config = {
    get: jest.fn((key: string) => values[key])
  } as any;
  const preparation = { preparePending: jest.fn() } as any;
  const fanout = {
    fanOutDue: jest.fn().mockResolvedValue({
      claimed: 0, batches: 0, favoritesScanned: 0, candidatesCreated: 0,
      completed: 0, recoveredExpiredLeases: 0, retryScheduled: 0,
      failed: 0, leaseLost: 0
    })
  } as any;
  const reservations = {
    reservePending: jest.fn().mockResolvedValue({
      scanned: 0, reserved: 0, alreadyProcessed: 0, skipped: 0, disappeared: 0,
      retryScheduled: 0, failed: 0, leaseLost: 0
    })
  } as any;
  const runner = new AvailabilityReminderPreparationRunner(config, preparation, fanout, reservations);
  return { config, preparation, fanout, reservations, runner };
}

describe("AvailabilityReminderPreparationRunner", () => {
  afterEach(() => jest.restoreAllMocks());

  it("does nothing by default: no timer and no internal preparation call", async () => {
    const { preparation, fanout, reservations, runner } = createRunner({
      AVAILABILITY_REMINDER_PREPARATION_ENABLED: false
    });
    const interval = jest.spyOn(global, "setInterval");

    runner.onModuleInit();

    expect(interval).not.toHaveBeenCalled();
    await expect(runner.prepareDue()).resolves.toBeUndefined();
    expect(preparation.preparePending).not.toHaveBeenCalled();
    expect(fanout.fanOutDue).not.toHaveBeenCalled();
    expect(reservations.reservePending).not.toHaveBeenCalled();
    runner.onModuleDestroy();
  });

  it("runs bounded fanout before preparation and emits aggregate-only operational facts", async () => {
    const { preparation, fanout, reservations, runner } = createRunner({
      AVAILABILITY_REMINDER_PREPARATION_ENABLED: true,
      AVAILABILITY_REMINDER_PREPARATION_BATCH_SIZE: 7
    });
    preparation.preparePending.mockResolvedValue({
      scanned: 3,
      eligible: 2,
      skipped: 1,
      handedOff: 1,
      alreadyHandedOff: 1,
      disappeared: 0,
      retryScheduled: 0,
      failed: 0,
      leaseLost: 0
    });
    fanout.fanOutDue.mockResolvedValue({
      claimed: 1, batches: 1, favoritesScanned: 2, candidatesCreated: 2,
      completed: 1, recoveredExpiredLeases: 0, retryScheduled: 0,
      failed: 0, leaseLost: 0
    });
    reservations.reservePending.mockResolvedValue({
      scanned: 2, reserved: 1, alreadyProcessed: 0, skipped: 1, disappeared: 0,
      retryScheduled: 0, failed: 0, leaseLost: 0
    });
    const log = jest.spyOn((runner as any).logger, "log").mockImplementation(() => undefined);

    await expect(runner.prepareDue()).resolves.toEqual(expect.objectContaining({ scanned: 3, handedOff: 1 }));

    expect(preparation.preparePending).toHaveBeenCalledWith(7);
    expect(fanout.fanOutDue).toHaveBeenCalledTimes(1);
    expect(fanout.fanOutDue.mock.invocationCallOrder[0])
      .toBeLessThan(preparation.preparePending.mock.invocationCallOrder[0]);
    expect(preparation.preparePending.mock.invocationCallOrder[0])
      .toBeLessThan(reservations.reservePending.mock.invocationCallOrder[0]);
    expect(reservations.reservePending).toHaveBeenCalledWith(7);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("fanout claimed=1 batches=1"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("scanned=3 eligible=2 skipped=1 handedOff=1"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("reservation scanned=2 reserved=1"));
    expect(log.mock.calls.flat().join(" ")).not.toContain("candidate-");
  });

  it("prevents an overlapping execution while the current bounded pass is still running", async () => {
    const { preparation, reservations, runner } = createRunner({
      AVAILABILITY_REMINDER_PREPARATION_ENABLED: true,
      AVAILABILITY_REMINDER_PREPARATION_BATCH_SIZE: 5
    });
    let resolvePreparation: ((value: typeof EMPTY_RESULT) => void) | undefined;
    preparation.preparePending.mockImplementation(() => new Promise<typeof EMPTY_RESULT>((resolve) => {
      resolvePreparation = resolve;
    }));

    const first = runner.prepareDue();
    await Promise.resolve();
    await expect(runner.prepareDue()).resolves.toBeUndefined();
    expect(preparation.preparePending).toHaveBeenCalledTimes(1);

    resolvePreparation!(EMPTY_RESULT);
    await expect(first).resolves.toEqual(EMPTY_RESULT);
    expect(reservations.reservePending).toHaveBeenCalledTimes(1);
  });

  it("refills preparation and reservation in bounded batches until both queues are drained", async () => {
    const { preparation, reservations, runner } = createRunner({
      AVAILABILITY_REMINDER_PREPARATION_ENABLED: true,
      AVAILABILITY_REMINDER_PREPARATION_BATCH_SIZE: 3
    });
    preparation.preparePending
      .mockResolvedValueOnce({ ...EMPTY_RESULT, scanned: 3, eligible: 3, handedOff: 3 })
      .mockResolvedValueOnce({ ...EMPTY_RESULT, scanned: 1, eligible: 1, handedOff: 1 });
    reservations.reservePending
      .mockResolvedValueOnce({
        scanned: 3, reserved: 3, alreadyProcessed: 0, skipped: 0, disappeared: 0,
        retryScheduled: 0, failed: 0, leaseLost: 0
      })
      .mockResolvedValueOnce({
        scanned: 2, reserved: 2, alreadyProcessed: 0, skipped: 0, disappeared: 0,
        retryScheduled: 0, failed: 0, leaseLost: 0
      });

    await expect(runner.prepareDue()).resolves.toMatchObject({
      scanned: 4,
      eligible: 4,
      handedOff: 4
    });
    expect(preparation.preparePending).toHaveBeenCalledTimes(2);
    expect(reservations.reservePending).toHaveBeenCalledTimes(2);
    expect(preparation.preparePending).toHaveBeenNthCalledWith(1, 3);
    expect(preparation.preparePending).toHaveBeenNthCalledWith(2, 3);
    expect(reservations.reservePending).toHaveBeenNthCalledWith(1, 3);
    expect(reservations.reservePending).toHaveBeenNthCalledWith(2, 3);
  });

  it("starts an unref'd interval and an immediate safe pass only after explicit enablement", async () => {
    const { preparation, reservations, runner } = createRunner({
      AVAILABILITY_REMINDER_PREPARATION_ENABLED: true,
      AVAILABILITY_REMINDER_PREPARATION_INTERVAL_SECONDS: 45,
      AVAILABILITY_REMINDER_PREPARATION_BATCH_SIZE: 6
    });
    preparation.preparePending.mockResolvedValue(EMPTY_RESULT);
    const interval = jest.spyOn(global, "setInterval");
    const clear = jest.spyOn(global, "clearInterval");

    runner.onModuleInit();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(interval).toHaveBeenCalledWith(expect.any(Function), 45_000);
    expect(preparation.preparePending).toHaveBeenCalledWith(6);
    expect(reservations.reservePending).toHaveBeenCalledWith(6);
    runner.onModuleDestroy();
    expect(clear).toHaveBeenCalled();
  });

  it("contains runner errors in the lifecycle path without treating them as a successful pass", async () => {
    const { preparation, runner } = createRunner({
      AVAILABILITY_REMINDER_PREPARATION_ENABLED: true
    });
    preparation.preparePending.mockRejectedValue(new Error("database unavailable"));
    const error = jest.spyOn((runner as any).logger, "error").mockImplementation(() => undefined);

    (runner as any).prepareDueSafely();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(error).toHaveBeenCalledWith(expect.stringContaining("Error"));
    runner.onModuleDestroy();
  });
});
