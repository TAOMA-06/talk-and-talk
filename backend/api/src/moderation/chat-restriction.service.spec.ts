import { ChatRestrictionService } from "./chat-restriction.service";

describe("ChatRestrictionService", () => {
  const prisma = {
    chatRestriction: {
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn()
    },
    moderationCase: { count: jest.fn() },
    moderationActionLog: { count: jest.fn() },
    $transaction: jest.fn()
  } as any;
  const audit = { record: jest.fn().mockResolvedValue({}) } as any;
  const notifications = { create: jest.fn().mockResolvedValue({}) } as any;
  let service: ChatRestrictionService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.chatRestriction.findFirst.mockResolvedValue(null);
    service = new ChatRestrictionService(prisma, audit, notifications);
  });

  it("creates a 24-hour chat-only restriction after two high-risk blocks in the rolling window", async () => {
    prisma.moderationCase.count.mockResolvedValue(2);
    prisma.chatRestriction.create.mockResolvedValue({ id: "restriction-1" });

    const result = await service.recordAutomaticHighRiskBlock("user-1", "case-2");

    expect(result).toEqual({ id: "restriction-1" });
    expect(prisma.chatRestriction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: "user-1", caseId: "case-2", source: "automatic" })
    }));
    expect(notifications.create).toHaveBeenCalledWith(
      "user-1",
      "moderationAlert",
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ caseId: "case-2" })
    );
  });

  it("does not create a restriction before the second high-risk block", async () => {
    prisma.moderationCase.count.mockResolvedValue(1);

    await expect(service.recordAutomaticHighRiskBlock("user-1", "case-1")).resolves.toBeNull();
    expect(prisma.chatRestriction.create).not.toHaveBeenCalled();
  });

  it("escalates the third manual confirmation to a critical human-disposition task without auto-banning", async () => {
    prisma.moderationActionLog.count.mockResolvedValue(3);
    const db = {
      moderationCase: { update: jest.fn().mockResolvedValue({}) },
      moderationActionLog: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) }
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(db));

    const result = await service.recordManualConfirmedViolation("user-1", "case-3", "moderator-1");

    expect(result).toEqual({ escalated: true, confirmations: 3 });
    expect(db.moderationCase.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "humanReview", priority: "critical", resolvedAt: null }
    }));
    expect(db.moderationActionLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "manual_escalation_required" })
    }));
    expect(notifications.create).not.toHaveBeenCalled();
  });
});
