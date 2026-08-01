import { ControlledCaseEvidenceWorker } from "./controlled-case-evidence.worker";

describe("ControlledCaseEvidenceWorker", () => {
  const baseAsset = {
    id: "asset-1",
    purpose: "orderSupportFact",
    status: "scanning",
    kind: "image",
    storageKey: "case-evidence/orderSupportFact/ticket-1/asset-1",
    mimeType: "image/jpeg",
    sizeBytes: 12,
    sha256: "a".repeat(64),
    durationMs: null,
    retryCount: 0,
    nextAttemptAt: null
  };
  const prisma: any = {
    mediaAsset: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn()
    }
  };
  const mediaAssets: any = {
    isFeatureEnabled: jest.fn().mockReturnValue(true),
    toReference: jest.fn((asset) => asset)
  };
  const analysis: any = {
    name: "analysis-provider",
    analyzeImage: jest.fn(),
    transcribeAudio: jest.fn()
  };
  const moderation: any = { moderateAsync: jest.fn() };
  const ruleEngine: any = { decisionFor: jest.fn() };
  let worker: ControlledCaseEvidenceWorker;

  beforeEach(() => {
    jest.clearAllMocks();
    worker = new ControlledCaseEvidenceWorker(prisma, mediaAssets, analysis, moderation, ruleEngine);
    prisma.mediaAsset.findFirst.mockResolvedValue(baseAsset);
    prisma.mediaAsset.updateMany.mockResolvedValue({ count: 1 });
    analysis.analyzeImage.mockResolvedValue({
      available: true,
      score: 0.05,
      reasons: [],
      categories: ["normal"],
      provider: "analysis-provider",
      providerVersion: "v1",
      extractedText: "ordinary receipt summary"
    });
    moderation.moderateAsync.mockResolvedValue({
      decision: "allow",
      score: 0.05,
      categories: ["normal"],
      policyVersion: "chat-v2"
    });
  });

  it("approves verified standalone media without retaining OCR or transcript text", async () => {
    ruleEngine.decisionFor.mockReturnValue("allow");

    await worker.processAsset(baseAsset.id);

    const finalUpdate = prisma.mediaAsset.updateMany.mock.calls[1][0];
    expect(finalUpdate.where).toEqual(expect.objectContaining({
      id: baseAsset.id,
      status: "scanning",
      moderationProcessingToken: expect.any(String)
    }));
    expect(finalUpdate.data).toEqual(expect.objectContaining({
      status: "approved",
      extractedText: null,
      retryCount: 0,
      moderationProcessingToken: null
    }));
    expect(JSON.stringify(finalUpdate.data)).not.toContain("ordinary receipt summary");
  });

  it("keeps non-allow evidence unbindable and never exposes it as approved", async () => {
    ruleEngine.decisionFor.mockReturnValue("review");

    await worker.processAsset(baseAsset.id);

    expect(prisma.mediaAsset.updateMany.mock.calls[1][0].data).toEqual(expect.objectContaining({
      status: "reviewRequired",
      lastError: "case_evidence_not_approved"
    }));
  });

  it("fails closed after bounded provider retries", async () => {
    prisma.mediaAsset.findFirst.mockResolvedValue({ ...baseAsset, retryCount: 3 });
    analysis.analyzeImage.mockResolvedValue({
      available: false,
      score: 0,
      reasons: ["provider unavailable"],
      categories: []
    });

    await worker.processAsset(baseAsset.id);

    expect(prisma.mediaAsset.updateMany.mock.calls[1][0].data).toEqual(expect.objectContaining({
      status: "failed",
      retryCount: 4,
      nextAttemptAt: null,
      lastError: "case_evidence_moderation_unavailable"
    }));
  });
});
