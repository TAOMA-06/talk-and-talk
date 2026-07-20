import { MediaAssetService } from "./media-asset.service";

describe("MediaAssetService retention and presentation", () => {
  const prisma = {
    mediaAsset: {
      updateMany: jest.fn()
    }
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
    service = new MediaAssetService(prisma, storage, analysis);
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
});
