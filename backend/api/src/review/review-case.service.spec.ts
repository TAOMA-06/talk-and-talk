import { ReviewCaseService, ReviewDecisionActor } from "./review-case.service";

describe("ReviewCaseService", () => {
  const prisma = {
    moderationCase: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
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
    reviewStaff: {
      findMany: jest.fn(),
      count: jest.fn()
    },
    $transaction: jest.fn()
  };
  const chatRestrictions = {
    createRestriction: jest.fn(),
    liftForCase: jest.fn(),
    recordManualConfirmedViolation: jest.fn()
  };
  const mediaAssets = {
    toAttachmentDto: jest.fn(async (asset: any) => asset)
  };
  const notifications = {
    create: jest.fn()
  };

  const reviewer: ReviewDecisionActor = { id: "mod-1", kind: "reviewStaff", displayName: "审核员一", role: "reviewer" };
  const secondReviewer: ReviewDecisionActor = { id: "mod-2", kind: "reviewStaff", displayName: "审核员二", role: "reviewer" };
  let service: ReviewCaseService;

  beforeEach(() => {
    jest.resetAllMocks();
    chatRestrictions.recordManualConfirmedViolation.mockResolvedValue({ escalated: false, confirmations: 1 });
    mediaAssets.toAttachmentDto.mockImplementation(async (asset: any) => asset);
    prisma.moderationCase.count.mockResolvedValue(0);
    prisma.moderationCase.findMany.mockResolvedValue([]);
    prisma.moderationCase.groupBy.mockResolvedValue([]);
    prisma.conversation.count.mockResolvedValue(0);
    prisma.moderationLabel.count.mockResolvedValue(0);
    prisma.moderationLabel.findMany.mockResolvedValue([]);
    prisma.reviewStaff.findMany.mockResolvedValue([]);
    prisma.reviewStaff.count.mockResolvedValue(0);
    service = new ReviewCaseService(
      prisma as any,
      chatRestrictions as any,
      mediaAssets as any,
      notifications as any
    );
  });

  describe("overview", () => {
    it("computes dashboard totals with database aggregates and reads only the bounded open queue", async () => {
      prisma.moderationCase.count.mockResolvedValue(42);
      prisma.conversation.count.mockResolvedValue(12);
      prisma.moderationLabel.count.mockResolvedValue(3);
      prisma.moderationCase.findMany.mockResolvedValue([]);
      prisma.moderationCase.groupBy
        .mockResolvedValueOnce([
          { status: "pending", _count: { _all: 7 } },
          { status: "resolved", _count: { _all: 30 } }
        ])
        .mockResolvedValueOnce([{ decision: "review", _count: { _all: 9 } }])
        .mockResolvedValueOnce([{ source: "chat", _count: { _all: 20 } }])
        .mockResolvedValueOnce([{ riskLevel: "high", _count: { _all: 2 } }]);

      const result = await service.overview();

      expect(result.overview).toEqual(expect.objectContaining({
        totalCases: 42,
        pendingCases: 7,
        resolved: 30,
        activeConversations: 12,
        labels: 3
      }));
      expect(result.overview.bySource.chat).toBe(20);
      expect(result.overview.byRisk).toEqual({ high: 2, medium: 0, low: 0 });
      expect(prisma.moderationCase.findMany).toHaveBeenCalledWith({
        where: { status: { in: ["pending", "autoReviewing", "humanReview"] } },
        orderBy: [
          { priority: "desc" },
          { dueAt: "asc" },
          { createdAt: "desc" },
          { id: "asc" }
        ],
        take: 8
      });
      expect(prisma.moderationCase.groupBy).toHaveBeenCalledTimes(4);
      expect(prisma.moderationCase.findMany).not.toHaveBeenCalledWith(expect.objectContaining({ where: undefined }));
    });
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

  describe("listCases", () => {
    it("uses a stable id tie-breaker for commercial pagination", async () => {
      prisma.moderationCase.count.mockResolvedValue(0);
      prisma.moderationCase.findMany.mockResolvedValue([]);

      await service.listCases({ page: 3, pageSize: 20 });

      expect(prisma.moderationCase.findMany).toHaveBeenCalledWith(expect.objectContaining({
        orderBy: [
          { priority: "desc" },
          { dueAt: "asc" },
          { createdAt: "asc" },
          { id: "asc" }
        ],
        skip: 40,
        take: 20
      }));
    });
  });

  describe("listActiveReviewers", () => {
    it("uses filtered stable pagination instead of a fixed first-page preload", async () => {
      prisma.reviewStaff.findMany.mockResolvedValue([{ id: "reviewer-2" }]);
      prisma.reviewStaff.count.mockResolvedValue(121);

      const result = await service.listActiveReviewers({
        status: "active",
        role: "reviewer",
        keyword: "王",
        page: 3,
        pageSize: 20
      });

      expect(prisma.reviewStaff.findMany).toHaveBeenCalledWith({
        where: {
          status: "active",
          role: "reviewer",
          OR: [
            { displayName: { contains: "王", mode: "insensitive" } },
            { username: { contains: "王", mode: "insensitive" } }
          ]
        },
        select: { id: true, displayName: true, username: true, role: true, status: true },
        orderBy: [
          { role: "desc" },
          { displayName: "asc" },
          { username: "asc" },
          { id: "asc" }
        ],
        skip: 40,
        take: 20
      });
      expect(prisma.reviewStaff.count).toHaveBeenCalledWith({
        where: {
          status: "active",
          role: "reviewer",
          OR: [
            { displayName: { contains: "王", mode: "insensitive" } },
            { username: { contains: "王", mode: "insensitive" } }
          ]
        }
      });
      expect(result.pagination).toEqual({
        page: 3,
        pageSize: 20,
        total: 121,
        totalPages: 7
      });
    });
  });

  describe("stable review evidence ordering", () => {
    it("orders case evidence, actions, appeals, and restrictions with id tie-breakers", async () => {
      prisma.moderationCase.findUnique.mockResolvedValue({
        id: "case-stable",
        title: "稳定证据",
        category: "举报",
        riskLevel: "medium",
        status: "pending",
        source: "report",
        content: "待核对",
        aiScore: 0.5,
        aiReason: "人工复核",
        decision: "review",
        usedAI: false,
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        evidences: [],
        actionLogs: [],
        appeals: [],
        restrictions: []
      });

      await service.getCase("case-stable");

      expect(prisma.moderationCase.findUnique).toHaveBeenCalledWith({
        where: { id: "case-stable" },
        include: {
          evidences: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
          actionLogs: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
          appeals: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
          restrictions: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] }
        }
      });
    });

    it("exports same-time labels in a deterministic bounded snapshot page", async () => {
      const createdAt = new Date("2026-08-01T00:00:00.000Z");
      const db = {
        moderationLabel: { findMany: jest.fn().mockResolvedValue([
          { id: "label-3", text: "c", expectedDecision: "allow", actualDecision: "allow", createdAt },
          { id: "label-2", text: "b", expectedDecision: "allow", actualDecision: "allow", createdAt },
          { id: "label-1", text: "a", expectedDecision: "allow", actualDecision: "allow", createdAt }
        ]) },
        reviewAuditLog: { create: jest.fn().mockResolvedValue({ id: "audit-export" }) }
      };
      prisma.$transaction.mockImplementation(async (callback: any) => callback(db));

      const exported = await service.exportLabels(reviewer, {
        limit: 2,
        snapshotAt: "2026-08-01T00:01:00.000Z"
      });

      expect(db.moderationLabel.findMany).toHaveBeenCalledWith({
        where: { createdAt: { lte: new Date("2026-08-01T00:01:00.000Z") } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 3
      });
      expect(exported).toMatchObject({ schemaVersion: 2, pageCount: 2, hasMore: true });
      expect(exported.samples.map((sample: any) => sample.id)).toEqual(["label-3", "label-2"]);
      expect(exported.nextCursor).toEqual(expect.any(String));
      expect(db.reviewAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "review.labels.exported",
          metadata: expect.objectContaining({ pageCount: 2, hasMore: true })
        })
      });

      db.moderationLabel.findMany.mockResolvedValue([]);
      await service.exportLabels(reviewer, {
        limit: 2,
        snapshotAt: exported.snapshotAt,
        cursor: exported.nextCursor!
      });
      expect(db.moderationLabel.findMany.mock.calls[1][0].where.OR).toEqual([
        { createdAt: { lt: createdAt } },
        { createdAt, id: { lt: "label-2" } }
      ]);
    });
  });

  describe("case ownership", () => {
    const openCase = {
      id: "case-owner",
      title: "待复核案件",
      category: "实时风控",
      riskLevel: "high",
      status: "humanReview",
      source: "chat",
      content: "待判断内容",
      targetId: "conversation-1",
      messageId: null,
      conversationId: "conversation-1",
      subjectUserId: "user-1",
      reporterUserId: null,
      assignedToUserId: null,
      priority: "high",
      dueAt: new Date("2026-08-01T00:00:00.000Z"),
      policyVersion: "policy-1",
      provider: "rules",
      providerVersion: "1",
      aiScore: 0.8,
      aiReason: "需要人工判断",
      decision: "review",
      matchedRules: [],
      usedAI: false,
      resolvedAt: null,
      createdAt: new Date("2026-07-31T00:00:00.000Z")
    };

    it("claims an unassigned open case and records review audit ownership", async () => {
      const db = {
        moderationCase: {
          findUnique: jest.fn().mockResolvedValue(openCase),
          update: jest.fn().mockResolvedValue({ ...openCase, assignedToUserId: reviewer.id })
        },
        reviewAuditLog: { create: jest.fn().mockResolvedValue({ id: "review-audit-1" }) }
      };
      prisma.$transaction.mockImplementation(async (callback: any) => callback(db));

      const result = await service.claimCase(openCase.id, reviewer);

      expect(result.case.assignedToUserId).toBe(reviewer.id);
      expect(db.moderationCase.update).toHaveBeenCalledWith({
        where: { id: openCase.id },
        data: { assignedToUserId: reviewer.id }
      });
      expect(db.reviewAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          reviewerId: reviewer.id,
          action: "review.case.claimed",
          resourceId: openCase.id
        })
      }));
    });

    it("rejects claiming a case already owned by another reviewer", async () => {
      const db = {
        moderationCase: {
          findUnique: jest.fn().mockResolvedValue({ ...openCase, assignedToUserId: secondReviewer.id }),
          update: jest.fn()
        },
        reviewAuditLog: { create: jest.fn() }
      };
      prisma.$transaction.mockImplementation(async (callback: any) => callback(db));

      await expect(service.claimCase(openCase.id, reviewer)).rejects.toMatchObject({
        code: "REVIEW_CASE_ALREADY_ASSIGNED"
      });
      expect(db.moderationCase.update).not.toHaveBeenCalled();
    });

    it("prevents the original reviewer from claiming their own appeal", async () => {
      const db = {
        moderationCase: {
          findUnique: jest.fn().mockResolvedValue({
            ...openCase,
            appeals: [{ status: "pending", originalReviewerId: reviewer.id }]
          }),
          update: jest.fn()
        },
        reviewAuditLog: { create: jest.fn() }
      };
      prisma.$transaction.mockImplementation(async (callback: any) => callback(db));

      await expect(service.claimCase(openCase.id, reviewer)).rejects.toMatchObject({
        code: "MODERATION_APPEAL_INDEPENDENT_REVIEW_REQUIRED"
      });
      expect(db.moderationCase.update).not.toHaveBeenCalled();
    });

    it("allows a lead to transfer an open case only to active review staff", async () => {
      const lead: ReviewDecisionActor = {
        id: "lead-1",
        kind: "reviewStaff",
        displayName: "审核负责人",
        role: "lead"
      };
      const db = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        moderationCase: {
          findUnique: jest.fn().mockResolvedValue({ ...openCase, assignedToUserId: reviewer.id }),
          update: jest.fn().mockResolvedValue({ ...openCase, assignedToUserId: secondReviewer.id })
        },
        reviewStaff: {
          findUnique: jest.fn().mockImplementation(async ({ where }: any) => ({
            id: where.id,
            status: "active"
          }))
        },
        reviewAuditLog: { create: jest.fn().mockResolvedValue({ id: "review-audit-2" }) }
      };
      prisma.$transaction.mockImplementation(async (callback: any) => callback(db));

      const result = await service.assignCase(openCase.id, lead, secondReviewer.id);

      expect(result.case.assignedToUserId).toBe(secondReviewer.id);
      expect(db.reviewStaff.findUnique).toHaveBeenCalledTimes(2);
      expect(db.reviewStaff.findUnique).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: lead.id }
      }));
      expect(db.reviewStaff.findUnique).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: secondReviewer.id }
      }));
      expect(db.reviewAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          reviewerId: lead.id,
          action: "review.case.assigned",
          resourceId: openCase.id
        })
      }));
    });

    it("fails closed before locking the case when a concurrent offboarding already suspended the claimant", async () => {
      const db = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        reviewStaff: {
          findUnique: jest.fn().mockResolvedValue({ id: reviewer.id, status: "suspended" })
        },
        moderationCase: {
          findUnique: jest.fn(),
          update: jest.fn()
        },
        reviewAuditLog: { create: jest.fn() }
      };
      prisma.$transaction.mockImplementation(async (callback: any) => callback(db));

      await expect(service.claimCase(openCase.id, reviewer)).rejects.toMatchObject({
        code: "REVIEW_STAFF_INACTIVE"
      });
      expect(db.$queryRaw).toHaveBeenCalledTimes(1);
      expect(db.moderationCase.findUnique).not.toHaveBeenCalled();
      expect(db.moderationCase.update).not.toHaveBeenCalled();
    });
  });

  describe("applyAction", () => {
    it("does not commit a decision after the reviewer has been suspended", async () => {
      const opened = {
        id: "case-suspended", status: "pending", source: "community", targetId: "post-suspended",
        messageId: null, subjectUserId: null, appeals: []
      };
      prisma.moderationCase.findUnique.mockResolvedValue(opened);
      const db = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        reviewStaff: {
          findUnique: jest.fn().mockResolvedValue({ id: reviewer.id, status: "suspended" })
        },
        moderationCase: {
          findUnique: jest.fn(),
          update: jest.fn()
        }
      };
      prisma.$transaction.mockImplementation(async (callback: any) => callback(db));

      await expect(service.applyAction(opened.id, reviewer, "dismiss", "不处置"))
        .rejects.toMatchObject({ code: "REVIEW_STAFF_INACTIVE" });
      expect(db.moderationCase.findUnique).not.toHaveBeenCalled();
      expect(db.moderationCase.update).not.toHaveBeenCalled();
    });

    it("rejects a stale moderator decision after re-reading the locked case", async () => {
      const opened = {
        id: "case-race", status: "pending", source: "community", targetId: "post-race",
        messageId: null, subjectUserId: null, appeals: []
      };
      prisma.moderationCase.findUnique.mockResolvedValue(opened);
      const db = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        moderationCase: {
          findUnique: jest.fn().mockResolvedValue({ ...opened, status: "dismissed" }),
          update: jest.fn()
        }
      };
      prisma.$transaction.mockImplementation(async (callback: any) => callback(db));

      await expect(service.applyAction("case-race", secondReviewer, "rejectMessage", "拒绝"))
        .rejects.toMatchObject({ code: "CASE_ALREADY_CLOSED" });
      expect(db.moderationCase.update).not.toHaveBeenCalled();
    });

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
        messageId: "message-1",
        aiScore: 0.9,
        aiReason: "私联",
        decision: "block",
        matchedRules: ["private.contact"],
        usedAI: false,
        resolvedAt: null,
        createdAt: new Date("2026-07-01T00:00:00.000Z")
      };

      prisma.moderationCase.findUnique.mockResolvedValue(existing);
      const updateCase = jest.fn().mockResolvedValue({
        ...existing,
        status: "resolved",
        resolvedAt: new Date("2026-07-02T00:00:00.000Z"),
        actionLogs: []
      });
      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          moderationCase: {
            update: updateCase
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
          },
          message: {
            findUnique: jest.fn().mockResolvedValue({ id: "message-1", conversationId: "c1" }),
            update: jest.fn().mockResolvedValue({ id: "message-1" })
          }
        };
        return fn(tx);
      });

      prisma.moderationCase.findMany.mockResolvedValue([]);
      prisma.moderationCase.groupBy
        .mockResolvedValueOnce([{ status: "resolved", _count: { _all: 1 } }])
        .mockResolvedValueOnce([{ decision: "block", _count: { _all: 1 } }])
        .mockResolvedValueOnce([{ source: "chat", _count: { _all: 1 } }])
        .mockResolvedValueOnce([{ riskLevel: "high", _count: { _all: 1 } }]);
      prisma.conversation.count.mockResolvedValue(1);
      prisma.moderationLabel.count.mockResolvedValue(0);

      const result = await service.applyAction("case-1", reviewer, "confirmViolation", "确认");

      expect(result.case.status).toBe("resolved");
      expect(result.action.action).toBe("confirmViolation");
      expect(result.overview.resolved).toBe(1);
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(updateCase).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          appealDeadlineAt: expect.any(Date),
          appealPolicyVersion: "2026.1"
        })
      }));
    });

    it("marks a manually confirmed delivered message as removed", async () => {
      const existing = {
        id: "case-remove",
        status: "humanReview",
        title: "t",
        category: "实时风控",
        riskLevel: "high",
        source: "chat",
        content: "违规内容",
        targetId: "c1",
        messageId: "message-remove",
        aiScore: 0.9,
        aiReason: "高风险",
        decision: "review",
        matchedRules: [],
        usedAI: true,
        resolvedAt: null,
        createdAt: new Date("2026-07-01T00:00:00.000Z")
      };
      prisma.moderationCase.findUnique.mockResolvedValue(existing);
      const db = {
        moderationCase: { update: jest.fn().mockResolvedValue({ ...existing, status: "resolved", actionLogs: [] }) },
        moderationActionLog: { create: jest.fn().mockResolvedValue({ id: "log-remove", action: "confirmViolation", createdAt: new Date() }) },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
        message: {
          findUnique: jest.fn().mockResolvedValue({ id: "message-remove", conversationId: "c1" }),
          update: jest.fn().mockResolvedValue({})
        }
      };
      prisma.$transaction.mockImplementation(async (callback: any) => callback(db));
      prisma.moderationCase.findMany.mockResolvedValueOnce([{ ...existing, status: "resolved" }]).mockResolvedValueOnce([]);
      prisma.conversation.count.mockResolvedValue(1);
      prisma.moderationLabel.count.mockResolvedValue(0);

      await service.applyAction("case-remove", reviewer, "confirmViolation", "确认违规");

      expect(db.message.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ moderationStatus: "removed", visibility: "senderOnly" })
      }));
    });

    it("fails closed before any adverse mutation when the reported message cannot be re-read", async () => {
      const existing = {
        id: "case-missing-evidence",
        status: "humanReview",
        source: "chat",
        targetId: "conversation-1",
        conversationId: "conversation-1",
        messageId: "deleted-message",
        assignedToUserId: reviewer.id,
        appeals: []
      };
      prisma.moderationCase.findUnique.mockResolvedValue(existing);
      const db = {
        moderationCase: {
          findUnique: jest.fn().mockResolvedValue(existing),
          update: jest.fn()
        },
        message: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
        moderationActionLog: { create: jest.fn() },
        auditLog: { create: jest.fn() }
      };
      prisma.$transaction.mockImplementation(async (callback: any) => callback(db));

      await expect(service.applyAction(
        existing.id,
        reviewer,
        "confirmViolation",
        "确认违规"
      )).rejects.toMatchObject({
        code: "REVIEW_MESSAGE_EVIDENCE_UNAVAILABLE",
        status: 409,
        details: { messageId: "deleted-message" }
      });
      expect(db.moderationCase.update).not.toHaveBeenCalled();
      expect(db.message.update).not.toHaveBeenCalled();
      expect(db.moderationActionLog.create).not.toHaveBeenCalled();
      expect(db.auditLog.create).not.toHaveBeenCalled();
    });

    it.each([
      "confirmViolation",
      "rejectMessage",
      "restrict24h",
      "restrict7d"
    ] as const)("notifies the subject of the 30-day appeal window for %s inside the decision transaction", async (action) => {
      jest.useFakeTimers().setSystemTime(new Date("2026-08-01T08:00:00.000Z"));
      const existing = {
        id: `case-adverse-${action}`,
        status: "humanReview",
        title: "人工内容复核",
        category: "实时风控",
        riskLevel: "high",
        source: "chat",
        content: "待人工判断内容",
        targetId: "conversation-1",
        messageId: null,
        reporterUserId: null,
        subjectUserId: "subject-appeal-window",
        assignedToUserId: reviewer.id,
        aiScore: 0.9,
        aiReason: "需要人工判断",
        decision: "review",
        matchedRules: [],
        usedAI: true,
        resolvedAt: null,
        createdAt: new Date("2026-08-01T07:00:00.000Z"),
        appeals: []
      };
      prisma.moderationCase.findUnique.mockResolvedValue(existing);
      const db = {
        moderationCase: {
          update: jest.fn().mockResolvedValue({
            ...existing,
            status: "resolved",
            resolvedAt: new Date("2026-08-01T08:00:00.000Z"),
            appealDeadlineAt: new Date("2026-08-31T08:00:00.000Z"),
            appealPolicyVersion: "2026.1",
            actionLogs: []
          })
        },
        moderationActionLog: {
          create: jest.fn().mockResolvedValue({
            id: `log-adverse-${action}`,
            action,
            createdAt: new Date("2026-08-01T08:00:00.000Z")
          })
        },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
        reviewAuditLog: { create: jest.fn().mockResolvedValue({}) }
      };
      let transactionActive = false;
      prisma.$transaction.mockImplementation(async (callback: any) => {
        transactionActive = true;
        try {
          return await callback(db);
        } finally {
          transactionActive = false;
        }
      });
      notifications.create.mockImplementation(async () => {
        expect(transactionActive).toBe(true);
        return { id: `notification-adverse-${action}` };
      });
      prisma.moderationCase.findMany.mockResolvedValueOnce([{ ...existing, status: "resolved" }]).mockResolvedValueOnce([]);
      prisma.conversation.count.mockResolvedValue(1);
      prisma.moderationLabel.count.mockResolvedValue(0);

      await service.applyAction(existing.id, reviewer, action, "人工复核确认并告知申诉渠道");

      expect(notifications.create).toHaveBeenCalledWith(
        "subject-appeal-window",
        "moderationAlert",
        expect.stringContaining("30日内申诉"),
        expect.stringMatching(/30日内.*安全中心/),
        {
          caseId: existing.id,
          appealDeadlineAt: "2026-08-31T08:00:00.000Z",
          policyVersion: "2026.1",
          action
        },
        db
      );
    });

    it("notifies the reporter with a privacy-safe outcome in the decision transaction", async () => {
      const existing = {
        id: "case-report",
        status: "humanReview",
        title: "举报",
        category: "用户举报",
        riskLevel: "high",
        source: "report",
        content: "私密举报内容",
        targetId: "conversation-1",
        messageId: null,
        reporterUserId: "reporter-1",
        subjectUserId: "subject-1",
        assignedToUserId: "mod-1",
        aiScore: 0.9,
        aiReason: "internal reason",
        decision: "review",
        matchedRules: ["internal.rule"],
        usedAI: true,
        resolvedAt: null,
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        appeals: []
      };
      prisma.moderationCase.findUnique.mockResolvedValue(existing);
      const db = {
        moderationCase: {
          update: jest.fn().mockResolvedValue({
            ...existing,
            status: "resolved",
            resolvedAt: new Date(),
            actionLogs: []
          })
        },
        moderationActionLog: {
          create: jest.fn().mockResolvedValue({
            id: "log-report",
            action: "confirmViolation",
            createdAt: new Date()
          })
        },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
        reviewAuditLog: { create: jest.fn().mockResolvedValue({}) },
        notification: { create: jest.fn().mockResolvedValue({ id: "notification-1" }) }
      };
      prisma.$transaction.mockImplementation(async (callback: any) => callback(db));
      notifications.create.mockResolvedValue({ id: "notification-1" });
      prisma.moderationCase.findMany
        .mockResolvedValueOnce([{ ...existing, status: "resolved" }])
        .mockResolvedValueOnce([]);
      prisma.conversation.count.mockResolvedValue(1);
      prisma.moderationLabel.count.mockResolvedValue(0);

      await service.applyAction("case-report", reviewer, "confirmViolation", "确认违规");

      const reporterNotification = notifications.create.mock.calls.find(
        (call) => call[0] === "reporter-1"
      );
      expect(reporterNotification).toEqual([
        "reporter-1",
        "moderationAlert",
        "举报处理结果已更新",
        expect.stringContaining("保护双方隐私"),
        {
          reportId: "case-report",
          status: "resolved",
          outcome: "actionTaken"
        },
        db
      ]);
      const serializedNotification = JSON.stringify(reporterNotification);
      expect(serializedNotification).not.toContain("subject-1");
      expect(serializedNotification).not.toContain("internal.rule");
      expect(serializedNotification).not.toContain("internal reason");
    });

    it("publishes a pending community post only after a moderator dismisses its review case", async () => {
      const existing = {
        id: "case-community",
        status: "pending",
        title: "社区内容待审核",
        category: "社区内容",
        riskLevel: "low",
        priority: "normal",
        source: "community",
        content: "正常内容",
        targetId: "post-1",
        messageId: null,
        aiScore: 0.4,
        aiReason: "待人工确认",
        decision: "review",
        matchedRules: [],
        usedAI: false,
        resolvedAt: null,
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        appeals: []
      };
      prisma.moderationCase.findUnique.mockResolvedValue(existing);
      const db = {
        moderationCase: { update: jest.fn().mockResolvedValue({ ...existing, status: "dismissed", actionLogs: [] }) },
        moderationActionLog: { create: jest.fn().mockResolvedValue({ id: "log-community", action: "dismiss", createdAt: new Date() }) },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
        communityPost: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) }
      };
      prisma.$transaction.mockImplementation(async (callback: any) => callback(db));
      prisma.moderationCase.findMany.mockResolvedValueOnce([{ ...existing, status: "dismissed" }]).mockResolvedValueOnce([]);
      prisma.conversation.count.mockResolvedValue(1);
      prisma.moderationLabel.count.mockResolvedValue(0);

      await service.applyAction("case-community", reviewer, "dismiss", "人工确认可发布");

      expect(db.communityPost.updateMany).toHaveBeenCalledWith({
        where: { id: "post-1" },
        data: { status: "approved" }
      });
    });

    it("overturns an appeal by releasing the held message and lifting linked chat restrictions", async () => {
      const existing = {
        id: "case-appeal",
        status: "resolved",
        title: "t",
        category: "实时风控",
        riskLevel: "high",
        source: "chat",
        content: "加我微信",
        targetId: "c1",
        messageId: "message-1",
        subjectUserId: "user-1",
        aiScore: 0.9,
        aiReason: "私联",
        decision: "block",
        matchedRules: ["private.contact"],
        usedAI: false,
        resolvedAt: new Date("2026-07-01T00:00:00.000Z"),
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        appeals: [{ id: "appeal-1", status: "pending", originalReviewerId: "mod-original" }]
      };
      prisma.moderationCase.findUnique.mockResolvedValue(existing);
      const db = {
        moderationCase: { update: jest.fn().mockResolvedValue({ ...existing, status: "dismissed", actionLogs: [] }) },
        moderationActionLog: { create: jest.fn().mockResolvedValue({ id: "log-appeal", action: "overturnAppeal", createdAt: new Date() }) },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
        message: { update: jest.fn().mockResolvedValue({}) },
        moderationAppeal: { update: jest.fn().mockResolvedValue({}) }
      };
      prisma.$transaction.mockImplementation(async (callback: any) => callback(db));
      prisma.moderationCase.findMany.mockResolvedValueOnce([{ ...existing, status: "dismissed" }]).mockResolvedValueOnce([]);
      prisma.conversation.count.mockResolvedValue(1);
      prisma.moderationLabel.count.mockResolvedValue(0);

      await service.applyAction("case-appeal", reviewer, "overturnAppeal", "复核成立");

      expect(db.message.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ moderationStatus: "published", visibility: "participants" })
      }));
      expect(db.moderationAppeal.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: "overturned", reviewerId: "mod-1" })
      }));
      expect(chatRestrictions.liftForCase).toHaveBeenCalledWith("case-appeal", "mod-1", "复核成立", db);
      expect(notifications.create).toHaveBeenCalledWith(
        "user-1",
        "moderationAlert",
        "内容申诉复核已撤销原处置",
        expect.any(String),
        expect.objectContaining({ status: "overturned" }),
        db
      );
    });

    it("prevents the original reviewer from resolving their own appeal", async () => {
      const existing = {
        id: "case-own-appeal",
        status: "humanReview",
        assignedToUserId: null,
        appeals: [{ id: "appeal-own", status: "pending", originalReviewerId: reviewer.id }]
      };
      prisma.moderationCase.findUnique.mockResolvedValue(existing);

      await expect(service.applyAction(
        existing.id,
        reviewer,
        "upholdAppeal",
        "维持处置"
      )).rejects.toMatchObject({
        code: "MODERATION_APPEAL_INDEPENDENT_REVIEW_REQUIRED"
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("conversationEvidence", () => {
    const conversation = {
      id: "conv-internal",
      externalId: "c1",
      companionId: "companion-1",
      userId: "u1",
      updatedAt: new Date("2026-07-01T00:10:00.000Z"),
      companion: { name: "林屿" }
    };
    const message = (id: string, second: number, content = id) => ({
      id,
      conversationId: conversation.id,
      senderId: second % 2 ? "u1" : "companion-owner",
      senderName: second % 2 ? "用户" : "林屿",
      content,
      type: "text",
      moderationStatus: "published",
      visibility: "participants",
      attachments: [],
      createdAt: new Date(`2026-07-01T00:00:${String(second).padStart(2, "0")}.000Z`)
    });

    it("returns an explicit empty page when no conversation can be resolved", async () => {
      prisma.moderationCase.findUnique.mockResolvedValue({
        id: "case-1",
        messageId: null,
        conversationId: null,
        targetId: null
      });

      const result = await service.conversationEvidence("case-1");

      expect(result.conversation).toBeNull();
      expect(result.messages).toEqual([]);
      expect(result.pagination).toEqual({
        pageSize: 50,
        beforeCursor: null,
        afterCursor: null,
        hasMoreBefore: false,
        hasMoreAfter: false
      });
    });

    it("resolves duplicate external conversation records with an id-stable latest order", async () => {
      prisma.moderationCase.findUnique.mockResolvedValue({
        id: "case-external",
        messageId: null,
        conversationId: null,
        targetId: "c1"
      });
      prisma.conversation.findFirst.mockResolvedValue(conversation);
      prisma.message.findMany.mockResolvedValue([]);

      await service.conversationEvidence("case-external", { pageSize: 20 });

      expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
        where: { externalId: "c1" },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        include: { companion: true }
      });
    });

    it("keeps the reported message as an independently verified anchor in the middle of a long session", async () => {
      const anchor = { ...message("msg-50", 50, "reported"), conversation };
      prisma.moderationCase.findUnique.mockResolvedValue({
        id: "case-1",
        messageId: anchor.id,
        conversationId: conversation.id,
        targetId: "c1"
      });
      prisma.message.findUnique.mockResolvedValue(anchor);
      prisma.message.findMany
        .mockResolvedValueOnce([message("msg-49", 49), message("msg-48", 48), message("msg-47", 47)])
        .mockResolvedValueOnce([message("msg-51", 51), message("msg-52", 52), message("msg-53", 53)]);

      const result = await service.conversationEvidence("case-1", { pageSize: 5 });

      expect(result.conversation?.id).toBe("c1");
      expect(result.anchorMessageId).toBe("msg-50");
      expect(result.anchorMessage).toEqual(expect.objectContaining({ id: "msg-50", content: "reported" }));
      expect(result.anchorInPage).toBe(true);
      expect(result.messages.map((item: any) => item.id)).toEqual([
        "msg-48", "msg-49", "msg-50", "msg-51", "msg-52"
      ]);
      expect(result.pagination).toEqual({
        pageSize: 5,
        beforeCursor: "msg-48",
        afterCursor: "msg-52",
        hasMoreBefore: true,
        hasMoreAfter: true
      });
    });

    it("pages toward the start of a long session with stable createdAt and id cursors", async () => {
      const anchor = { ...message("msg-50", 50), conversation };
      const cursor = message("msg-48", 48);
      prisma.moderationCase.findUnique.mockResolvedValue({
        id: "case-1",
        messageId: anchor.id,
        conversationId: conversation.id,
        targetId: "c1"
      });
      prisma.message.findUnique
        .mockResolvedValueOnce(anchor)
        .mockResolvedValueOnce({ id: cursor.id, conversationId: conversation.id, createdAt: cursor.createdAt });
      prisma.message.findMany.mockResolvedValue([
        message("msg-47", 47),
        message("msg-46", 46),
        message("msg-45", 45),
        message("msg-44", 44),
        message("msg-43", 43),
        message("msg-42", 42)
      ]);

      const result = await service.conversationEvidence("case-1", { before: cursor.id, pageSize: 5 });

      expect(result.anchorMessage?.id).toBe("msg-50");
      expect(result.anchorInPage).toBe(false);
      expect(result.messages.map((item: any) => item.id)).toEqual([
        "msg-43", "msg-44", "msg-45", "msg-46", "msg-47"
      ]);
      expect(result.pagination).toEqual(expect.objectContaining({
        beforeCursor: "msg-43",
        afterCursor: "msg-47",
        hasMoreBefore: true,
        hasMoreAfter: true
      }));
      expect(prisma.message.findMany).toHaveBeenCalledWith(expect.objectContaining({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 6
      }));
    });

    it("reaches the end of a long session without inventing another page", async () => {
      const anchor = { ...message("msg-50", 50), conversation };
      const cursor = message("msg-58", 58);
      prisma.moderationCase.findUnique.mockResolvedValue({
        id: "case-1",
        messageId: anchor.id,
        conversationId: conversation.id,
        targetId: "c1"
      });
      prisma.message.findUnique
        .mockResolvedValueOnce(anchor)
        .mockResolvedValueOnce({ id: cursor.id, conversationId: conversation.id, createdAt: cursor.createdAt });
      prisma.message.findMany.mockResolvedValue([message("msg-59", 59)]);

      const result = await service.conversationEvidence("case-1", { after: cursor.id, pageSize: 5 });

      expect(result.messages.map((item: any) => item.id)).toEqual(["msg-59"]);
      expect(result.pagination).toEqual(expect.objectContaining({
        beforeCursor: "msg-59",
        afterCursor: null,
        hasMoreBefore: true,
        hasMoreAfter: false
      }));
    });

    it("fails closed when the reported message disappeared", async () => {
      prisma.moderationCase.findUnique.mockResolvedValue({
        id: "case-1",
        messageId: "missing-message",
        conversationId: conversation.id,
        targetId: "c1"
      });
      prisma.message.findUnique.mockResolvedValue(null);

      await expect(service.conversationEvidence("case-1")).rejects.toMatchObject({
        code: "REVIEW_MESSAGE_EVIDENCE_UNAVAILABLE",
        status: 409
      });
      expect(prisma.message.findMany).not.toHaveBeenCalled();
    });

    it("fails closed when the reported message belongs to a different conversation", async () => {
      const anchor = {
        ...message("wrong-message", 50),
        conversationId: "different-conversation",
        conversation: { ...conversation, id: "different-conversation", externalId: "different" }
      };
      prisma.moderationCase.findUnique.mockResolvedValue({
        id: "case-1",
        messageId: anchor.id,
        conversationId: conversation.id,
        targetId: "c1"
      });
      prisma.message.findUnique.mockResolvedValue(anchor);

      await expect(service.conversationEvidence("case-1")).rejects.toMatchObject({
        code: "REVIEW_MESSAGE_EVIDENCE_UNAVAILABLE",
        status: 409
      });
      expect(prisma.message.findMany).not.toHaveBeenCalled();
    });

    it("rejects a cursor from another conversation", async () => {
      const anchor = { ...message("msg-50", 50), conversation };
      prisma.moderationCase.findUnique.mockResolvedValue({
        id: "case-1",
        messageId: anchor.id,
        conversationId: conversation.id,
        targetId: "c1"
      });
      prisma.message.findUnique
        .mockResolvedValueOnce(anchor)
        .mockResolvedValueOnce({
          id: "foreign-cursor",
          conversationId: "foreign-conversation",
          createdAt: new Date()
        });

      await expect(service.conversationEvidence("case-1", { before: "foreign-cursor" }))
        .rejects.toMatchObject({ code: "REVIEW_EVIDENCE_CURSOR_INVALID", status: 400 });
      expect(prisma.message.findMany).not.toHaveBeenCalled();
    });
  });
});
