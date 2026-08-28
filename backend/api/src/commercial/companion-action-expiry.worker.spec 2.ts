import { CompanionActionExpiryWorker } from "./companion-action-expiry.worker";

describe("CompanionActionExpiryWorker", () => {
  const values: Record<string, unknown> = {
    COMPANION_ACTION_EXPIRY_ENABLED: true,
    COMPANION_ACTION_EXPIRY_BATCH_SIZE: 37
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => values[key] ?? fallback)
  } as any;
  const lifecycle = {
    materializeExpiredSuspensionReactivations: jest.fn()
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    values.COMPANION_ACTION_EXPIRY_ENABLED = true;
    values.COMPANION_ACTION_EXPIRY_BATCH_SIZE = 37;
    lifecycle.materializeExpiredSuspensionReactivations.mockResolvedValue({
      scanned: 5,
      materialized: 3,
      hasMore: false
    });
  });

  it("runs a bounded materialization batch", async () => {
    const worker = new CompanionActionExpiryWorker(config, lifecycle);

    await expect(worker.scan()).resolves.toEqual({
      skipped: false,
      scanned: 5,
      materialized: 3,
      hasMore: false
    });
    expect(lifecycle.materializeExpiredSuspensionReactivations).toHaveBeenCalledWith(37);
  });

  it("immediately continues after a full bounded database claim", async () => {
    jest.useFakeTimers();
    lifecycle.materializeExpiredSuspensionReactivations
      .mockResolvedValueOnce({ scanned: 37, materialized: 37, hasMore: true })
      .mockResolvedValueOnce({ scanned: 2, materialized: 2, hasMore: false });
    const worker = new CompanionActionExpiryWorker(config, lifecycle);
    try {
      await expect(worker.scan()).resolves.toEqual(expect.objectContaining({ hasMore: true }));
      await jest.advanceTimersByTimeAsync(1_000);
      expect(lifecycle.materializeExpiredSuspensionReactivations).toHaveBeenCalledTimes(2);
    } finally {
      worker.onModuleDestroy();
      jest.useRealTimers();
    }
  });

  it("does not scan when the expiry worker is disabled", async () => {
    values.COMPANION_ACTION_EXPIRY_ENABLED = false;
    const worker = new CompanionActionExpiryWorker(config, lifecycle);

    await expect(worker.scan()).resolves.toEqual({
      skipped: true,
      scanned: 0,
      materialized: 0
    });
    expect(lifecycle.materializeExpiredSuspensionReactivations).not.toHaveBeenCalled();
  });
});
