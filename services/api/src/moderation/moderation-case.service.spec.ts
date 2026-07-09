import { ModerationCaseService } from "./moderation-case.service";
import { ModerationResult } from "./moderation.service";

describe("ModerationCaseService", () => {
  const create = jest.fn();
  const prisma = {
    moderationCase: { create }
  } as any;

  let service: ModerationCaseService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ModerationCaseService(prisma);
  });

  it("uses the provided transaction client when creating a case", async () => {
    const txCreate = jest.fn().mockResolvedValue({ id: "case-tx" });
    const tx = { moderationCase: { create: txCreate } } as any;

    await service.createFromResult({
      result: {
        decision: "block",
        riskLevel: "high",
        score: 0.92,
        reasons: ["疑似引导私下联系"],
        matchedRules: ["contact.wechat"],
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
      score: 0.05,
      reasons: ["内容正常"],
      matchedRules: [],
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
      score: 0.92,
      reasons: ["疑似引导私下联系"],
      matchedRules: ["contact.wechat"],
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
        score: 0.42,
        reasons: ["疑似广告或引流"],
        matchedRules: ["ads.promo"],
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
});
