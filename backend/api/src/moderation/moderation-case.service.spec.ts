import { ModerationCaseService } from "./moderation-case.service";
import { ModerationResult } from "./moderation.service";

describe("ModerationCaseService", () => {
  const create = jest.fn();
  const prisma = {
    moderationCase: { create, findUnique: jest.fn() },
    moderationEvidence: { create: jest.fn() },
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

  it("allows one appeal after an auditor confirms a violation", async () => {
    prisma.moderationCase.findUnique.mockResolvedValue({
      id: "case-confirmed",
      subjectUserId: "user-1",
      decision: "warn",
      restrictions: [],
      actionLogs: [{ action: "confirmViolation" }]
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
      moderationActionLog: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) }
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(db));

    await expect(service.createAppeal({
      caseId: "case-confirmed",
      subjectUserId: "user-1",
      reason: "审核结论与实际情况不符"
    })).resolves.toEqual(appeal);
    expect(db.moderationAppeal.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ caseId: "case-confirmed", subjectUserId: "user-1" })
    }));
  });
});
