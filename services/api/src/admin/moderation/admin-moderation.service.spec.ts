import { AdminModerationService } from "./admin-moderation.service";

describe("AdminModerationService", () => {
  const prisma = {
    moderationCase: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      update: jest.fn()
    },
    moderationLabel: {
      count: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn()
    },
    moderationActionLog: {
      create: jest.fn()
    },
    auditLog: {
      create: jest.fn()
    },
    conversation: {
      count: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn()
    },
    message: {
      findUnique: jest.fn(),
      findMany: jest.fn()
    },
    $transaction: jest.fn()
  };

  let service: AdminModerationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdminModerationService(prisma as any);
  });

  describe("statusForAction", () => {
    it("maps confirmViolation to resolved", () => {
      const result = service.statusForAction("confirmViolation");
      expect(result.status).toBe("resolved");
      expect(result.resolvedAt).toBeInstanceOf(Date);
    });

    it("maps dismiss to dismissed", () => {
      const result = service.statusForAction("dismiss");
      expect(result.status).toBe("dismissed");
      expect(result.resolvedAt).toBeInstanceOf(Date);
    });

    it("maps escalate to humanReview without resolvedAt", () => {
      const result = service.statusForAction("escalate");
      expect(result.status).toBe("humanReview");
      expect(result.resolvedAt).toBeNull();
    });
  });

  describe("buildCaseWhere", () => {
    it("builds filters for status risk source keyword and time", () => {
      const where = service.buildCaseWhere({
        status: "pending",
        riskLevel: "high",
        source: "chat",
        keyword: "微信",
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-12-31T23:59:59.000Z"
      });

      expect(where.status).toBe("pending");
      expect(where.riskLevel).toBe("high");
      expect(where.source).toBe("chat");
      expect(where.createdAt).toEqual({
        gte: new Date("2026-01-01T00:00:00.000Z"),
        lte: new Date("2026-12-31T23:59:59.000Z")
      });
      expect(where.OR).toEqual([
        { title: { contains: "微信", mode: "insensitive" } },
        { content: { contains: "微信", mode: "insensitive" } },
        { aiReason: { contains: "微信", mode: "insensitive" } }
      ]);
    });
  });

  describe("applyAction", () => {
    it("updates case and writes action + audit logs", async () => {
      const existing = {
        id: "case-1",
        status: "pending",
        title: "t",
        category: "实时风控",
        riskLevel: "high",
        source: "chat",
        content: "加我微信",
        targetId: "c1",
        messageId: null,
        aiScore: 0.9,
        aiReason: "私联",
        decision: "block",
        matchedRules: ["private.contact"],
        usedAI: false,
        resolvedAt: null,
        createdAt: new Date("2026-07-01T00:00:00.000Z")
      };

      prisma.moderationCase.findUnique.mockResolvedValue(existing);
      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          moderationCase: {
            update: jest.fn().mockResolvedValue({
              ...existing,
              status: "resolved",
              resolvedAt: new Date("2026-07-02T00:00:00.000Z"),
              actionLogs: []
            })
          },
          moderationActionLog: {
            create: jest.fn().mockResolvedValue({
              id: "log-1",
              caseId: "case-1",
              actorId: "mod-1",
              action: "confirmViolation",
              note: "确认",
              createdAt: new Date("2026-07-02T00:00:00.000Z")
            })
          },
          auditLog: {
            create: jest.fn().mockResolvedValue({ id: "audit-1" })
          }
        };
        return fn(tx);
      });

      prisma.moderationCase.findMany
        .mockResolvedValueOnce([{ ...existing, status: "resolved", decision: "block", riskLevel: "high", source: "chat" }])
        .mockResolvedValueOnce([]);
      prisma.conversation.count.mockResolvedValue(1);
      prisma.moderationLabel.count.mockResolvedValue(0);

      const result = await service.applyAction("case-1", "mod-1", "confirmViolation", "确认");

      expect(result.case.status).toBe("resolved");
      expect(result.action.action).toBe("confirmViolation");
      expect(result.overview.resolved).toBe(1);
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe("conversationEvidence", () => {
    it("returns empty messages when no conversation can be resolved", async () => {
      prisma.moderationCase.findUnique.mockResolvedValue({
        id: "case-1",
        messageId: null,
        targetId: null
      });

      const result = await service.conversationEvidence("case-1");
      expect(result.conversation).toBeNull();
      expect(result.messages).toEqual([]);
    });

    it("loads messages via messageId", async () => {
      prisma.moderationCase.findUnique.mockResolvedValue({
        id: "case-1",
        messageId: "msg-1",
        targetId: "c1"
      });
      prisma.message.findUnique.mockResolvedValue({
        id: "msg-1",
        conversation: {
          id: "conv-internal",
          externalId: "c1",
          companionId: "c1",
          userId: "u1",
          updatedAt: new Date("2026-07-01T00:00:00.000Z"),
          companion: { name: "林屿" }
        }
      });
      prisma.message.findMany.mockResolvedValue([
        {
          id: "msg-1",
          senderId: "u1",
          senderName: "用户",
          content: "hello",
          type: "text",
          createdAt: new Date("2026-07-01T00:00:00.000Z")
        }
      ]);

      const result = await service.conversationEvidence("case-1");
      expect(result.conversation?.id).toBe("c1");
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe("hello");
    });
  });
});
