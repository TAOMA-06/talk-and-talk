import { AvailabilityReminderPreparationRunner } from "./availability-reminder-preparation.runner";

const EMPTY_RESULT = {
  scanned: 0,
  eligible: 0,
  skipped: 0,
  handedOff: 0,
  alreadyHandedOff: 0,
  disappeared: 0
};

function createRunner(values: Record<string, unknown> = {}) {
  const config = {
    get: jest.fn((key: string) => values[key])
  } as any;
  const preparation = { preparePending: jest.fn() } as any;
  const runner = new AvailabilityReminderPreparationRunner(config, preparation);
  return { config, preparation, runner };
}

describe("AvailabilityReminderPreparationRunner", () => {
  afterEach(() => jest.restoreAllMocks());

  it("does nothing by default: no timer and no internal preparation call", async () => {
    const { preparation, runner } = createRunner({
      AVAILABILITY_REMINDER_PREPARATION_ENABLED: false
    });
    const interval = jest.spyOn(global, "setInterval");

    runner.onModuleInit();

    expect(interval).not.toHaveBeenCalled();
    await expect(runner.prepareDue()).resolves.toBeUndefined();
    expect(preparation.preparePending).not.toHaveBeenCalled();
    runner.onModuleDestroy();
  });

  it("runs only the bounded preparation coordinator and emits aggregate-only operational facts", async () => {
    const { preparation, runner } = createRunner({
      AVAILABILITY_REMINDER_PREPARATION_ENABLED: true,
      AVAILABILITY_REMINDER_PREPARATION_BATCH_SIZE: 7
    });
    preparation.preparePending.mockResolvedValue({
      scanned: 3,
      eligible: 2,
      skipped: 1,
      handedOff: 1,
      alreadyHandedOff: 1,
      disappeared: 0
    });
    const log = jest.spyOn((runner as any).logger, "log").mockImplementation(() => undefined);

    await expect(runner.prepareDue()).resolves.toEqual(expect.objectContaining({ scanned: 3, handedOff: 1 }));

    expect(preparation.preparePending).toHaveBeenCalledWith(7);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("scanned=3 eligible=2 skipped=1 handedOff=1"));
    expect(log.mock.calls.flat().join(" ")).not.toContain("candidate-");
  });

  it("prevents an overlapping execution while the current bounded pass is still running", async () => {
    const { preparation, runner } = createRunner({
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
  });

  it("starts an unref'd interval and an immediate safe pass only after explicit enablement", async () => {
    const { preparation, runner } = createRunner({
      AVAILABILITY_REMINDER_PREPARATION_ENABLED: true,
      AVAILABILITY_REMINDER_PREPARATION_INTERVAL_SECONDS: 45,
      AVAILABILITY_REMINDER_PREPARATION_BATCH_SIZE: 6
    });
    preparation.preparePending.mockResolvedValue(EMPTY_RESULT);
    const interval = jest.spyOn(global, "setInterval");
    const clear = jest.spyOn(global, "clearInterval");

    runner.onModuleInit();
    await Promise.resolve();

    expect(interval).toHaveBeenCalledWith(expect.any(Function), 45_000);
    expect(preparation.preparePending).toHaveBeenCalledWith(6);
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

    expect(error).toHaveBeenCalledWith(expect.stringContaining("Error"));
    runner.onModuleDestroy();
  });
});
