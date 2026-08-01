import { ModerationCaseService } from "./moderation-case.service";
import { ModerationResult } from "./moderation.service";

describe("ModerationCaseService", () => {
  const create = jest.fn();
  const prisma = {
    moderationCase: {
      create,
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn()
    },
    moderationEvidence: { create: jest.fn(), count: jest.fn() },
    moderationActionLog: { create: jest.fn() },
    $transaction: jest.fn()
  } as any;
  const audit = { record: jest.fn().mockResolvedValue({}) } as any;
  const notifications = { create: jest.fn().mockResolvedValue({}) } as any;
  const mediaAssets = { preserveEvidenceForMessage: jest.fn().mockResolvedValue({ count: 0 }) } as any;

  let service: ModerationCaseService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback: any) => callback(prisma));
    service = new ModerationCaseService(prisma, audit, notifications, mediaAssets);
  });

  it("uses the provided transaction client when creating a case", async () => {
    const txCreate = jest.fn().mockResolvedValue({ id: "case-tx" });
    const tx = { moderationCase: { create: txCreate } } as any;

    await service.createFromResult({
      result: {
        decision: "block",
        riskLevel: "high",
        priority: "high",
        score: 0.92,
        reasons: ["疑似引导私下联系"],
        matchedRules: ["contact.wechat"],
        categories: ["privateContact"],
        policyVersion: "chat-v2",
        usedAI: false
      },
      source: "chat",
      content: "我们加微信聊吧",
      db: tx
    });

    expect(txCreate).toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("skips case creation for allow", async () => {
    const result: ModerationResult = {
      decision: "allow",
      riskLevel: "low",
      priority: "normal",
      score: 0.05,
      reasons: ["内容正常"],
      matchedRules: [],
      categories: ["normal"],
      policyVersion: "chat-v2",
      usedAI: false
    };

    await expect(
      service.createFromResult({
        result,
        source: "chat",
        content: "今天有点累"
      })
    ).resolves.toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("creates case with evidence and action log for block", async () => {
    const result: ModerationResult = {
      decision: "block",
      riskLevel: "high",
      priority: "high",
      score: 0.92,
      reasons: ["疑似引导私下联系"],
      matchedRules: ["contact.wechat"],
      categories: ["privateContact"],
      policyVersion: "chat-v2",
      usedAI: false
    };
    const created = { id: "case-1", decision: "block", evidences: [], actionLogs: [] };
    create.mockResolvedValue(created);

    const output = await service.createFromResult({
      result,
      source: "chat",
      content: "我们加微信聊吧",
      targetId: "c1",
      actorId: "user-1"
    });

    expect(output).toBe(created);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          decision: "block",
          status: "humanReview",
          source: "chat",
          matchedRules: ["contact.wechat"],
          evidences: {
            create: expect.arrayContaining([
              expect.objectContaining({ type: "raw_text" }),
              expect.objectContaining({ type: "rule_match" })
            ])
          },
          actionLogs: {
            create: expect.objectContaining({
              actorId: "user-1",
              action: "created"
            })
          }
        }),
        include: { evidences: true, actionLogs: true }
      })
    );
  });

  it("marks review cases as pending", async () => {
    create.mockResolvedValue({ id: "case-2" });
    await service.createFromResult({
      result: {
        decision: "review",
        riskLevel: "low",
        priority: "normal",
        score: 0.42,
        reasons: ["疑似广告或引流"],
        matchedRules: ["ads.promo"],
        categories: ["fraudOrSpam"],
        policyVersion: "chat-v2",
        usedAI: true
      },
      source: "chat",
      content: "代理兼职赚钱"
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "pending",
          usedAI: true,
          evidences: {
            create: expect.arrayContaining([expect.objectContaining({ type: "ai_score" })])
          }
        })
      })
    );
  });

  it("routes critical safety signals directly to human review", async () => {
    create.mockResolvedValue({ id: "case-critical" });
    await service.createFromResult({
      result: {
        decision: "review",
        riskLevel: "low",
        priority: "critical",
        score: 0.5,
        reasons: ["检测到自伤风险，需要优先关怀"],
        matchedRules: ["selfharm.risk"],
        categories: ["selfHarm"],
        policyVersion: "chat-v2",
        usedAI: false
      },
      source: "chat",
      content: "我不想活了"
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "humanReview", priority: "critical" })
    }));
  });

  it("force-creates report cases even for allow decisions", async () => {
    const created = { id: "report-1", status: "pending", source: "report" };
    create.mockResolvedValue(created);

    const output = await service.createReportCase({
      result: {
        decision: "allow",
        riskLevel: "low",
        priority: "normal",
        score: 0.1,
        reasons: ["内容正常"],
        matchedRules: [],
        categories: ["normal"],
        policyVersion: "chat-v2",
        usedAI: false
      },
      reason: "对方索要联系方式",
      content: "对方索要联系方式 加我微信吧",
      targetId: "c1",
      actorId: "user-1"
    });

    expect(output).toBe(created);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: "report",
          title: "举报：对方索要联系方式",
          status: "pending"
        })
      })
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "create_report",
        resourceType: "moderation_case",
        resourceId: "report-1"
      }),
      prisma
    );
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it("uses a caller-owned transaction and redacted intake audit metadata for a report", async () => {
    const created = { id: "report-tx", status: "pending", source: "report" };
    const tx = { moderationCase: { create: jest.fn().mockResolvedValue(created) } } as any;

    await expect(service.createReportCase({
      result: {
        decision: "allow", riskLevel: "low", priority: "normal", score: 0.05,
        reasons: ["内容正常"], matchedRules: [], categories: ["normal"], policyVersion: "chat-v2", usedAI: false
      },
      reason: "疑似广告",
      content: "公开内容",
      targetId: "post-1",
      subjectUserId: "author-1",
      actorId: "reporter-1",
      auditMetadata: { source: "community_post_report", postId: "post-1" },
      db: tx
    })).resolves.toBe(created);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      resourceId: "report-tx",
      metadata: { source: "community_post_report", postId: "post-1" }
    }), tx);
  });

  it("adds later community-report evidence to an existing case without a notification or disposition", async () => {
    const tx = {
      moderationEvidence: { create: jest.fn().mockResolvedValue({ id: "evidence-2" }) },
      moderationActionLog: { create: jest.fn().mockResolvedValue({ id: "log-2" }) }
    } as any;
    const result: ModerationResult = {
      decision: "review", riskLevel: "low", priority: "normal", score: 0.42,
      reasons: ["疑似广告"], matchedRules: ["ads.promo"], categories: ["fraudOrSpam"], policyVersion: "chat-v2", usedAI: false
    };

    await service.appendCommunityReportToCase({
      caseId: "case-1",
      reportId: "receipt-2",
      postId: "post-1",
      reporterUserId: "reporter-2",
      subjectUserId: "post-author-1",
      reason: "疑似重复引流",
      result,
      db: tx
    });

    expect(tx.moderationEvidence.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        caseId: "case-1",
        type: "community_report_attachment",
        payload: expect.objectContaining({ reportId: "receipt-2", reason: "疑似重复引流" })
      })
    }));
    expect(tx.moderationActionLog.create).toHaveBeenCalledWith({
      data: {
        caseId: "case-1",
        actorId: "reporter-2",
        action: "community_report.attached",
        note: "An additional independent community report was attached."
      }
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "reporter-2",
      action: "community.report_attached",
      resourceId: "case-1",
      metadata: expect.objectContaining({ postId: "post-1", reportId: "receipt-2" })
    }), tx);
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it("returns bounded reporter-safe summaries without nesting follow-up evidence in the list", async () => {
    prisma.moderationCase.count.mockResolvedValue(1);
    prisma.moderationCase.findMany.mockResolvedValue([{
      id: "report-1",
      category: "用户举报",
      riskLevel: "high",
      priority: "high",
      status: "resolved",
      content: "举报原因：对方反复要求站外转账\n[会话上下文] 这段内容不能返回给举报回执",
      dueAt: new Date("2026-07-31T08:00:00.000Z"),
      resolvedAt: new Date("2026-07-31T07:00:00.000Z"),
      createdAt: new Date("2026-07-31T06:00:00.000Z"),
      actionLogs: [{ action: "confirmViolation", note: "internal-only" }],
      _count: { actionLogs: 1, evidences: 1 },
      evidences: [{
        id: "follow-up-1",
        type: "reporter_follow_up",
        payload: { statement: "补充说明：对方再次尝试站外联系。" },
        createdAt: new Date("2026-07-31T06:30:00.000Z")
      }],
      subjectUserId: "must-not-leak",
      aiReason: "must-not-leak"
    }]);

    await expect(service.listReporterCases("reporter-1")).resolves.toEqual({
      items: [expect.objectContaining({
        id: "report-1",
        outcome: "actionTaken",
        outcomeSummary: expect.stringContaining("采取相应处置"),
        submittedSummary: "对方反复要求站外转账",
        followUpCount: 1,
        actionHistoryWindow: {
          limit: 20,
          total: 1,
          hasMore: false,
          purpose: "outcomeSummaryOnly"
        }
      })],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 }
    });
    const result = await service.listReporterCases("reporter-1");
    expect(result.items[0]).not.toHaveProperty("subjectUserId");
    expect(result.items[0]).not.toHaveProperty("aiReason");
    expect(result.items[0]).not.toHaveProperty("actionLogs");
    expect(result.items[0]).not.toHaveProperty("followUps");
    expect(prisma.moderationCase.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        actionLogs: expect.objectContaining({ take: 1 }),
        _count: {
          select: {
            actionLogs: true,
            evidences: { where: { type: "reporter_follow_up" } }
          }
        }
      })
    }));
    expect(prisma.moderationCase.findMany.mock.calls.at(-1)?.[0]?.include).not.toHaveProperty("evidences");
  });

  it("returns reporter follow-up statements only from the owner-scoped detail endpoint", async () => {
    prisma.moderationCase.findFirst.mockResolvedValue({
      id: "report-1",
      category: "用户举报",
      riskLevel: "high",
      priority: "high",
      status: "humanReview",
      content: "举报原因：对方再次尝试站外联系\n[会话上下文] private context",
      dueAt: null,
      resolvedAt: null,
      createdAt: new Date("2026-07-31T06:00:00.000Z"),
      actionLogs: [],
      _count: { actionLogs: 0 },
      evidences: [{
        id: "follow-up-1",
        type: "reporter_follow_up",
        payload: { statement: "补充说明：对方再次尝试站外联系。" },
        createdAt: new Date("2026-07-31T06:30:00.000Z")
      }]
    });

    await expect(service.getReporterCase("reporter-1", "report-1")).resolves.toMatchObject({
      id: "report-1",
      submittedSummary: "对方再次尝试站外联系",
      followUpCount: 1,
      followUps: [{
        id: "follow-up-1",
        statement: "补充说明：对方再次尝试站外联系。",
        createdAt: "2026-07-31T06:30:00.000Z"
      }]
    });
    expect(prisma.moderationCase.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "report-1", source: "report", reporterUserId: "reporter-1" },
      include: expect.objectContaining({
        evidences: expect.objectContaining({ where: { type: "reporter_follow_up" } })
      })
    }));
  });

  it("adds a bounded private follow-up to an open report", async () => {
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      moderationCase: {
        findFirst: jest.fn().mockResolvedValue({ id: "report-1", status: "humanReview" })
      },
      moderationEvidence: {
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn().mockResolvedValue({
          id: "follow-up-2",
          createdAt: new Date("2026-07-31T07:30:00.000Z")
        })
      },
      moderationActionLog: { create: jest.fn().mockResolvedValue({}) }
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(db));

    await expect(service.addReporterFollowUp(
      "reporter-1",
      "report-1",
      "  对方随后又发来了站外联系方式。  "
    )).resolves.toEqual({
      id: "follow-up-2",
      statement: "对方随后又发来了站外联系方式。",
      createdAt: "2026-07-31T07:30:00.000Z"
    });
    expect(db.moderationEvidence.create).toHaveBeenCalledWith({
      data: {
        caseId: "report-1",
        type: "reporter_follow_up",
        payload: { statement: "对方随后又发来了站外联系方式。" }
      }
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "moderation.report_follow_up_added",
      resourceId: "report-1"
    }), db);
  });

  it("rejects whitespace-only reporter follow-up before opening a transaction", async () => {
    await expect(service.addReporterFollowUp("reporter-1", "report-1", "     "))
      .rejects.toMatchObject({ code: "REPORT_FOLLOW_UP_INVALID" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("allows one appeal after an auditor confirms a violation", async () => {
    const appealDeadlineAt = new Date("2099-08-18T00:00:00.000Z");
    prisma.moderationCase.findUnique.mockResolvedValue({
      id: "case-confirmed",
      subjectUserId: "user-1",
      decision: "warn",
      createdAt: new Date("2099-07-18T00:00:00.000Z"),
      resolvedAt: new Date("2099-07-19T00:00:00.000Z"),
      appealDeadlineAt,
      restrictions: [],
      actionLogs: [{ action: "confirmViolation", reviewerId: "reviewer-original" }]
    });
    const appeal = {
      id: "appeal-1",
      caseId: "case-confirmed",
      subjectUserId: "user-1",
      status: "pending",
      createdAt: new Date("2026-07-19T00:00:00.000Z")
    };
    const db = {
      moderationAppeal: { create: jest.fn().mockResolvedValue(appeal) },
      moderationCase: { update: jest.fn().mockResolvedValue({}) },
      moderationActionLog: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) }
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(db));

    const result = await service.createAppeal({
      caseId: "case-confirmed",
      subjectUserId: "user-1",
      reason: "审核结论与实际情况不符"
    });
    expect(result).toEqual({ ...appeal, appealDeadlineAt });
    expect(db.moderationAppeal.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        caseId: "case-confirmed",
        subjectUserId: "user-1",
        originalReviewerId: "reviewer-original",
        policyVersion: "2026.1",
        reviewDueAt: expect.any(Date)
      })
    }));
    expect(db.moderationCase.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "case-confirmed" },
      data: expect.objectContaining({
        status: "humanReview",
        assignedToUserId: null,
        appealDeadlineAt
      })
    }));
    expect(notifications.create).toHaveBeenCalledWith(
      "user-1",
      "moderationAlert",
      "内容申诉已进入独立复核",
      expect.any(String),
      expect.objectContaining({ status: "pending" }),
      db
    );
  });

  it("rejects an appeal after the published submission deadline", async () => {
    const appealDeadlineAt = new Date("2020-01-01T00:00:00.000Z");
    prisma.moderationCase.findUnique.mockResolvedValue({
      id: "case-expired",
      subjectUserId: "user-1",
      decision: "block",
      createdAt: new Date("2019-12-01T00:00:00.000Z"),
      resolvedAt: new Date("2019-12-02T00:00:00.000Z"),
      appealDeadlineAt,
      restrictions: [],
      actionLogs: []
    });

    await expect(service.createAppeal({
      caseId: "case-expired",
      subjectUserId: "user-1",
      reason: "希望重新核对"
    })).rejects.toMatchObject({
      code: "MODERATION_APPEAL_WINDOW_CLOSED",
      details: { appealDeadlineAt: appealDeadlineAt.toISOString() }
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("lists only unappealed cases whose public submission window remains open", async () => {
    prisma.moderationCase.findMany.mockResolvedValue([
      {
        id: "case-open",
        decision: "block",
        source: "chat",
        content: "这是一条被拦截的消息",
        createdAt: new Date("2099-07-01T00:00:00.000Z"),
        resolvedAt: new Date("2099-07-02T00:00:00.000Z"),
        appealDeadlineAt: new Date("2099-08-01T00:00:00.000Z"),
        appealPolicyVersion: "2026.1",
        appeals: [],
        restrictions: [],
        actionLogs: []
      }
    ]);
    prisma.moderationCase.count.mockResolvedValue(1);

    await expect(service.listAppealableCasesForUser("user-1")).resolves.toEqual({
      items: [expect.objectContaining({
        caseId: "case-open",
        kind: "contentAction",
        summary: "内容未送达或已被移除",
        appealDeadlineAt: "2099-08-01T00:00:00.000Z",
        policyVersion: "2026.1"
      })],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 }
    });
    expect(prisma.moderationCase.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        subjectUserId: "user-1",
        appeals: { none: {} },
        AND: expect.any(Array)
      }),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: 0,
      take: 20
    }));
  });
});
