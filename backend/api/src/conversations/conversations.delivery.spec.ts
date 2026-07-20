import { ConversationsService } from "./conversations.service";

function moderationResult(decision: "allow" | "warn" | "review" | "block") {
  return {
    decision,
    riskLevel: decision === "block" ? "high" : decision === "allow" ? "low" : "medium",
    priority: decision === "block" ? "high" : "normal",
    score: decision === "block" ? 0.92 : decision === "allow" ? 0.05 : 0.62,
    reasons: [decision === "block" ? "疑似引导私下联系" : "需要人工复核"],
    matchedRules: decision === "block" ? ["contact.wechat"] : ["harass.pua"],
    categories: decision === "block" ? ["privateContact"] : ["harassmentOrHate"],
    policyVersion: "chat-v2",
    usedAI: false
  } as any;
}

describe("ConversationsService moderation delivery state machine", () => {
  function setup(decision: "allow" | "warn" | "review" | "block") {
    const prisma = {
      conversation: { findFirst: jest.fn().mockResolvedValue({
        id: "conv-1",
        externalId: "c1",
        userId: "user-1",
        companion: { ownerUserId: "companion-owner", name: "陪伴者" }
      }) },
      companionProfile: { findFirst: jest.fn() },
      user: { findUnique: jest.fn().mockResolvedValue({ id: "user-1", profile: { displayName: "用户", safetyScore: 80 } }) },
      message: { findMany: jest.fn().mockResolvedValue([]) },
      moderationCase: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn()
    } as any;
    const moderation = { moderateAsync: jest.fn().mockResolvedValue(moderationResult(decision)) } as any;
    const moderationCases = { createFromResult: jest.fn().mockResolvedValue({ id: "case-1" }) } as any;
    const chatRestrictions = {
      assertCanSend: jest.fn().mockResolvedValue(undefined),
      recordAutomaticHighRiskBlock: jest.fn().mockResolvedValue(null)
    } as any;
    const mediaAssets = {
      isFeatureEnabled: jest.fn(() => false),
      bindUploadedAssets: jest.fn(),
      attachmentsForMessage: jest.fn().mockResolvedValue([])
    } as any;
    const mediaWorker = { enqueue: jest.fn() } as any;
    const create = jest.fn().mockImplementation(({ data }: any) => ({
      id: data.type === "safety" ? "safety-1" : "message-1",
      ...data
    }));
    const db = {
      message: { create, update: jest.fn() },
      mediaAsset: { updateMany: jest.fn() },
      conversation: { update: jest.fn() }
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(db));
    const service = new ConversationsService(prisma, moderation, moderationCases, chatRestrictions, mediaAssets, mediaWorker);
    return { service, prisma, moderationCases, chatRestrictions, db };
  }

  it("blocks a hard-rule message before delivery and records its appeal-eligible case", async () => {
    const { service, moderationCases, chatRestrictions, db } = setup("block");

    const result = await service.send("user-1", "c1", { content: "加微信聊吧" });

    expect(db.message.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({ moderationStatus: "blocked", visibility: "senderOnly" })
    }));
    expect(result.message).toBeNull();
    expect(result.moderation).toEqual(expect.objectContaining({
      deliveryStatus: "blocked", appealEligible: true, caseId: "case-1"
    }));
    expect(moderationCases.createFromResult).toHaveBeenCalledWith(expect.objectContaining({ messageId: "message-1" }));
    expect(chatRestrictions.recordAutomaticHighRiskBlock).toHaveBeenCalledWith("user-1", "case-1");
  });

  it("holds warn/review output for the sender instead of delivering it to the other participant", async () => {
    const { service, db } = setup("warn");

    const result = await service.send("user-1", "c1", { content: "你真废物" });

    expect(db.message.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({ moderationStatus: "pendingReview", visibility: "senderOnly" })
    }));
    expect(result.message).toEqual(expect.objectContaining({ moderationStatus: "pendingReview", visibility: "senderOnly" }));
    expect(result.moderation).toEqual(expect.objectContaining({ deliveryStatus: "pendingReview", appealEligible: false }));
  });
});
