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
    const activeOrder = {
      status: "paid",
      scheduledAt: new Date(Date.now() + 5 * 60_000),
      serviceStartedAt: null,
      durationMinutes: 30
    };
    const prisma = {
      conversation: { findFirst: jest.fn().mockResolvedValue({
        id: "conv-1",
        externalId: "c1",
        userId: "user-1",
        companion: { ownerUserId: "companion-owner", name: "陪伴者" }
      }) },
      companionProfile: { findFirst: jest.fn() },
      order: { findMany: jest.fn().mockResolvedValue([activeOrder]) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: "user-1", profile: { displayName: "用户", safetyScore: 80 } }) },
      message: { findMany: jest.fn().mockResolvedValue([]) },
      moderationCase: { count: jest.fn().mockResolvedValue(0) },
      conversationBlock: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([{ available: true }])
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
    const notifications = { createConversationMessageReceivedIfUnmuted: jest.fn() } as any;
    const audit = { record: jest.fn() } as any;
    const crisisIntervention = { recordCriticalChatSignal: jest.fn().mockResolvedValue(null) } as any;
    const create = jest.fn().mockImplementation(({ data }: any) => ({
      id: data.type === "safety" ? "safety-1" : "message-1",
      ...data
    }));
    const db = {
      conversationBlock: { findFirst: jest.fn().mockResolvedValue(null) },
      order: { findMany: jest.fn().mockResolvedValue([activeOrder]) },
      message: { create, update: jest.fn() },
      mediaAsset: { updateMany: jest.fn() },
      conversation: { update: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([{ available: true }])
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(db));
    const service = new ConversationsService(
      prisma,
      moderation,
      moderationCases,
      chatRestrictions,
      mediaAssets,
      mediaWorker,
      notifications,
      audit,
      crisisIntervention
    );
    return {
      service,
      prisma,
      moderation,
      moderationCases,
      chatRestrictions,
      notifications,
      crisisIntervention,
      db
    };
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
    const { service, notifications, db } = setup("warn");

    const result = await service.send("user-1", "c1", { content: "你真废物" });

    expect(db.message.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({ moderationStatus: "pendingReview", visibility: "senderOnly" })
    }));
    expect(result.message).toEqual(expect.objectContaining({ moderationStatus: "pendingReview", visibility: "senderOnly" }));
    expect(result.moderation).toEqual(expect.objectContaining({ deliveryStatus: "pendingReview", appealEligible: false }));
    expect(notifications.createConversationMessageReceivedIfUnmuted).not.toHaveBeenCalled();
  });

  it("queues a content-free reminder only for the other participant after a published message", async () => {
    const { service, notifications } = setup("allow");

    await service.send("user-1", "c1", { content: "今天还好吗" });

    expect(notifications.createConversationMessageReceivedIfUnmuted).toHaveBeenCalledWith(expect.any(Object), {
      conversationId: "conv-1",
      messageId: "message-1",
      recipientUserId: "companion-owner",
      recipientConversationId: "conv-1"
    });
  });

  it("rejects a blocked conversation before moderation or message persistence", async () => {
    const { service, prisma, moderation, db } = setup("allow");
    prisma.conversationBlock.findFirst.mockResolvedValue({ id: "block-1" });

    await expect(service.send("user-1", "c1", { content: "仍想继续说一句" }))
      .rejects.toMatchObject({ code: "CONVERSATION_INTERACTION_UNAVAILABLE" });

    expect(moderation.moderateAsync).not.toHaveBeenCalled();
    expect(db.message.create).not.toHaveBeenCalled();
  });

  it("rejects a completed order before moderation or message persistence, while history can remain readable", async () => {
    const { service, prisma, moderation, db } = setup("allow");
    prisma.$queryRaw.mockResolvedValue([{ available: false }]);

    await expect(service.send("user-1", "c1", { content: "服务结束后不应继续发送" }))
      .rejects.toMatchObject({ code: "CONVERSATION_INTERACTION_UNAVAILABLE" });

    expect(moderation.moderateAsync).not.toHaveBeenCalled();
    expect(db.message.create).not.toHaveBeenCalled();
  });

  it("rechecks the boundary inside the message transaction so a concurrent block cannot leak a send", async () => {
    const { service, prisma, db } = setup("allow");
    prisma.conversationBlock.findFirst.mockResolvedValueOnce(null);
    db.conversationBlock.findFirst.mockResolvedValue({ id: "block-after-precheck" });

    await expect(service.send("user-1", "c1", { content: "刚好与拉黑并发的消息" }))
      .rejects.toMatchObject({ code: "CONVERSATION_INTERACTION_UNAVAILABLE" });

    expect(db.message.create).not.toHaveBeenCalled();
  });

  it("rechecks the order communication window inside the message transaction", async () => {
    const { service, prisma, db } = setup("allow");
    prisma.$queryRaw.mockResolvedValueOnce([{ available: true }]);
    db.$queryRaw.mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ available: false }]);

    await expect(service.send("user-1", "c1", { content: "刚好与服务完成并发的消息" }))
      .rejects.toMatchObject({ code: "CONVERSATION_INTERACTION_UNAVAILABLE" });

    expect(db.message.create).not.toHaveBeenCalled();
  });

  it("records a critical self-harm signal for only the authenticated sender in the message transaction", async () => {
    const { service, moderation, crisisIntervention, db } = setup("review");
    moderation.moderateAsync.mockResolvedValue({
      ...moderationResult("review"),
      priority: "critical",
      categories: ["selfHarm"]
    });

    await service.send("user-1", "c1", { content: "需要安全复核的原始输入" });

    expect(crisisIntervention.recordCriticalChatSignal).toHaveBeenCalledWith(
      "user-1",
      { priority: "critical", categories: ["selfHarm"] },
      db
    );
    const serializedSignal = JSON.stringify(crisisIntervention.recordCriticalChatSignal.mock.calls[0]);
    expect(serializedSignal).not.toContain("需要安全复核的原始输入");
    expect(serializedSignal).not.toContain("message-1");
    expect(serializedSignal).not.toContain("companion-owner");
  });

  it("fails the message transaction closed when a critical crisis gate cannot be persisted", async () => {
    const { service, moderation, crisisIntervention, notifications, db } = setup("block");
    moderation.moderateAsync.mockResolvedValue({
      ...moderationResult("block"),
      priority: "critical",
      categories: ["violence"]
    });
    crisisIntervention.recordCriticalChatSignal.mockRejectedValue(new Error("crisis-write-failed"));

    await expect(service.send("user-1", "c1", { content: "critical input" }))
      .rejects.toThrow("crisis-write-failed");

    expect(crisisIntervention.recordCriticalChatSignal).toHaveBeenCalledWith(
      "user-1",
      { priority: "critical", categories: ["violence"] },
      db
    );
    expect(db.conversation.update).not.toHaveBeenCalled();
    expect(notifications.createConversationMessageReceivedIfUnmuted).not.toHaveBeenCalled();
  });
});
