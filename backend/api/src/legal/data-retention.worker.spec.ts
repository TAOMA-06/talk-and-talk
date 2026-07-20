import { DataRetentionWorker } from "./data-retention.worker";

describe("DataRetentionWorker", () => {
  it("applies the configured ceiling only to low-risk operational records", async () => {
    const tx = {
      notification: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
      weChatSubscriptionGrant: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) }
    } as any;
    const prisma = {
      $transaction: jest.fn(async (callback: (db: any) => Promise<unknown>) => callback(tx))
    } as any;
    const config = {
      get: jest.fn((key: string) => key === "LEGAL_PRIVACY_RETENTION_DAYS" ? 365 : undefined)
    } as any;
    const audit = { record: jest.fn().mockResolvedValue({}) } as any;
    const worker = new DataRetentionWorker(prisma, config, audit);

    await expect(worker.runOnce()).resolves.toEqual(expect.objectContaining({
      skipped: false,
      deletedNotifications: 3,
      deletedSubscriptionGrants: 2,
      deletedRefreshTokens: 1
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "privacy.retention_cleanup_completed",
      metadata: expect.objectContaining({ retentionDays: 365 })
    }), tx);
  });
});
