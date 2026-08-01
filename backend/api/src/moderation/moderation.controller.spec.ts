import { ModerationController } from "./moderation.controller";

describe("ModerationController reporter case access", () => {
  const prisma = {
    conversation: { findFirst: jest.fn() },
    message: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() }
  };
  const moderation = { moderateAsync: jest.fn() };
  const moderationCases = {
    listReporterCases: jest.fn(),
    getReporterCase: jest.fn(),
    addReporterFollowUp: jest.fn(),
    createReportCase: jest.fn()
  };
  const controller = new ModerationController(
    prisma as any,
    moderation as any,
    moderationCases as any
  );
  const user = { id: "reporter-1" } as any;

  beforeEach(() => jest.clearAllMocks());

  it("publishes the local-only user-content boundary", () => {
    expect(controller.status()).toEqual({
      module: "moderation",
      status: "active",
      aiConfigured: false,
      externalProvider: null,
      externalUserContentTransmission: false,
      sensitiveContentProcessing: "local-rules-and-human-review"
    });
  });

  it("lists only the authenticated reporter's cases", async () => {
    const expected = { items: [{ id: "case-1", outcome: "reviewing" }] };
    moderationCases.listReporterCases.mockResolvedValue(expected);

    await expect(controller.reports(user)).resolves.toBe(expected);
    expect(moderationCases.listReporterCases).toHaveBeenCalledWith(
      "reporter-1",
      expect.objectContaining({ page: 1, pageSize: 20 })
    );
  });

  it("uses the same authenticated reporter boundary for detail and follow-up", async () => {
    moderationCases.getReporterCase.mockResolvedValue({ id: "case-1" });
    moderationCases.addReporterFollowUp.mockResolvedValue({ id: "fact-1" });

    await expect(controller.reportDetail(user, "case-1")).resolves.toEqual({ id: "case-1" });
    await expect(controller.addReportFollowUp(user, "case-1", {
      statement: "补充一条仅审核人员可见的事实"
    })).resolves.toEqual({ id: "fact-1" });

    expect(moderationCases.getReporterCase).toHaveBeenCalledWith("reporter-1", "case-1");
    expect(moderationCases.addReporterFollowUp).toHaveBeenCalledWith(
      "reporter-1",
      "case-1",
      "补充一条仅审核人员可见的事实"
    );
  });

  it("anchors a long-session report window around the reported old message and ignores client context", async () => {
    const conversation = {
      id: "conversation-internal",
      externalId: "conversation-public",
      userId: "reporter-1",
      companion: { ownerUserId: "companion-owner" }
    };
    const reportedAt = new Date("2026-08-01T00:10:00.000Z");
    const reportedMessage = {
      id: "message-old-050",
      conversationId: conversation.id,
      senderId: "companion-owner",
      content: "这是一条很早以前但必须进入审核输入的被举报消息",
      createdAt: reportedAt
    };
    prisma.conversation.findFirst.mockResolvedValue(conversation);
    prisma.message.findFirst.mockResolvedValue(reportedMessage);
    prisma.message.findMany
      .mockResolvedValueOnce([
        { id: "message-049", content: "前一条", createdAt: new Date("2026-08-01T00:09:00.000Z") },
        { id: "message-048", content: "前二条", createdAt: new Date("2026-08-01T00:08:00.000Z") }
      ])
      .mockResolvedValueOnce([
        { id: "message-051", content: "后一条", createdAt: new Date("2026-08-01T00:11:00.000Z") },
        { id: "message-052", content: "后二条", createdAt: new Date("2026-08-01T00:12:00.000Z") }
      ]);
    moderation.moderateAsync.mockResolvedValue({
      decision: "review",
      score: 0.9,
      reason: "人工复核",
      matchedRules: [],
      usedAI: false,
      policyVersion: "2026.1",
      provider: "rules",
      providerVersion: "1"
    });
    moderationCases.createReportCase.mockImplementation(async (input: any) => ({
      id: "case-1",
      status: "humanReview",
      source: "report",
      ...input
    }));

    await controller.report(user, {
      conversationId: conversation.externalId,
      messageId: reportedMessage.id,
      reason: "举报旧消息",
      recentContext: "客户端伪造的最新上下文，不应进入审核输入"
    });

    const moderationInput = moderation.moderateAsync.mock.calls[0][0];
    expect(moderationInput).toContain("[被举报消息] 这是一条很早以前但必须进入审核输入的被举报消息");
    expect(moderationInput).toContain("前一条");
    expect(moderationInput).toContain("后一条");
    expect(moderationInput).not.toContain("客户端伪造的最新上下文");
    expect(moderationCases.createReportCase).toHaveBeenCalledWith(expect.objectContaining({
      content: moderationInput,
      messageId: reportedMessage.id,
      conversationId: conversation.id,
      subjectUserId: "companion-owner"
    }));
    expect(prisma.message.findMany).toHaveBeenCalledTimes(2);
    for (const [query] of prisma.message.findMany.mock.calls) {
      expect(query.where.conversationId).toBe(conversation.id);
      expect(query.where.AND[0]).toEqual({
        OR: [
          { moderationStatus: "published", visibility: "participants" },
          { senderId: "reporter-1" }
        ]
      });
    }
    expect(prisma.message.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 4
    }));
    expect(prisma.message.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 4
    }));
  });

  it("does not cross conversations when the requested message id is not in the resolved participant conversation", async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: "conversation-a",
      externalId: "public-a",
      userId: "reporter-1",
      companion: { ownerUserId: "companion-owner" }
    });
    prisma.message.findFirst.mockResolvedValue(null);

    await expect(controller.report(user, {
      conversationId: "public-a",
      messageId: "message-from-conversation-b",
      reason: "举报"
    })).rejects.toMatchObject({ code: "REPORTED_MESSAGE_NOT_FOUND", status: 404 });
    expect(prisma.message.findMany).not.toHaveBeenCalled();
    expect(moderation.moderateAsync).not.toHaveBeenCalled();
    expect(moderationCases.createReportCase).not.toHaveBeenCalled();
  });
});
