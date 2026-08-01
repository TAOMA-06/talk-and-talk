import { createHash, createHmac } from "node:crypto";

import { CompanionLifecycleService } from "./companion-lifecycle.service";

describe("CompanionLifecycleService", () => {
  const prisma = {
    companionProfile: { findUnique: jest.fn() },
    companionTrainingRecord: { findMany: jest.fn() },
    companionAccountAction: { findFirst: jest.fn(), count: jest.fn() },
    companionAccountAppeal: { create: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    companionIncidentReport: { create: jest.fn(), findMany: jest.fn(), findUniqueOrThrow: jest.fn(), count: jest.fn() },
    companionWithdrawalRequest: { findMany: jest.fn() },
    order: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    review: { aggregate: jest.fn() },
    supportTicket: { count: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn()
  } as any;
  const audit = { record: jest.fn().mockResolvedValue({}) } as any;
  const commercial = { upsertCommercialProfile: jest.fn() } as any;
  const notifications = { createTransactional: jest.fn().mockResolvedValue({}) } as any;
  const caseEvidence = {
    attachmentInclude: jest.fn().mockReturnValue({ evidenceAttachments: { include: { mediaAsset: true } } }),
    attachmentDtos: jest.fn().mockReturnValue([]),
    bindCompanionIncident: jest.fn().mockResolvedValue([])
  } as any;
  let configValues: Record<string, unknown>;
  const config = {
    get: jest.fn((key: string) => configValues[key])
  } as any;
  let service: CompanionLifecycleService;

  const companion = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "林屿",
    role: "生活陪伴者",
    bio: "公开介绍",
    languages: ["普通话"],
    specialties: ["职场"],
    cityDistrict: "上海",
    livedExperience: null,
    serviceBoundaries: ["不提供医疗诊断"],
    ownerUserId: "owner-1",
    rating: 0,
    reviewCount: 0,
    isPublished: false,
    voiceIntroAssetRef: null,
    voiceIntroDurationSeconds: null,
    voiceIntroStatus: "notSubmitted"
  };

  beforeEach(() => {
    jest.clearAllMocks();
    configValues = {
      COMPANION_VOICE_EVIDENCE_VIEWER_URL: "",
      COMPANION_VOICE_EVIDENCE_SIGNING_SECRET: "",
      COMPANION_VOICE_EVIDENCE_URL_TTL_SECONDS: 300
    };
    config.get.mockImplementation((key: string) => configValues[key]);
    prisma.companionProfile.findUnique.mockResolvedValue(companion);
    prisma.order.findMany.mockResolvedValue([]);
    prisma.order.count.mockResolvedValue(0);
    prisma.supportTicket.count.mockResolvedValue(0);
    prisma.companionAccountAction.count.mockResolvedValue(0);
    prisma.companionIncidentReport.count.mockResolvedValue(0);
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    service = new CompanionLifecycleService(prisma, audit, commercial, config, notifications, caseEvidence);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("never returns answer keys in the companion training catalog", async () => {
    prisma.companionTrainingRecord.findMany.mockResolvedValue([]);

    const result = await service.training("owner-1");

    expect(result.complete).toBe(false);
    expect(result.modules).toHaveLength(3);
    expect(result.modules[0].questions[0]).not.toHaveProperty("answer");
  });

  it("derives workbench restriction and incident totals from full authoritative sets", async () => {
    prisma.companionAccountAction.count.mockResolvedValue(3);
    prisma.companionIncidentReport.count.mockResolvedValue(7);

    const result = await (service as any).operationalSummaryForCompanion(companion.id);

    expect(result).toEqual({ activeRestrictionCount: 3, openIncidentCount: 7 });
    expect(prisma.companionAccountAction.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        companionId: companion.id,
        kind: { in: ["serviceRestriction", "suspension"] },
        revokedAt: null
      })
    });
    expect(prisma.companionIncidentReport.count).toHaveBeenCalledWith({
      where: { companionId: companion.id, status: { in: ["open", "inReview"] } }
    });
  });

  it("uses a deterministic capped order sample and discloses population truncation", async () => {
    const createdAt = new Date("2026-07-31T08:00:00.000Z");
    prisma.order.findMany.mockResolvedValue([
      {
        status: "completed",
        createdAt,
        scheduledAt: createdAt,
        companionConfirmedAt: createdAt,
        companionResponseDeadlineAt: createdAt,
        serviceStartedAt: createdAt,
        completedAt: createdAt,
        refunds: []
      }
    ]);
    prisma.order.count.mockResolvedValue(501);

    const result = await service.quality("owner-1");

    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 500
    }));
    expect(result).toEqual(expect.objectContaining({
      orderSampleSize: 1,
      orderSampleLimit: 500,
      orderPopulationSize: 501,
      orderSampleTruncated: true
    }));
    expect(result.limitations[0]).toContain("最近 1/501 笔");
  });

  it("reads the database-owned rating projection without scanning Review", async () => {
    prisma.companionProfile.findUnique.mockResolvedValue({
      ...companion,
      rating: 4.75,
      reviewCount: 12
    });

    const result = await service.quality("owner-1");

    expect(result.rating).toEqual({ value: 4.75, sampleSize: 12 });
    expect(prisma.companionProfile.findUnique).toHaveBeenCalledWith({
      where: { id: companion.id },
      select: { rating: true, reviewCount: true }
    });
    expect(prisma.review.aggregate).not.toHaveBeenCalled();
  });

  it("scores training on the server and records only derived result metadata", async () => {
    const record = {
      id: "record-1",
      moduleCode: "service-boundaries",
      moduleVersion: "2026.1",
      status: "passed",
      attemptCount: 1,
      bestScore: 100,
      lastAttemptedAt: new Date(),
      passedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000)
    };
    const db = {
      $queryRaw: jest.fn(),
      companionTrainingRecord: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue(record)
      }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    const result = await service.submitTrainingAttempt("owner-1", {
      moduleCode: "service-boundaries",
      moduleVersion: "2026.1",
      answers: ["B", "C", "A"]
    });

    expect(result).toEqual(expect.objectContaining({ score: 100, passed: true }));
    expect(db.companionTrainingRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ status: "passed", bestScore: 100 })
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "commercial.companion_training_attempted",
      metadata: expect.not.objectContaining({ answers: expect.anything() })
    }), db);
  });

  it("fails closed when a training attempt omits an answer", async () => {
    await expect(service.submitTrainingAttempt("owner-1", {
      moduleCode: "service-boundaries",
      moduleVersion: "2026.1",
      answers: ["B", "C"]
    })).rejects.toMatchObject({ code: "TRAINING_ANSWERS_INCOMPLETE" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("snapshots the appeal deadline when an account action is created", async () => {
    const now = new Date("2026-07-31T08:00:00.000Z");
    jest.spyOn(Date, "now").mockReturnValue(now.getTime());
    configValues.COMPANION_APPEAL_SUBMISSION_DAYS = 30;
    const db = {
      $queryRaw: jest.fn(),
      companionProfile: {
        findUnique: jest.fn().mockResolvedValue({
          ...companion,
          availability: "available",
          isOnline: true
        })
      },
      companionAccountAction: {
        create: jest.fn().mockImplementation(({ data }: any) => ({
          id: "action-1",
          companionId: companion.id,
          kind: data.kind,
          reasonCode: data.reasonCode,
          message: data.message,
          startsAt: now,
          endsAt: data.endsAt,
          appealDeadlineAt: data.appealDeadlineAt,
          revokedAt: null,
          createdAt: now
        }))
      },
      companionCommercialProfile: { updateMany: jest.fn() }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    const result = await service.createAccountAction("supply-1", {
      companionId: companion.id,
      kind: "warning",
      reasonCode: "late_service",
      message: "请核对最近一次履约并在期限内申诉"
    });

    expect(result.appealDeadlineAt).toBe("2026-08-30T08:00:00.000Z");
    expect(result.appealWindowOpen).toBe(true);
    expect(db.companionAccountAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        appealDeadlineAt: new Date("2026-08-30T08:00:00.000Z")
      })
    });
    expect(notifications.createTransactional).toHaveBeenCalledWith(db, expect.objectContaining({
      userId: "owner-1",
      type: "safetyAlert",
      data: expect.objectContaining({
        route: "companionDevelopment",
        actionId: "action-1",
        actionKind: "warning"
      }),
      eventKey: "companion-account-action:action-1:created:owner-1",
      templateKey: "supportUpdate"
    }));
  });

  it("snapshots the appeal review SLA and rejects a closed submission window", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-31T08:00:00.000Z"));
    configValues.COMPANION_APPEAL_RESPONSE_HOURS = 48;
    prisma.companionAccountAction.findFirst.mockResolvedValue({
      id: "action-1",
      companionId: companion.id,
      revokedAt: null,
      appealDeadlineAt: new Date("2026-08-05T08:00:00.000Z")
    });
    prisma.companionAccountAppeal.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: "appeal-1",
        ...data,
        status: "pending",
        resolution: null,
        resolvedAt: null,
        createdAt: new Date("2026-07-31T08:00:00.000Z")
      })
    );

    const result = await service.appeal("owner-1", "action-1", {
      statement: "本次处置所依据的履约时间与订单记录不一致，请重新核验",
      evidenceReferences: []
    });

    expect(result.reviewDueAt).toBe("2026-08-02T08:00:00.000Z");
    expect(result.overdue).toBe(false);
    expect(prisma.companionAccountAppeal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reviewDueAt: new Date("2026-08-02T08:00:00.000Z")
      })
    });
    expect(notifications.createTransactional).toHaveBeenCalledWith(prisma, expect.objectContaining({
      userId: "owner-1",
      type: "supportUpdate",
      data: expect.objectContaining({
        route: "companionDevelopment",
        actionId: "action-1",
        appealId: "appeal-1"
      }),
      eventKey: "companion-account-appeal:appeal-1:submitted:owner-1",
      templateKey: "supportUpdate"
    }));

    prisma.companionAccountAction.findFirst.mockResolvedValue({
      id: "action-2",
      companionId: companion.id,
      revokedAt: null,
      appealDeadlineAt: new Date("2026-07-31T07:59:59.000Z")
    });
    await expect(service.appeal("owner-1", "action-2", {
      statement: "请求重新核验这项处置",
      evidenceReferences: []
    })).rejects.toMatchObject({ code: "COMPANION_ACTION_APPEAL_WINDOW_CLOSED" });
  });

  it("blocks the original account-action creator from resolving the appeal", async () => {
    const db = {
      $queryRaw: jest.fn(),
      companionAccountAppeal: {
        findUnique: jest.fn().mockResolvedValue({
          id: "appeal-independent-1",
          actionId: "action-independent-1",
          companionId: companion.id,
          status: "pending",
          action: { createdById: "supply-original" }
        }),
        update: jest.fn()
      },
      companionAccountAction: { update: jest.fn() }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    await expect(service.resolveAppeal("supply-original", "appeal-independent-1", {
      status: "upheld",
      resolution: "复核后确认原处置依据充分并予以维持。"
    })).rejects.toMatchObject({
      code: "COMPANION_APPEAL_INDEPENDENT_REVIEW_REQUIRED"
    });
    expect(db.companionAccountAppeal.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("allows a different operator to resolve an appeal and audits the separation", async () => {
    const now = new Date("2026-08-01T08:00:00.000Z");
    const existing = {
      id: "appeal-independent-2",
      actionId: "action-independent-2",
      companionId: companion.id,
      statement: "原处置遗漏了已经提交的履约证据，请重新核验。",
      evidenceReferences: ["evidence/appeals/001"],
      status: "pending",
      reviewDueAt: new Date("2026-08-03T08:00:00.000Z"),
      resolution: null,
      resolvedAt: null,
      createdAt: new Date("2026-07-31T08:00:00.000Z"),
      action: { createdById: "supply-original" },
      companion: { ownerUserId: "owner-1" }
    };
    const updated = {
      ...existing,
      status: "upheld",
      resolution: "独立核验后确认原处置依据充分并予以维持。",
      resolvedAt: now,
      resolvedById: "supply-independent"
    };
    const db = {
      $queryRaw: jest.fn(),
      companionAccountAppeal: {
        findUnique: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockResolvedValue(updated)
      },
      companionAccountAction: { update: jest.fn() }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    const result = await service.resolveAppeal("supply-independent", existing.id, {
      status: "upheld",
      resolution: "独立核验后确认原处置依据充分并予以维持。"
    });

    expect(result).toEqual(expect.objectContaining({
      status: "upheld",
      resolution: "独立核验后确认原处置依据充分并予以维持。"
    }));
    expect(db.companionAccountAppeal.update).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "supply-independent",
      action: "commercial.companion_action_appeal_resolved",
      metadata: expect.objectContaining({
        originalActionCreatedById: "supply-original",
        independentReview: true
      })
    }), db);
    expect(notifications.createTransactional).toHaveBeenCalledWith(db, expect.objectContaining({
      userId: "owner-1",
      type: "supportUpdate",
      title: "陪伴者申诉已有结果",
      data: {
        route: "companionDevelopment",
        actionId: "action-independent-2",
        appealId: "appeal-independent-2",
        appealStatus: "upheld"
      },
      eventKey: "companion-account-appeal:appeal-independent-2:resolved:upheld:owner-1",
      templateKey: "supportUpdate"
    }));
  });

  it.each([
    ["upheld", "陪伴者申诉已有结果"],
    ["overturned", "陪伴者申诉已撤销原处置"],
    ["dismissed", "陪伴者申诉已有结果"]
  ] as const)("creates an idempotent transactional notification for a %s appeal result", async (status, title) => {
    const existing = {
      id: `appeal-result-${status}`,
      actionId: `action-result-${status}`,
      companionId: companion.id,
      statement: "请求依据完整履约记录独立复核本次陪伴者账号处置。",
      evidenceReferences: [],
      status: "pending",
      reviewDueAt: new Date("2026-08-04T08:00:00.000Z"),
      resolution: null,
      resolvedAt: null,
      createdAt: new Date("2026-08-01T08:00:00.000Z"),
      action: { createdById: "supply-original" },
      companion: { ownerUserId: "owner-1" }
    };
    const db = {
      $queryRaw: jest.fn(),
      companionAccountAppeal: {
        findUnique: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockImplementation(({ data }: any) => ({ ...existing, ...data }))
      },
      companionAccountAction: { update: jest.fn() }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    await service.resolveAppeal("supply-independent", existing.id, {
      status,
      resolution: "独立复核已完成，现将事实依据和最终处理结果正式告知。"
    });

    expect(notifications.createTransactional).toHaveBeenCalledWith(db, expect.objectContaining({
      userId: "owner-1",
      type: "supportUpdate",
      title,
      data: expect.objectContaining({
        route: "companionDevelopment",
        actionId: existing.actionId,
        appealId: existing.id,
        appealStatus: status
      }),
      eventKey: `companion-account-appeal:${existing.id}:resolved:${status}:owner-1`,
      templateKey: "supportUpdate"
    }));
    expect(db.companionAccountAction.update).toHaveBeenCalledTimes(status === "overturned" ? 1 : 0);
  });

  it("serializes concurrent appeal decisions so only one is audited", async () => {
    const base = {
      id: "appeal-concurrent",
      actionId: "action-concurrent",
      companionId: companion.id,
      statement: "请求依据现有履约证据重新独立核验此次账号处置。",
      evidenceReferences: [],
      status: "pending",
      reviewDueAt: new Date("2026-08-03T08:00:00.000Z"),
      resolution: null,
      resolvedAt: null,
      createdAt: new Date("2026-08-01T07:00:00.000Z"),
      action: { createdById: "supply-original" },
      companion: { ownerUserId: "owner-1" }
    } as any;
    let stored = base;
    let lock = Promise.resolve();
    const db = {
      $queryRaw: jest.fn(),
      companionAccountAppeal: {
        findUnique: jest.fn().mockImplementation(async () => stored),
        update: jest.fn().mockImplementation(async ({ data }: any) => {
          stored = { ...stored, ...data };
          return stored;
        })
      },
      companionAccountAction: { update: jest.fn() }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => {
      const previous = lock;
      let release!: () => void;
      lock = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        return await fn(db);
      } finally {
        release();
      }
    });

    const results = await Promise.allSettled([
      service.resolveAppeal("supply-independent-1", base.id, {
        status: "upheld",
        resolution: "独立核验确认现有账号处置依据充分并予以维持。"
      }),
      service.resolveAppeal("supply-independent-2", base.id, {
        status: "overturned",
        resolution: "独立核验确认现有账号处置证据不足并予以撤销。"
      })
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "COMPANION_APPEAL_ALREADY_RESOLVED" });
    expect(db.companionAccountAppeal.update).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(notifications.createTransactional).toHaveBeenCalledTimes(1);
  });

  it("marks appeals created by the current operator as ineligible in the admin queue", async () => {
    const action = {
      id: "action-admin-list",
      companionId: companion.id,
      kind: "warning",
      reasonCode: "late_service",
      message: "请核对最近一次履约记录并在期限内提交申诉。",
      startsAt: new Date("2026-08-01T08:00:00.000Z"),
      endsAt: null,
      appealDeadlineAt: new Date("2026-08-31T08:00:00.000Z"),
      revokedAt: null,
      createdAt: new Date("2026-08-01T08:00:00.000Z"),
      createdById: "supply-original"
    };
    prisma.companionAccountAppeal.findMany.mockResolvedValue([{
      id: "appeal-admin-list",
      actionId: action.id,
      companionId: companion.id,
      statement: "请求独立复核该账号处置所依据的履约记录。",
      evidenceReferences: [],
      status: "pending",
      reviewDueAt: new Date("2026-08-04T08:00:00.000Z"),
      resolution: null,
      resolvedAt: null,
      createdAt: new Date("2026-08-01T09:00:00.000Z"),
      action,
      companion
    }]);
    prisma.companionAccountAppeal.count.mockResolvedValue(51);

    const ownQueue = await service.adminAppeals("supply-original", "pending", 2, 25);
    const independentQueue = await service.adminAppeals("supply-independent", "pending", 2, 25);

    expect(ownQueue.items[0].independentReviewEligible).toBe(false);
    expect(independentQueue.items[0].independentReviewEligible).toBe(true);
    expect(ownQueue.pagination).toEqual({
      total: 51,
      totalPages: 3,
      page: 2,
      pageSize: 25
    });
    expect(prisma.companionAccountAppeal.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: "pending" },
      orderBy: [{ reviewDueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      skip: 25,
      take: 25
    }));
    expect(prisma.companionAccountAppeal.count).toHaveBeenCalledWith({
      where: { status: "pending" }
    });
  });

  it("creates a withdrawal request only from verified, available, owner earnings", async () => {
    const earningIds = [
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333"
    ];
    const createdAt = new Date();
    const db = {
      $queryRaw: jest.fn(),
      companionCommercialProfile: {
        findUnique: jest.fn().mockResolvedValue({
          status: "verified",
          adultEligibilityVerdict: "adult",
          adultEligibilityValidUntil: new Date(Date.now() + 24 * 60 * 60_000),
          settlementRecipientMasked: "微信账户 **1234"
        })
      },
      companionWithdrawalRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: "request-1",
          companionId: companion.id,
          earningIds,
          amountCents: 9000,
          settlementRecipientMasked: "微信账户 **1234",
          status: "requested",
          reviewedAt: null,
          processedAt: null,
          payoutReferenceMasked: null,
          rejectionReason: null,
          createdAt,
          updatedAt: createdAt
        })
      },
      companionEarning: {
        findMany: jest.fn().mockResolvedValue([
          { id: earningIds[0], payableCents: 4000 },
          { id: earningIds[1], payableCents: 5000 }
        ])
      }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    const result = await service.requestWithdrawal("owner-1", { earningIds });

    expect(result).toEqual(expect.objectContaining({
      amountCents: 9000,
      status: "requested",
      settlementRecipientMasked: "微信账户 **1234"
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "commercial.companion_withdrawal_requested"
    }), db);
  });

  it("does not accept evidence for an order owned by another companion", async () => {
    prisma.order.findFirst.mockResolvedValue(null);

    await expect(service.createIncident("owner-1", {
      orderId: "44444444-4444-4444-8444-444444444444",
      category: "technicalIssue",
      summary: "通话开始后持续无声音，重连仍未恢复",
      evidenceAssetIds: ["55555555-5555-4555-8555-555555555555"]
    })).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
    expect(prisma.companionIncidentReport.create).not.toHaveBeenCalled();
  });

  it("does not mark a withdrawal paid until every earning is independently paid", async () => {
    const now = new Date();
    const db = {
      $queryRaw: jest.fn(),
      companionWithdrawalRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: "request-1",
          companionId: companion.id,
          earningIds: [
            "22222222-2222-4222-8222-222222222222",
            "33333333-3333-4333-8333-333333333333"
          ],
          amountCents: 9000,
          status: "processing",
          reviewedAt: now,
          reviewedById: "admin-1",
          processedAt: null,
          payoutReferenceMasked: null,
          rejectionReason: null,
          createdAt: now,
          updatedAt: now
        }),
        update: jest.fn()
      },
      companionEarning: { count: jest.fn().mockResolvedValue(1) }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    await expect(service.updateWithdrawal("admin-2", "request-1", {
      status: "paid",
      payoutReferenceMasked: "WX***0001"
    })).rejects.toMatchObject({ code: "WITHDRAWAL_EARNINGS_NOT_PAID" });
    expect(db.companionWithdrawalRequest.update).not.toHaveBeenCalled();
  });

  it("issues an audited, short-lived HMAC URL without user profile data", async () => {
    const assetReference = "evidence/voice/intro-2026-07-31.aac";
    const actorId = "admin-1";
    const expiresAtUnix = 1_800_000_300;
    const signingSecret = "controlled-viewer-secret";
    prisma.companionProfile.findUnique.mockResolvedValue({
      ...companion,
      voiceIntroAssetRef: assetReference,
      voiceIntroDurationSeconds: 21,
      voiceIntroStatus: "pendingReview"
    });
    configValues = {
      COMPANION_VOICE_EVIDENCE_VIEWER_URL: "https://evidence.example.com/listen",
      COMPANION_VOICE_EVIDENCE_SIGNING_SECRET: signingSecret,
      COMPANION_VOICE_EVIDENCE_URL_TTL_SECONDS: 300
    };
    jest.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);

    const result = await service.createVoiceIntroReadUrl(actorId, companion.id);

    const url = new URL(result.url);
    const expectedSignature = createHmac("sha256", signingSecret)
      .update([companion.id, assetReference, actorId, String(expiresAtUnix)].join("\n"))
      .digest("hex");
    expect(url.origin).toBe("https://evidence.example.com");
    expect(url.searchParams.get("companionId")).toBe(companion.id);
    expect(url.searchParams.get("assetReference")).toBe(assetReference);
    expect(url.searchParams.has("actorId")).toBe(false);
    expect(url.searchParams.get("exp")).toBe(String(expiresAtUnix));
    expect(url.searchParams.get("signature")).toBe(expectedSignature);
    expect(url.searchParams.has("ownerUserId")).toBe(false);
    expect(url.searchParams.has("companionName")).toBe(false);
    expect(result).toEqual({
      url: url.toString(),
      expiresAt: new Date(expiresAtUnix * 1_000).toISOString(),
      assetReferenceHash: createHash("sha256").update(assetReference).digest("hex")
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId,
      action: "commercial.companion_voice_intro_read_issued",
      resourceId: companion.id,
      metadata: expect.objectContaining({
        assetReferenceHash: result.assetReferenceHash,
        expiresAt: result.expiresAt
      })
    }));
    expect(audit.record.mock.calls.at(-1)?.[0]?.metadata).not.toHaveProperty("assetReference");
  });

  it("fails closed when the controlled voice evidence viewer is unavailable", async () => {
    prisma.companionProfile.findUnique.mockResolvedValue({
      ...companion,
      voiceIntroAssetRef: "evidence/voice/current.aac",
      voiceIntroDurationSeconds: 18,
      voiceIntroStatus: "pendingReview"
    });

    const readError = await service.createVoiceIntroReadUrl("admin-1", companion.id).catch((error) => error);
    expect(readError).toMatchObject({ code: "VOICE_INTRO_EVIDENCE_VIEWER_UNAVAILABLE" });
    expect(readError.getStatus()).toBe(503);
    const approvalError = await service.reviewVoiceIntro("admin-1", companion.id, {
      status: "approved",
      reviewedAssetReference: "evidence/voice/current.aac"
    }).catch((error) => error);
    expect(approvalError).toMatchObject({ code: "VOICE_INTRO_EVIDENCE_VIEWER_UNAVAILABLE" });
    expect(approvalError.getStatus()).toBe(503);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a stale voice-intro approval even when the evidence viewer is configured", async () => {
    configValues = {
      COMPANION_VOICE_EVIDENCE_VIEWER_URL: "https://evidence.example.com/listen",
      COMPANION_VOICE_EVIDENCE_SIGNING_SECRET: "controlled-viewer-secret",
      COMPANION_VOICE_EVIDENCE_URL_TTL_SECONDS: 300
    };
    const db = {
      $queryRaw: jest.fn(),
      companionProfile: {
        findUnique: jest.fn().mockResolvedValue({
          ...companion,
          voiceIntroAssetRef: "evidence/voice/current.aac",
          voiceIntroDurationSeconds: 18,
          voiceIntroStatus: "pendingReview"
        }),
        update: jest.fn()
      }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    await expect(service.reviewVoiceIntro("admin-1", companion.id, {
      status: "approved",
      reviewedAssetReference: "evidence/voice/older.aac"
    })).rejects.toMatchObject({ code: "VOICE_INTRO_ASSET_CHANGED" });
    expect(db.companionProfile.update).not.toHaveBeenCalled();
  });

  it("allows an exact-reference rejection even when the evidence viewer is unavailable", async () => {
    const assetReference = "evidence/voice/current.aac";
    const db = {
      $queryRaw: jest.fn(),
      companionProfile: {
        findUnique: jest.fn().mockResolvedValue({
          ...companion,
          voiceIntroAssetRef: assetReference,
          voiceIntroDurationSeconds: 18,
          voiceIntroStatus: "pendingReview"
        }),
        update: jest.fn().mockResolvedValue({
          ...companion,
          voiceIntroAssetRef: assetReference,
          voiceIntroDurationSeconds: 18,
          voiceIntroStatus: "rejected"
        })
      }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    const result = await service.reviewVoiceIntro("admin-1", companion.id, {
      status: "rejected",
      reviewedAssetReference: assetReference
    });

    expect(result).toEqual(expect.objectContaining({ companionId: companion.id, status: "rejected" }));
    expect(db.companionProfile.update).toHaveBeenCalledWith({
      where: { id: companion.id },
      data: { voiceIntroStatus: "rejected" }
    });
  });
});
