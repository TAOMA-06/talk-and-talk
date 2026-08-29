import { RuleEngine } from "../moderation/rule-engine";
import { CompanionProfileMediaService } from "./companion-profile-media.service";

describe("CompanionProfileMediaService", () => {
  const now = new Date("2026-08-28T08:00:00.000Z");
  const companion = {
    id: "companion-1",
    ownerUserId: "owner-1",
    avatarAssetId: "avatar-old",
    coverAssetId: null
  };
  const asset = {
    id: "asset-1",
    uploaderId: "owner-1",
    profileCompanionId: "companion-1",
    purpose: "companionAvatar",
    kind: "image",
    status: "reserved",
    storageKey: "profile-media/companion-1/avatar/asset-1",
    mimeType: "image/webp",
    sizeBytes: 128_000,
    sha256: "a".repeat(64),
    durationMs: null,
    uploadExpiresAt: new Date(Date.now() + 60_000),
    createdAt: now,
    updatedAt: now
  };
  const prisma: any = {
    companionProfile: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn()
    },
    mediaAsset: {
      create: jest.fn(),
      delete: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn()
    },
    $transaction: jest.fn(async (callback: any) => callback(prisma))
  };
  const storage: any = {
    name: "mock",
    isConfigured: true,
    createUploadInstruction: jest.fn(),
    verifyUpload: jest.fn(),
    createReadUrl: jest.fn(),
    delete: jest.fn()
  };
  const analysis: any = {
    name: "mock",
    isConfigured: true,
    analyzeImage: jest.fn(),
    transcribeAudio: jest.fn()
  };
  const fullConfig: any = {
    get: (key: string) => key === "COMMERCIAL_SURFACE" ? "full" : undefined
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.companionProfile.findUnique.mockResolvedValue(companion);
    prisma.companionProfile.findFirst.mockResolvedValue(companion);
    prisma.companionProfile.update.mockResolvedValue(companion);
    prisma.mediaAsset.create.mockResolvedValue(asset);
    prisma.mediaAsset.findFirst.mockResolvedValue(asset);
    prisma.mediaAsset.findUnique.mockResolvedValue({ ...asset, status: "approved" });
    prisma.mediaAsset.update.mockImplementation(async ({ data }: any) => ({ ...asset, ...data }));
    storage.createUploadInstruction.mockResolvedValue({
      url: "mock://upload",
      method: "PUT",
      headers: { "x-media-asset-id": asset.id },
      expiresAt: new Date(Date.now() + 60_000)
    });
    storage.verifyUpload.mockResolvedValue(true);
    storage.createReadUrl.mockResolvedValue("mock://read/profile-media");
    analysis.analyzeImage.mockResolvedValue({
      available: true,
      score: 0.05,
      reasons: [],
      categories: ["normal"],
      provider: "mock",
      providerVersion: "v1"
    });
  });

  const service = () => new CompanionProfileMediaService(
    prisma,
    storage,
    analysis,
    new RuleEngine(),
    fullConfig
  );

  it("reserves an owner-scoped avatar upload with the strict avatar limit", async () => {
    const result = await service().reserve("owner-1", "avatar", {
      mimeType: "image/webp",
      sizeBytes: 128_000,
      sha256: "a".repeat(64)
    });

    expect(prisma.mediaAsset.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        uploaderId: "owner-1",
        profileCompanionId: "companion-1",
        purpose: "companionAvatar",
        storageKey: expect.stringContaining("profile-media/companion-1/avatar/"),
        expiresAt: expect.any(Date)
      })
    }));
    expect(prisma.mediaAsset.update).toHaveBeenCalledWith({
      where: { id: "asset-1" },
      data: {
        uploadExpiresAt: expect.any(Date),
        expiresAt: expect.any(Date)
      }
    });
    expect(result.upload.url).toBe("mock://upload");
  });

  it("rejects an avatar larger than 2MB before creating storage state", async () => {
    await expect(service().reserve("owner-1", "avatar", {
      mimeType: "image/png",
      sizeBytes: 2 * 1024 * 1024 + 1,
      sha256: "a".repeat(64)
    })).rejects.toMatchObject({ code: "PROFILE_MEDIA_SIZE_INVALID", status: 422 });
    expect(prisma.mediaAsset.create).not.toHaveBeenCalled();
  });

  it("publishes only an approved upload and retires the replaced asset", async () => {
    const result = await service().complete("owner-1", "avatar", "asset-1");

    expect(prisma.companionProfile.update).toHaveBeenCalledWith({
      where: { id: "companion-1" },
      data: { avatarAssetId: "asset-1" }
    });
    expect(prisma.mediaAsset.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "avatar-old" },
      data: expect.objectContaining({ expiresAt: expect.any(Date), storageDeleteNextAttemptAt: expect.any(Date) })
    }));
    expect(result.asset.published).toBe(true);
  });

  it("keeps unavailable moderation results private for review", async () => {
    analysis.analyzeImage.mockResolvedValue({
      available: false,
      score: 0.05,
      reasons: ["unavailable"],
      categories: [],
      provider: "disabled"
    });
    prisma.mediaAsset.findUnique.mockResolvedValue({ ...asset, status: "reviewRequired" });

    const result = await service().complete("owner-1", "avatar", "asset-1");

    expect(prisma.companionProfile.update).not.toHaveBeenCalled();
    expect(result.asset.status).toBe("reviewRequired");
    expect(result.asset.published).toBe(false);
  });

  it("recovers a scanning retry and fails provider exceptions into private review", async () => {
    prisma.mediaAsset.findFirst.mockResolvedValue({ ...asset, status: "scanning" });
    prisma.mediaAsset.findUnique.mockResolvedValue({ ...asset, status: "reviewRequired" });
    analysis.analyzeImage.mockRejectedValue(Object.assign(new Error("provider unavailable"), { name: "ProviderUnavailable" }));

    const result = await service().complete("owner-1", "avatar", "asset-1");

    expect(storage.verifyUpload).not.toHaveBeenCalled();
    expect(result.asset.status).toBe("reviewRequired");
    expect(prisma.companionProfile.update).not.toHaveBeenCalled();
  });

  it("allows an owner to remove a historical image even when uploads are disabled", async () => {
    const textOnly = new CompanionProfileMediaService(
      prisma,
      storage,
      analysis,
      new RuleEngine(),
      { get: () => "text_only" } as any
    );

    await expect(textOnly.remove("owner-1", "avatar")).resolves.toEqual({ removed: true, slot: "avatar" });
    expect(prisma.companionProfile.update).toHaveBeenCalledWith({
      where: { id: "companion-1" },
      data: { avatarAssetId: null }
    });
  });

  it("serves only approved media for a currently public companion", async () => {
    prisma.companionProfile.findFirst.mockResolvedValue({
      avatarAsset: { ...asset, status: "approved", storageDeletedAt: null, expiresAt: null }
    });
    await expect(service().publicReadUrl("companion-1", "avatar"))
      .resolves.toBe("mock://read/profile-media");
    expect(prisma.companionProfile.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "companion-1", isPublished: true, isVerified: true })
    }));
  });

  it("does not issue a read URL for an approved image whose retention has expired", async () => {
    prisma.companionProfile.findFirst.mockResolvedValue({
      avatarAsset: {
        ...asset,
        status: "approved",
        storageDeletedAt: null,
        expiresAt: new Date(Date.now() - 1)
      }
    });

    await expect(service().publicReadUrl("companion-1", "avatar"))
      .rejects.toMatchObject({ code: "PROFILE_MEDIA_NOT_FOUND", status: 404 });
    expect(storage.createReadUrl).not.toHaveBeenCalled();
  });

  it("fails closed on the text-only release surface", async () => {
    const textOnly = new CompanionProfileMediaService(
      prisma,
      storage,
      analysis,
      new RuleEngine(),
      { get: () => "text_only" } as any
    );
    await expect(textOnly.reserve("owner-1", "avatar", {
      mimeType: "image/webp",
      sizeBytes: 128_000,
      sha256: "a".repeat(64)
    })).rejects.toMatchObject({ code: "PROFILE_MEDIA_DISABLED", status: 503 });
  });
});
