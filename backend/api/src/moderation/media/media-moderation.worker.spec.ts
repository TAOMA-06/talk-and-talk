import { RuleEngine } from "../rule-engine";
import { MediaModerationWorker } from "./media-moderation.worker";

describe("MediaModerationWorker", () => {
  const prisma = {
    message: { findMany: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
    moderationCase: { count: jest.fn() },
    mediaAsset: { updateMany: jest.fn() },
    $transaction: jest.fn()
  } as any;
  const mediaAssets = {
    isFeatureEnabled: jest.fn(() => true),
    toReference: jest.fn((asset: any) => asset),
    expireDueAssets: jest.fn()
  } as any;
  const analysisProvider = { name: "test-media", isConfigured: true } as any;
  const moderation = { moderateAsync: jest.fn() } as any;
  const cases = { createFromResult: jest.fn() } as any;
  const restrictions = { recordAutomaticHighRiskBlock: jest.fn() } as any;
  const notifications = { createConversationMessageReceivedIfUnmuted: jest.fn() } as any;
  const rules = new RuleEngine();
  let worker: MediaModerationWorker;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.message.findMany.mockResolvedValue([]);
    prisma.moderationCase.count.mockResolvedValue(0);
    worker = new MediaModerationWorker(
      prisma,
      mediaAssets,
      analysisProvider,
      moderation,
      rules,
      cases,
      restrictions,
      notifications
    );
  });

  it("fuses image OCR and audio transcription into the text safety decision", async () => {
    moderation.moderateAsync.mockImplementation(async (text: string) => rules.moderate(text, "chat"));
    const message = { id: "message-1", conversationId: "conversation-1", senderId: "user-1", content: "" };
    const result = await (worker as any).moderateMessage(message, {
      items: [
        { asset: { id: "image-1" }, result: { available: true, score: 0.05, reasons: [], categories: ["normal"], extractedText: "这是二维码" } },
        { asset: { id: "audio-1" }, result: { available: true, score: 0.05, reasons: [], categories: ["normal"], extractedText: "加 V x 联系" } }
      ]
    });

    expect(moderation.moderateAsync).toHaveBeenCalledWith(expect.stringContaining("加 V x 联系"), "chat", expect.any(Object));
    expect(result.decision).toBe("block");
    expect(result.categories).toContain("privateContact");
  });

  it("keeps media queued through all three backoff retries before moving it to human review", async () => {
    const message = {
      id: "message-1",
      conversationId: "conversation-1",
      senderId: "user-1",
      content: "",
      attachments: [{ id: "asset-1", retryCount: 0 }]
    };

    await (worker as any).scheduleRetryOrReview(message, {
      available: false,
      score: 0,
      reasons: ["OCR unavailable"],
      categories: []
    });

    expect(prisma.mediaAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "uploaded", retryCount: 1, nextAttemptAt: expect.any(Date) })
    }));

    const db = {
      message: { update: jest.fn().mockResolvedValue({}) },
      mediaAsset: { updateMany: jest.fn().mockResolvedValue({}) }
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(db));
    await (worker as any).scheduleRetryOrReview({ ...message, attachments: [{ id: "asset-1", retryCount: 3 }] }, null);

    expect(db.message.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ moderationStatus: "pendingReview", visibility: "senderOnly" })
    }));
    expect(db.mediaAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed", retryCount: 4 })
    }));
    expect(cases.createFromResult).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({ matchedRules: ["media.providerUnavailable"] })
    }));
  });

  it("atomically claims a queued media message so concurrent workers cannot create duplicate cases", async () => {
    const message = {
      id: "message-concurrent",
      conversationId: "conversation-1",
      senderId: "user-1",
      content: "正常的图片消息",
      moderationStatus: "queued",
      conversation: {
        id: "conversation-1",
        externalId: "companion-1",
        userId: "user-1",
        companion: { ownerUserId: "companion-owner" }
      },
      attachments: [{ id: "image-1", kind: "image", retryCount: 0, nextAttemptAt: null }]
    };
    prisma.message.findUnique.mockResolvedValue(message);
    let claimed = false;
    prisma.message.updateMany.mockImplementation(({ data }: any) => {
      if (data.moderationProcessingToken) {
        if (claimed) return Promise.resolve({ count: 0 });
        claimed = true;
      }
      return Promise.resolve({ count: 1 });
    });
    analysisProvider.analyzeImage = jest.fn().mockResolvedValue({
      available: true,
      score: 0.05,
      reasons: ["内容正常"],
      categories: ["normal"]
    });
    moderation.moderateAsync.mockImplementation(async (text: string) => rules.moderate(text, "chat"));
    const db = {
      conversationBlock: { findFirst: jest.fn().mockResolvedValue(null) },
      message: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), create: jest.fn() },
      mediaAsset: { update: jest.fn().mockResolvedValue({}) },
      conversation: { update: jest.fn().mockResolvedValue({}) }
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(db));

    await Promise.all([worker.processMessage(message.id), worker.processMessage(message.id)]);

    expect(analysisProvider.analyzeImage).toHaveBeenCalledTimes(1);
    expect(db.message.updateMany).toHaveBeenCalledTimes(1);
    expect(cases.createFromResult).not.toHaveBeenCalled();
    expect(notifications.createConversationMessageReceivedIfUnmuted).toHaveBeenCalledWith(db, {
      conversationId: "conversation-1",
      messageId: "message-concurrent",
      recipientUserId: "companion-owner",
      recipientConversationId: "conversation-1"
    });
  });

  it("keeps an already-queued media message sender-only when either participant blocks before review finishes", async () => {
    const message = {
      id: "message-after-block",
      conversationId: "conversation-1",
      senderId: "user-1",
      content: "正常图片",
      moderationStatus: "queued",
      conversation: {
        id: "conversation-1",
        externalId: "companion-1",
        userId: "user-1",
        companion: { ownerUserId: "companion-owner" }
      },
      attachments: [{ id: "image-1", kind: "image", retryCount: 0, nextAttemptAt: null }]
    };
    prisma.message.findUnique.mockResolvedValue(message);
    prisma.message.updateMany.mockResolvedValue({ count: 1 });
    analysisProvider.analyzeImage = jest.fn().mockResolvedValue({
      available: true,
      score: 0.05,
      reasons: ["内容正常"],
      categories: ["normal"]
    });
    moderation.moderateAsync.mockImplementation(async (text: string) => rules.moderate(text, "chat"));
    const db = {
      conversationBlock: { findFirst: jest.fn().mockResolvedValue({ id: "block-1" }) },
      message: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), create: jest.fn() },
      mediaAsset: { update: jest.fn().mockResolvedValue({}) },
      conversation: { update: jest.fn().mockResolvedValue({}) }
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(db));

    await worker.processMessage(message.id);

    expect(db.message.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ moderationStatus: "blocked", visibility: "senderOnly" })
    }));
    expect(cases.createFromResult).not.toHaveBeenCalled();
    expect(notifications.createConversationMessageReceivedIfUnmuted).not.toHaveBeenCalled();
  });

  it("commits a blocked-message case and rolling restriction in the same transition transaction", async () => {
    const message = {
      id: "message-blocked",
      conversationId: "conversation-1",
      senderId: "user-1",
      content: "",
      moderationStatus: "queued",
      conversation: {
        id: "conversation-1",
        externalId: "companion-1",
        userId: "user-1",
        companion: { ownerUserId: "companion-owner" }
      },
      attachments: [{ id: "image-1", kind: "image", retryCount: 0, nextAttemptAt: null }]
    };
    prisma.message.findUnique.mockResolvedValue(message);
    prisma.message.updateMany.mockResolvedValue({ count: 1 });
    analysisProvider.analyzeImage = jest.fn().mockResolvedValue({
      available: true,
      score: 0.95,
      reasons: ["疑似私联二维码"],
      categories: ["privateContact"],
      extractedText: "加微信"
    });
    moderation.moderateAsync.mockResolvedValue({
      decision: "block",
      riskLevel: "high",
      priority: "high",
      score: 0.95,
      reasons: ["疑似私联二维码"],
      matchedRules: ["private.contact"],
      categories: ["privateContact"],
      policyVersion: "chat-v2",
      usedAI: true
    });
    cases.createFromResult.mockResolvedValue({ id: "case-blocked" });
    const db = {
      conversationBlock: { findFirst: jest.fn().mockResolvedValue(null) },
      message: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), create: jest.fn() },
      mediaAsset: { update: jest.fn().mockResolvedValue({}) },
      conversation: { update: jest.fn().mockResolvedValue({}) }
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(db));

    await worker.processMessage(message.id);

    expect(cases.createFromResult).toHaveBeenCalledWith(expect.objectContaining({ db }));
    expect(restrictions.recordAutomaticHighRiskBlock).toHaveBeenCalledWith(
      "user-1",
      "case-blocked",
      db
    );
    expect(notifications.createConversationMessageReceivedIfUnmuted).not.toHaveBeenCalled();
  });
});
