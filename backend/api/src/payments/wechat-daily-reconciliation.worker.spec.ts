import { WeChatDailyReconciliationWorker } from "./wechat-daily-reconciliation.worker";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeHarness(configValues: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    WECHAT_DAILY_BILL_RECONCILIATION_ENABLED: true,
    WECHAT_DAILY_BILL_RECONCILIATION_BATCH_SIZE: 4,
    PAYMENT_RECONCILIATION_INTERVAL_SECONDS: 60,
    ...configValues
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => (
      Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback
    ))
  } as any;
  const reconciliation = {
    ensureExpectedRuns: jest.fn().mockResolvedValue({
      created: 0,
      coverageStartDate: "2026-07-31",
      dueDate: "2026-07-31",
      billDates: ["2026-07-31"]
    }),
    processDue: jest.fn().mockResolvedValue({ processed: 0, reconciled: 0, noStatement: 0, failed: 0 })
  } as any;
  const worker = new WeChatDailyReconciliationWorker(config, reconciliation);
  return { worker, config, reconciliation };
}

describe("WeChatDailyReconciliationWorker", () => {
  it("skips a concurrent tick while the first reconciliation still owns the worker", async () => {
    const { worker, reconciliation } = makeHarness();
    const scheduling = deferred<{
      created: number;
      coverageStartDate: string;
      dueDate: string;
      billDates: string[];
    }>();
    reconciliation.ensureExpectedRuns.mockReturnValueOnce(scheduling.promise);
    const now = new Date("2026-08-01T02:00:00.000Z");

    const first = worker.reconcile(now);
    await Promise.resolve();
    await expect(worker.reconcile(now)).resolves.toEqual({ skipped: true });
    expect(reconciliation.ensureExpectedRuns).toHaveBeenCalledTimes(1);
    expect(reconciliation.processDue).not.toHaveBeenCalled();

    const scheduled = {
      created: 4,
      coverageStartDate: "2026-07-31",
      dueDate: "2026-07-31",
      billDates: ["2026-07-31"]
    };
    scheduling.resolve(scheduled);
    await expect(first).resolves.toEqual({
      skipped: false,
      scheduled,
      processed: { processed: 0, reconciled: 0, noStatement: 0, failed: 0 }
    });
    expect(reconciliation.processDue).toHaveBeenCalledWith(4, now);
  });

  it("returns the scheduling and processing summary and honors the configured batch size", async () => {
    const { worker, reconciliation } = makeHarness({
      WECHAT_DAILY_BILL_RECONCILIATION_BATCH_SIZE: 7
    });
    const now = new Date("2026-08-01T02:00:00.000Z");
    const scheduled = {
      created: 4,
      coverageStartDate: "2026-07-31",
      dueDate: "2026-07-31",
      billDates: ["2026-07-31"]
    };
    const processed = { processed: 4, reconciled: 2, noStatement: 1, failed: 1 };
    reconciliation.ensureExpectedRuns.mockResolvedValue(scheduled);
    reconciliation.processDue.mockResolvedValue(processed);

    await expect(worker.reconcile(now)).resolves.toEqual({
      skipped: false,
      scheduled,
      processed
    });
    expect(reconciliation.ensureExpectedRuns).toHaveBeenCalledWith(now);
    expect(reconciliation.processDue).toHaveBeenCalledWith(7, now);
  });

  it("releases the re-entry guard after an exception", async () => {
    const { worker, reconciliation } = makeHarness();
    const now = new Date("2026-08-01T02:00:00.000Z");
    reconciliation.ensureExpectedRuns
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({
        created: 0,
        coverageStartDate: "2026-07-31",
        dueDate: "2026-07-31",
        billDates: ["2026-07-31"]
      });

    await expect(worker.reconcile(now)).rejects.toThrow("temporary failure");
    await expect(worker.reconcile(now)).resolves.toEqual(expect.objectContaining({ skipped: false }));
    expect(reconciliation.ensureExpectedRuns).toHaveBeenCalledTimes(2);
    expect(reconciliation.processDue).toHaveBeenCalledTimes(1);
  });
});
