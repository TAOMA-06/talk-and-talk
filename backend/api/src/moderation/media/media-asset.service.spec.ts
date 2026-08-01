import { MediaAssetService } from "./media-asset.service";
import { DisabledMediaStorageProvider } from "./disabled-media.providers";

describe("MediaAssetService retention and presentation", () => {
  const prisma = {
    mediaAsset: {
      updateMany: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn()
    },
    $queryRawUnsafe: jest.fn(),
    $executeRawUnsafe: jest.fn()
  } as any;
  const storage = {
    name: "test-storage",
    isConfigured: true,
    createUploadInstruction: jest.fn(),
    verifyUpload: jest.fn(),
    createReadUrl: jest.fn(),
    delete: jest.fn()
  } as any;
  const analysis = { name: "test-analysis", isConfigured: true } as any;
  let service: MediaAssetService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$queryRawUnsafe.mockResolvedValue([]);
    prisma.$executeRawUnsafe.mockResolvedValue(1);
    service = new MediaAssetService(prisma, storage, analysis);
  });

  const claimedAsset = (overrides: Record<string, unknown> = {}) => ({
    id: "asset-1",
    storageKey: "chat/c1/asset-1",
    kind: "image",
    mimeType: "image/jpeg",
    sizeBytes: 12,
    sha256: "a".repeat(64),
    durationMs: null,
    storageDeleteLeaseToken: "lease-1",
    storageDeleteAttemptCount: 1,
    ...overrides
  });

  it("raises case-linked media retention to roughly 180 days", async () => {
    prisma.mediaAsset.updateMany.mockResolvedValue({ count: 1 });
    const before = Date.now();

    await service.preserveEvidenceForMessage("message-1");

    const data = prisma.mediaAsset.updateMany.mock.calls[0][0].data;
    const durationDays = (data.expiresAt.getTime() - before) / (24 * 60 * 60 * 1000);
    expect(durationDays).toBeGreaterThan(179);
    expect(durationDays).toBeLessThanOrEqual(180.01);
  });

  it("does not provide a read URL for expired media", async () => {
    const attachment = await service.toAttachmentDto({
      id: "asset-1",
      storageKey: "chat/c1/asset-1",
      kind: "image",
      status: "expired",
      mimeType: "image/jpeg",
      sizeBytes: 1,
      sha256: "a".repeat(64),
      expiresAt: new Date()
    });

    expect(attachment.url).toBeNull();
    expect(storage.createReadUrl).not.toHaveBeenCalled();
  });

  it("marks media expired only after object storage confirms deletion", async () => {
    const now = new Date("2026-07-20T00:00:00.000Z");
    prisma.$queryRawUnsafe.mockResolvedValue([claimedAsset()]);
    storage.delete.mockResolvedValue("deleted");

    await expect(service.expireDueAssets(now)).resolves.toEqual({
      processed: 1,
      expired: 1,
      notFound: 0,
      failed: 0,
      leaseLost: 0,
      batchSize: 20,
      hasMore: false
    });

    const claimSql = prisma.$queryRawUnsafe.mock.calls[0][0] as string;
    expect(claimSql).toContain("FOR UPDATE SKIP LOCKED");
    expect(claimSql).toContain('"storageDeleteLeaseExpiresAt" <= CURRENT_TIMESTAMP');
    expect(prisma.$queryRawUnsafe.mock.calls[0].slice(1)).toEqual([now, 20, 120000]);
    const finalize = prisma.$executeRawUnsafe.mock.calls[0];
    expect(finalize[0]).toContain('"storageDeletedAt" = $1');
    expect(finalize[0]).toContain('"storageDeleteLeaseToken" = $3');
    expect(finalize.slice(2)).toEqual(["asset-1", "lease-1"]);
    expect(storage.delete.mock.invocationCallOrder[0])
      .toBeLessThan(prisma.$executeRawUnsafe.mock.invocationCallOrder[0]);
  });

  it("keeps failed storage deletions retryable instead of claiming they expired", async () => {
    const now = new Date("2026-07-20T00:00:00.000Z");
    prisma.$queryRawUnsafe.mockResolvedValue([claimedAsset({ storageDeleteAttemptCount: 3 })]);
    storage.delete.mockRejectedValue(new Error("storage unavailable"));

    await expect(service.expireDueAssets(now)).resolves.toEqual({
      processed: 1,
      expired: 0,
      notFound: 0,
      failed: 1,
      leaseLost: 0,
      batchSize: 20,
      hasMore: false
    });

    const failure = prisma.$executeRawUnsafe.mock.calls[0];
    expect(failure[0]).toContain('"storageDeleteNextAttemptAt" = $1');
    expect(failure[0]).not.toContain('"status" = \'expired\'');
    expect(failure[2]).toBe("media_storage_delete_failed");
    expect(failure.slice(3)).toEqual(["asset-1", "lease-1"]);
  });

  it("never finalizes deletion when storage is disabled and absence cannot be proven", async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([claimedAsset()]);
    service = new MediaAssetService(prisma, new DisabledMediaStorageProvider(), analysis);

    await expect(service.expireDueAssets()).resolves.toEqual(expect.objectContaining({
      processed: 1,
      expired: 0,
      notFound: 0,
      failed: 1
    }));

    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRawUnsafe.mock.calls[0][0]).toContain('"storageDeleteNextAttemptAt" = $1');
    expect(prisma.$executeRawUnsafe.mock.calls[0][0]).not.toContain('"storageDeletedAt" = $1');
  });

  it("treats provider NotFound as an idempotent terminal deletion", async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([claimedAsset()]);
    storage.delete.mockResolvedValue("notFound");

    await expect(service.expireDueAssets()).resolves.toEqual(expect.objectContaining({
      processed: 1,
      expired: 1,
      notFound: 1,
      failed: 0,
      leaseLost: 0
    }));
    expect(prisma.$executeRawUnsafe.mock.calls[0][0]).toContain('"storageDeletedAt" = $1');
  });

  it("recovers provider-thrown 404/NoSuchKey as idempotent success", async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([claimedAsset()]);
    storage.delete.mockRejectedValue(Object.assign(new Error("missing"), { code: "NoSuchKey" }));

    await expect(service.expireDueAssets()).resolves.toEqual(expect.objectContaining({
      expired: 1,
      notFound: 1,
      failed: 0
    }));
  });

  it("recognizes an SDK metadata 404 even when its code is provider-specific", async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([claimedAsset()]);
    storage.delete.mockRejectedValue(Object.assign(new Error("missing"), {
      code: "ProviderRequestError",
      $metadata: { httpStatusCode: 404 }
    }));

    await expect(service.expireDueAssets()).resolves.toEqual(expect.objectContaining({
      expired: 1,
      notFound: 1,
      failed: 0
    }));
  });

  it("releases the lease into backoff when object storage does not settle before the timeout", async () => {
    jest.useFakeTimers();
    prisma.$queryRawUnsafe.mockResolvedValue([claimedAsset()]);
    storage.delete.mockReturnValue(new Promise(() => undefined));

    try {
      const expiry = service.expireDueAssets();
      await jest.advanceTimersByTimeAsync(15_000);
      await expect(expiry).resolves.toEqual(expect.objectContaining({
        expired: 0,
        failed: 1,
        leaseLost: 0
      }));
      expect(prisma.$executeRawUnsafe.mock.calls[0][2]).toBe("media_storage_delete_timeout");
      expect(prisma.$executeRawUnsafe.mock.calls[0][0]).toContain('"storageDeleteLeaseToken" = NULL');
    } finally {
      jest.useRealTimers();
    }
  });

  it("reports a lost lease instead of finalizing with a stale token", async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([claimedAsset()]);
    storage.delete.mockResolvedValue("deleted");
    prisma.$executeRawUnsafe.mockResolvedValue(0);

    await expect(service.expireDueAssets()).resolves.toEqual(expect.objectContaining({
      processed: 1,
      expired: 0,
      failed: 0,
      leaseLost: 1
    }));
  });

  it("exposes a continuation when the durable claim reaches its batch bound", async () => {
    const now = new Date("2026-07-20T00:00:00.000Z");
    prisma.$queryRawUnsafe.mockResolvedValue(
      Array.from({ length: 20 }, (_, index) => claimedAsset({
        id: `asset-${index}`,
        storageKey: `chat/c1/asset-${index}`,
        storageDeleteLeaseToken: `lease-${index}`
      }))
    );
    storage.delete.mockResolvedValue("deleted");

    await expect(service.expireDueAssets(now)).resolves.toEqual({
      processed: 20,
      expired: 20,
      notFound: 0,
      failed: 0,
      leaseLost: 0,
      batchSize: 20,
      hasMore: true
    });
    expect(storage.delete).toHaveBeenCalledTimes(20);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(20);
  });
});
