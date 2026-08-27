import { createHash, createHmac } from "node:crypto";

import { CompanionLifecycleService } from "./companion-lifecycle.service";

describe("CompanionLifecycleService", () => {
  const prisma = {
    companionProfile: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    companionTrainingRecord: { findMany: jest.fn() },
    companionAccountAction: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn()
    },
    companionAccountAppeal: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn()
    },
    companionIncidentReport: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn()
    },
    staffCredential: { findUnique: jest.fn() },
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
    assertAttachmentsAllowed: jest.fn(),
    bindCompanionIncident: jest.fn().mockResolvedValue([]),
    bindCompanionAccountAppeal: jest.fn().mockResolvedValue([])
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
      COMMERCIAL_SURFACE: "full",
      COMPANION_VOICE_EVIDENCE_VIEWER_URL: "",
      COMPANION_VOICE_EVIDENCE_SIGNING_SECRET: "",
      COMPANION_VOICE_EVIDENCE_URL_TTL_SECONDS: 300
    };
    config.get.mockImplementation((key: string) => configValues[key]);
    caseEvidence.assertAttachmentsAllowed.mockReturnValue(undefined);
    caseEvidence.bindCompanionAccountAppeal.mockResolvedValue([]);
    prisma.companionAccountAppeal.findUnique.mockResolvedValue(null);
    prisma.companionProfile.findUnique.mockResolvedValue(companion);
    prisma.order.findMany.mockResolvedValue([]);
    prisma.order.count.mockResolvedValue(0);
    prisma.supportTicket.count.mockResolvedValue(0);
    prisma.companionAccountAction.count.mockResolvedValue(0);
    prisma.companionAccountAction.findMany.mockResolvedValue([]);
    prisma.companionAccountAction.findUnique.mockResolvedValue(null);
    prisma.companionIncidentReport.count.mockResolvedValue(0);
    prisma.companionIncidentReport.findMany.mockResolvedValue([]);
    prisma.staffCredential.findUnique.mockImplementation(async ({ where }: any) => ({
      id: `credential-${where.userId}`,
      userId: where.userId,
      status: "active",
      user: {
        id: where.userId,
        role: String(where.userId).startsWith("admin") ? "admin" : "supply",
        accountStatus: "active"
      }
    }));
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
    let createdAppeal: any;
    prisma.companionAccountAppeal.create.mockImplementation(({ data }: any) => {
      createdAppeal = {
        id: "appeal-1",
        ...data,
        status: "pending",
        resolution: null,
        resolvedAt: null,
        createdAt: new Date("2026-07-31T08:00:00.000Z"),
        evidenceAttachments: [],
        legacyEvidenceReferenceCount: 0
      };
      return Promise.resolve(createdAppeal);
    });
    prisma.companionAccountAppeal.findUniqueOrThrow.mockImplementation(() =>
      Promise.resolve(createdAppeal)
    );

    const result = await service.appeal("owner-1", "action-1", {
      statement: "本次处置所依据的履约时间与订单记录不一致，请重新核验",
      evidenceAssetIds: ["11111111-1111-4111-8111-111111111111"]
    });

    expect(result.reviewDueAt).toBe("2026-08-02T08:00:00.000Z");
    expect(result.overdue).toBe(false);
    expect(prisma.companionAccountAppeal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reviewDueAt: new Date("2026-08-02T08:00:00.000Z")
      })
    });
    expect(caseEvidence.bindCompanionAccountAppeal).toHaveBeenCalledWith(prisma, {
      assetIds: ["11111111-1111-4111-8111-111111111111"],
      userId: "owner-1",
      actionId: "action-1",
      appealId: "appeal-1"
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
      evidenceAssetIds: []
    })).rejects.toMatchObject({ code: "COMPANION_ACTION_APPEAL_WINDOW_CLOSED" });
  });

  it("rechecks the action under locks and rejects an appeal racing with revocation", async () => {
    prisma.companionAccountAction.findFirst.mockResolvedValue({
      id: "action-revoked-under-lock",
      companionId: companion.id,
      revokedAt: new Date(),
      appealDeadlineAt: new Date(Date.now() + 60_000)
    });

    await expect(service.appeal("owner-1", "action-revoked-under-lock", {
      statement: "请求依据完整履约记录重新独立核验此次账号处置。",
      evidenceAssetIds: []
    })).rejects.toMatchObject({ code: "COMPANION_ACTION_ALREADY_REVOKED" });

    expect(prisma.companionAccountAppeal.create).not.toHaveBeenCalled();
    expect(caseEvidence.bindCompanionAccountAppeal).not.toHaveBeenCalled();
  });

  it("materializes an expired temporary suspension exactly once with audit and notification", async () => {
    const now = new Date("2026-08-25T08:00:00.000Z");
    const endedAt = new Date("2026-08-25T07:00:00.000Z");
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([{
          id: "temporary-suspension-1",
          companionId: companion.id,
          endsAt: endedAt,
          ownerUserId: "owner-1"
      }])
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    await expect(service.materializeExpiredSuspensionReactivations(50, now)).resolves.toEqual({
      scanned: 1,
      materialized: 1,
      hasMore: false
    });
    const claimSql = Array.from(db.$queryRaw.mock.calls[0][0] as readonly string[]).join("");
    expect(claimSql).toContain("FOR UPDATE OF action SKIP LOCKED");
    expect(claimSql).toContain("LIMIT");
    expect(claimSql).toContain('"reactivationStatus" = \'required\'');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "system",
      subjectUserIds: ["owner-1"],
      action: "commercial.companion_suspension_expiry_reactivation_required",
      resourceId: "temporary-suspension-1"
    }), db);
    expect(notifications.createTransactional).toHaveBeenCalledWith(db, expect.objectContaining({
      userId: "owner-1",
      title: "陪伴者临时暂停已到期，资格恢复待复核",
      data: expect.objectContaining({ publicationRestored: false })
    }));
  });

  it("treats rows locked or transitioned by another replica as no local work", async () => {
    const now = new Date("2026-08-25T08:00:00.000Z");
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([])
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    await expect(service.materializeExpiredSuspensionReactivations(50, now)).resolves.toEqual({
      scanned: 0,
      materialized: 0,
      hasMore: false
    });
    expect(audit.record).not.toHaveBeenCalled();
    expect(notifications.createTransactional).not.toHaveBeenCalled();
  });

  it("lets a different operator restore only the causally suspended commercial profile", async () => {
    const now = new Date("2026-08-25T08:00:00.000Z");
    jest.useFakeTimers().setSystemTime(now);
    const base = {
      id: "temporary-suspension-2",
      companionId: companion.id,
      kind: "suspension",
      createdById: "supply-original",
      revokedAt: null,
      endsAt: new Date("2026-08-25T07:00:00.000Z"),
      reactivationStatus: "required",
      companion: { id: companion.id, ownerUserId: "owner-1" }
    };
    const current = {
      ...base,
      companion: {
        ...companion,
        isVerified: true,
        owner: {
          id: "owner-1",
          role: "companion",
          accountStatus: "active",
          profile: { isVerified: true, age: 29 }
        },
        commercialProfile: {
          status: "suspended",
          suspendedByAccountActionId: base.id,
          adultEligibilityVerdict: "adult",
          adultEligibilityVerifiedAt: new Date("2026-08-01T00:00:00.000Z"),
          adultEligibilityValidUntil: new Date("2027-01-01T00:00:00.000Z"),
          nextReviewDueAt: new Date("2027-01-01T00:00:00.000Z")
        }
      }
    };
    const completed = {
      ...base,
      startsAt: new Date("2026-08-20T08:00:00.000Z"),
      appealDeadlineAt: new Date("2026-09-20T08:00:00.000Z"),
      reactivationRequiredAt: new Date("2026-08-25T07:01:00.000Z"),
      reactivationStatus: "completed",
      reactivationCompletedAt: now,
      reactivationCompletedById: "supply-independent",
      reactivationResolution: "已核对当前资格，恢复商业状态但保持下架。",
      createdAt: new Date("2026-08-20T08:00:00.000Z")
    };
    const db = {
      $queryRaw: jest.fn(),
      companionAccountAction: {
        findUnique: jest.fn().mockResolvedValue(current),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue(completed)
      },
      accountDeletionRequest: { findFirst: jest.fn().mockResolvedValue(null) },
      companionTrainingRecord: {
        findMany: jest.fn().mockResolvedValue([
          { moduleCode: "service-boundaries", moduleVersion: "2026.1" },
          { moduleCode: "safety-escalation", moduleVersion: "2026.1" },
          { moduleCode: "privacy-refresh", moduleVersion: "2026.1" }
        ])
      },
      companionCommercialProfile: { update: jest.fn() },
      companionProfile: { update: jest.fn() }
    };
    prisma.companionAccountAction.findUnique.mockResolvedValue({
      companionId: companion.id,
      companion: { ownerUserId: "owner-1" }
    });
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    const result = await service.completeExpiredSuspensionReactivation(
      "supply-independent",
      base.id,
      { resolution: "已核对当前资格，恢复商业状态但保持下架。" }
    );

    expect(db.companionCommercialProfile.update).toHaveBeenCalledWith({
      where: { companionId: companion.id },
      data: {
        status: "verified",
        suspendedAt: null,
        suspendedById: null,
        suspendedReason: null,
        suspendedByAccountActionId: null
      }
    });
    expect(db.companionProfile.update).toHaveBeenCalledWith({
      where: { id: companion.id },
      data: { isPublished: false, isOnline: false, availability: "busy" }
    });
    const lockStatements = db.$queryRaw.mock.calls.map((call: any[]) =>
      Array.from(call[0] as readonly string[]).join("")
    );
    expect(lockStatements[0]).toContain('FROM "User"');
    expect(lockStatements[1]).toContain('FROM "CompanionProfile"');
    expect(lockStatements[2]).toContain('FROM "CompanionAccountAction"');
    expect(result.reactivation).toEqual(expect.objectContaining({
      status: "completed",
      publicationRestored: false,
      nextAction: "awaitExplicitPublicationDecision"
    }));
  });

  it("exposes explicit publication as the next step after a temporary service restriction expires", () => {
    const now = new Date("2026-08-25T08:00:00.000Z");
    jest.useFakeTimers().setSystemTime(now);
    const view = (service as any).actionDto({
      id: "service-restriction-ended",
      companionId: companion.id,
      kind: "serviceRestriction",
      reasonCode: "temporary-boundary",
      message: "临时限制已结束，需重新核验后决定是否公开。",
      startsAt: new Date("2026-08-24T08:00:00.000Z"),
      endsAt: new Date("2026-08-25T07:00:00.000Z"),
      appealDeadlineAt: new Date("2026-09-24T08:00:00.000Z"),
      revokedAt: null,
      reactivationStatus: "notRequired",
      createdAt: new Date("2026-08-24T08:00:00.000Z")
    });

    expect(view.reactivation).toEqual(expect.objectContaining({
      status: "notRequired",
      nextAction: "awaitExplicitPublicationDecision",
      publicationRestored: false
    }));
    expect(view.appealWindowOpen).toBe(false);
  });

  it("does not let the original temporary-suspension creator approve reactivation", async () => {
    const actionId = "temporary-suspension-self-review";
    prisma.companionAccountAction.findUnique.mockResolvedValue({
      companionId: companion.id,
      companion: { ownerUserId: "owner-1" }
    });
    const db = {
      $queryRaw: jest.fn(),
      companionAccountAction: {
        findUnique: jest.fn().mockResolvedValue({
          id: actionId,
          companionId: companion.id,
          kind: "suspension",
          createdById: "supply-original",
          revokedAt: null,
          endsAt: new Date(Date.now() - 60_000),
          reactivationStatus: "required",
          companion: { ownerUserId: "owner-1" }
        })
      }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    await expect(service.completeExpiredSuspensionReactivation(
      "supply-original",
      actionId,
      { resolution: "尝试自行确认暂停到期后的资格恢复。" }
    )).rejects.toMatchObject({
      code: "COMPANION_REACTIVATION_INDEPENDENT_REVIEW_REQUIRED"
    });
    expect(audit.record).not.toHaveBeenCalled();
    expect(notifications.createTransactional).not.toHaveBeenCalled();
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
      assignedToUserId: "supply-independent",
      assignedAt: new Date("2026-07-31T09:00:00.000Z"),
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
      data: expect.objectContaining({
        route: "companionDevelopment",
        actionId: "action-independent-2",
        appealId: "appeal-independent-2",
        appealStatus: "upheld"
      }),
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
      evidenceAttachments: [{ id: "controlled-attachment-1", mediaAsset: { status: "approved" } }],
      legacyEvidenceReferenceCount: 0,
      status: "pending",
      assignedToUserId: "supply-independent",
      assignedAt: new Date("2026-08-01T08:30:00.000Z"),
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

  it("marks overturned service suspensions as awaiting independent reactivation without republishing", async () => {
    const existing = {
      id: "appeal-reactivation-required",
      actionId: "action-suspension",
      companionId: companion.id,
      statement: "原处置遗漏了关键履约记录，请重新核验并撤销暂停。",
      evidenceReferences: [],
      status: "pending",
      assignedToUserId: "supply-independent",
      assignedAt: new Date("2026-08-01T08:30:00.000Z"),
      reviewDueAt: new Date("2026-08-04T08:00:00.000Z"),
      resolution: null,
      resolvedAt: null,
      resolvedById: null,
      createdAt: new Date("2026-08-01T08:00:00.000Z"),
      action: { kind: "suspension", createdById: "supply-original" },
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

    const result = await service.resolveAppeal("supply-independent", existing.id, {
      status: "overturned",
      resolution: "独立复核确认原暂停依据不足，正式撤销该账号处置。"
    });

    expect(db.companionAccountAppeal.update).toHaveBeenCalledWith({
      where: { id: existing.id },
      data: expect.objectContaining({
        status: "overturned",
        reactivationStatus: "required",
        reactivationRequiredAt: expect.any(Date)
      })
    });
    expect(result.reactivation).toEqual(expect.objectContaining({
      status: "required",
      required: true,
      publicationRestored: false,
      nextAction: "awaitIndependentOperationalReview"
    }));
    expect(notifications.createTransactional).toHaveBeenCalledWith(db, expect.objectContaining({
      title: "陪伴者申诉已撤销原处置，恢复待复核",
      data: expect.objectContaining({
        reactivationStatus: "required",
        publicationRestored: false
      })
    }));
  });

  it("completes suspension reactivation with a third operator and never restores publication", async () => {
    const now = new Date("2026-08-05T08:00:00.000Z");
    jest.useFakeTimers().setSystemTime(now);
    const base = {
      id: "appeal-reactivation-complete",
      actionId: "action-suspension-complete",
      companionId: companion.id,
      statement: "请求独立复核暂停处置。",
      evidenceReferences: [],
      status: "overturned",
      reviewDueAt: new Date("2026-08-04T08:00:00.000Z"),
      resolution: "原暂停已由独立人员撤销。",
      resolvedAt: new Date("2026-08-03T08:00:00.000Z"),
      resolvedById: "supply-appeal-reviewer",
      reactivationStatus: "required",
      reactivationRequiredAt: new Date("2026-08-03T08:00:00.000Z"),
      reactivationCompletedAt: null,
      reactivationCompletedById: null,
      reactivationResolution: null,
      createdAt: new Date("2026-08-01T08:00:00.000Z"),
      action: {
        id: "action-suspension-complete",
        kind: "suspension",
        createdById: "supply-original",
        revokedAt: new Date("2026-08-03T08:00:00.000Z")
      },
      companion: { id: companion.id, ownerUserId: "owner-1" }
    };
    const current = {
      ...base,
      companion: {
        ...companion,
        isVerified: true,
        owner: {
          id: "owner-1",
          role: "companion",
          accountStatus: "active",
          profile: { isVerified: true, age: 28 }
        },
        commercialProfile: {
          status: "suspended",
          suspendedByAccountActionId: base.actionId,
          adultEligibilityVerdict: "adult",
          adultEligibilityVerifiedAt: new Date("2026-07-01T08:00:00.000Z"),
          adultEligibilityValidUntil: new Date("2027-01-01T08:00:00.000Z"),
          nextReviewDueAt: new Date("2027-01-01T08:00:00.000Z")
        }
      }
    };
    const completed = {
      ...base,
      reactivationStatus: "completed",
      reactivationCompletedAt: now,
      reactivationCompletedById: "supply-reactivation-reviewer",
      reactivationResolution: "已复核当前实名、成年、商业资料与培训均有效，准予恢复资格。"
    };
    const db = {
      $queryRaw: jest.fn(),
      companionAccountAppeal: {
        findUnique: jest.fn().mockResolvedValueOnce(base).mockResolvedValueOnce(current),
        update: jest.fn().mockResolvedValue(completed)
      },
      companionAccountAction: { findFirst: jest.fn().mockResolvedValue(null) },
      accountDeletionRequest: { findFirst: jest.fn().mockResolvedValue(null) },
      companionTrainingRecord: {
        findMany: jest.fn().mockResolvedValue([
          { moduleCode: "service-boundaries", moduleVersion: "2026.1" },
          { moduleCode: "safety-escalation", moduleVersion: "2026.1" },
          { moduleCode: "privacy-refresh", moduleVersion: "2026.1" }
        ])
      },
      companionCommercialProfile: { update: jest.fn() },
      companionProfile: { update: jest.fn() }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    const result = await service.completeAppealReactivation(
      "supply-reactivation-reviewer",
      base.id,
      { resolution: completed.reactivationResolution }
    );

    expect(db.companionCommercialProfile.update).toHaveBeenCalledWith({
      where: { companionId: companion.id },
      data: {
        status: "verified",
        suspendedAt: null,
        suspendedById: null,
        suspendedReason: null,
        suspendedByAccountActionId: null
      }
    });
    expect(db.companionProfile.update).toHaveBeenCalledWith({
      where: { id: companion.id },
      data: { isPublished: false, isOnline: false, availability: "busy" }
    });
    expect(result.reactivation).toEqual(expect.objectContaining({
      status: "completed",
      publicationRestored: false,
      nextAction: "awaitExplicitPublicationDecision"
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "supply-reactivation-reviewer",
      action: "commercial.companion_action_reactivation_completed",
      metadata: expect.objectContaining({
        independentReactivationReview: true,
        commercialProfileRestored: true,
        publicationRestored: false
      })
    }), db);
  });

  it("does not let the appeal reviewer complete the reactivation review", async () => {
    const existing = {
      id: "appeal-reactivation-self-review",
      actionId: "action-reactivation-self-review",
      companionId: companion.id,
      status: "overturned",
      resolvedById: "supply-appeal-reviewer",
      reactivationStatus: "required",
      action: {
        kind: "serviceRestriction",
        createdById: "supply-original",
        revokedAt: new Date()
      },
      companion: { ownerUserId: "owner-1" }
    };
    const db = {
      $queryRaw: jest.fn(),
      companionAccountAppeal: { findUnique: jest.fn().mockResolvedValue(existing) }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    await expect(service.completeAppealReactivation(
      "supply-appeal-reviewer",
      existing.id,
      { resolution: "再次核验当前资格并确认可以恢复。" }
    )).rejects.toMatchObject({
      code: "COMPANION_REACTIVATION_INDEPENDENT_REVIEW_REQUIRED"
    });
    expect(audit.record).not.toHaveBeenCalled();
    expect(notifications.createTransactional).not.toHaveBeenCalled();
  });

  it("serializes concurrent appeal decisions so only one is audited", async () => {
    const base = {
      id: "appeal-concurrent",
      actionId: "action-concurrent",
      companionId: companion.id,
      statement: "请求依据现有履约证据重新独立核验此次账号处置。",
      evidenceReferences: [],
      status: "pending",
      assignedToUserId: "supply-independent-1",
      assignedAt: new Date("2026-08-01T07:30:00.000Z"),
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
      service.resolveAppeal("supply-independent-1", base.id, {
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
      evidenceAttachments: [{ id: "controlled-attachment-1", mediaAsset: { status: "approved" } }],
      legacyEvidenceReferenceCount: 0,
      status: "pending",
      assignedToUserId: "supply-independent",
      assignedAt: new Date("2026-08-01T09:01:00.000Z"),
      reviewDueAt: new Date("2026-08-04T08:00:00.000Z"),
      resolution: null,
      resolvedAt: null,
      createdAt: new Date("2026-08-01T09:00:00.000Z"),
      action,
      companion
    }]);
    prisma.companionAccountAppeal.count.mockResolvedValue(51);
    caseEvidence.attachmentDtos.mockReturnValue([{ id: "controlled-attachment-1", kind: "image" }]);

    const ownQueue = await service.adminAppeals("supply-original", "pending", 2, 25);
    const independentQueue = await service.adminAppeals("supply-independent", "pending", 2, 25);

    expect(ownQueue.items[0].independentReviewEligible).toBe(false);
    expect(ownQueue.items[0].evidenceAttachments).toEqual([]);
    expect(independentQueue.items[0].independentReviewEligible).toBe(true);
    expect(independentQueue.items[0].evidenceAttachments).toEqual([
      { id: "controlled-attachment-1", kind: "image" }
    ]);
    expect(ownQueue.pagination).toEqual({
      total: 51,
      totalPages: 3,
      page: 2,
      pageSize: 25
    });
    expect(prisma.companionAccountAppeal.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { status: "pending", assignedToUserId: "supply-independent" },
      orderBy: [{ reviewDueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      skip: 25,
      take: 25
    }));
    expect(prisma.companionAccountAppeal.count).toHaveBeenLastCalledWith({
      where: { status: "pending", assignedToUserId: "supply-independent" }
    });
  });

  it("keeps the unassigned appeal queue minimal and reveals evidence only after claim", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-05T00:00:00.000Z"));
    const createdAt = new Date("2026-08-01T09:00:00.000Z");
    const reviewDueAt = new Date("2026-08-04T08:00:00.000Z");
    prisma.companionAccountAppeal.findMany.mockResolvedValueOnce([{
      id: "appeal-claimable",
      status: "pending",
      reviewDueAt,
      createdAt
    }]);
    prisma.companionAccountAppeal.count.mockResolvedValueOnce(1);

    const summary = await service.claimableAppeals("supply-reviewer", 1, 20);
    expect(summary).toEqual({
      items: [{
        id: "appeal-claimable",
        status: "pending",
        submittedAt: createdAt.toISOString(),
        reviewDueAt: reviewDueAt.toISOString(),
        overdue: true
      }],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      scope: "claimableSummary"
    });
    expect(prisma.companionAccountAppeal.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        assignedToUserId: null,
        status: "pending",
        action: { createdById: { not: "supply-reviewer" } }
      },
      select: { id: true, status: true, reviewDueAt: true, createdAt: true }
    }));

    const action = {
      id: "action-claimable",
      companionId: companion.id,
      kind: "warning",
      reasonCode: "review_required",
      message: "请在期限内提交完整申诉材料并等待独立复核。",
      startsAt: createdAt,
      endsAt: null,
      appealDeadlineAt: reviewDueAt,
      revokedAt: null,
      reactivationStatus: "notRequired",
      createdAt,
      createdById: "supply-original"
    };
    const existing = {
      id: "appeal-claimable",
      actionId: action.id,
      companionId: companion.id,
      statement: "请求依据完整履约记录重新独立复核此次账号处置。",
      evidenceAttachments: [{ id: "attachment-claimable", mediaAsset: { status: "approved" } }],
      legacyEvidenceReferenceCount: 0,
      status: "pending",
      reviewDueAt,
      resolution: null,
      resolvedAt: null,
      assignedToUserId: null,
      assignedAt: null,
      reactivationStatus: "notRequired",
      createdAt,
      action,
      companion,
      assignedTo: null
    };
    const db = {
      $queryRaw: jest.fn(),
      staffCredential: prisma.staffCredential,
      companionAccountAppeal: {
        findUnique: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockResolvedValue({
          ...existing,
          assignedToUserId: "supply-reviewer",
          assignedAt: createdAt
        })
      }
    };
    prisma.$transaction.mockImplementationOnce(async (fn: any) => fn(db));
    caseEvidence.attachmentDtos.mockReturnValueOnce([{ id: "attachment-claimable", kind: "image" }]);

    const claimed = await service.claimAppeal("supply-reviewer", existing.id);
    expect(claimed).toEqual(expect.objectContaining({
      assignedToUserId: "supply-reviewer",
      assignedToActor: true,
      evidenceAttachments: [{ id: "attachment-claimable", kind: "image" }]
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "commercial.companion_action_appeal_claimed",
      resourceId: existing.id
    }), db);
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

  it("rejects media evidence before resolving a companion or creating an incident transaction", async () => {
    const unavailable = Object.assign(new Error("case evidence disabled"), {
      code: "MEDIA_FEATURE_DISABLED",
      status: 503
    });
    caseEvidence.assertAttachmentsAllowed.mockImplementation(() => {
      throw unavailable;
    });

    await expect(service.createIncident("owner-1", {
      category: "technicalIssue",
      summary: "通话开始后持续无声音，重连仍未恢复。",
      evidenceAssetIds: ["55555555-5555-4555-8555-555555555555"]
    })).rejects.toBe(unavailable);

    expect(prisma.companionProfile.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(caseEvidence.bindCompanionIncident).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(notifications.createTransactional).not.toHaveBeenCalled();
  });

  it("keeps supply incident lists assigned-only and exposes claimable rows as minimal summaries", async () => {
    const submittedAt = new Date("2026-08-01T00:00:00.000Z");
    prisma.companionIncidentReport.findMany.mockResolvedValue([{
      id: "incident-1",
      status: "open",
      createdAt: submittedAt,
      updatedAt: submittedAt,
      orderId: "order-secret",
      category: "harassment",
      summary: "sensitive narrative"
    }]);
    prisma.companionIncidentReport.count.mockResolvedValue(1);

    const assigned = await service.adminIncidents("supply-1", "open", 1, 20);
    expect(prisma.companionIncidentReport.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: "open", assignedToUserId: "supply-1" }
    }));
    expect(assigned.scope).toBe("assignedToMe");

    prisma.companionIncidentReport.findMany.mockClear();
    const claimable = await service.claimableIncidents("supply-1", "open", 1, 20);
    expect(prisma.companionIncidentReport.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { assignedToUserId: null, status: "open" },
      select: { id: true, status: true, createdAt: true, orderId: true }
    }));
    expect(claimable).toEqual({
      items: [{
        id: "incident-1",
        status: "open",
        submittedAt: submittedAt.toISOString(),
        hasOrder: true
      }],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      scope: "claimableSummary"
    });
    expect(JSON.stringify(claimable)).not.toMatch(/harassment|sensitive narrative|order-secret|evidence/i);
  });

  it("atomically claims an unassigned incident and rejects a second supply operator", async () => {
    const incident = {
      id: "incident-claim",
      companionId: companion.id,
      orderId: null,
      category: "technicalIssue",
      summary: "技术连接异常，需要平台核验当前日志。",
      status: "open",
      assignedToUserId: null,
      assignedAt: null,
      resolution: null,
      resolvedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      companion: { id: companion.id, name: companion.name, ownerUserId: "owner-1" },
      order: null,
      assignedTo: { id: "supply-1", role: "supply", profile: { displayName: "供应运营" } },
      evidenceAttachments: []
    };
    prisma.companionIncidentReport.findUnique.mockResolvedValue(incident);
    prisma.companionIncidentReport.update.mockResolvedValue({ ...incident, assignedToUserId: "supply-1" });
    prisma.companionIncidentReport.findUniqueOrThrow.mockResolvedValue({
      ...incident,
      status: "inReview",
      assignedToUserId: "supply-1",
      assignedAt: new Date()
    });

    const result = await service.claimIncident("supply-1", incident.id);
    expect(result).toEqual(expect.objectContaining({ id: incident.id, status: "inReview" }));
    expect(prisma.companionIncidentReport.update).toHaveBeenCalledWith({
      where: { id: incident.id },
      data: {
        assignedToUserId: "supply-1",
        assignedAt: expect.any(Date),
        status: "inReview"
      }
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "commercial.companion_incident_claimed"
    }), prisma);

    prisma.companionIncidentReport.findUnique.mockResolvedValue({
      ...incident,
      assignedToUserId: "supply-other"
    });
    await expect(service.claimIncident("supply-1", incident.id)).rejects.toMatchObject({
      code: "COMPANION_INCIDENT_ALREADY_ASSIGNED",
      status: 409
    });
  });

  it("locks incident assignment staff in canonical order before the incident row", async () => {
    const now = new Date();
    const incident = {
      id: "incident-assignment-order",
      companionId: companion.id,
      orderId: null,
      category: "technicalIssue",
      summary: "技术连接异常，需要平台核验当前日志。",
      status: "open",
      assignedToUserId: null,
      assignedAt: null,
      resolution: null,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
      companion: { id: companion.id, name: companion.name, ownerUserId: "owner-1" },
      order: null,
      assignedTo: null,
      evidenceAttachments: []
    };
    prisma.companionIncidentReport.findUnique.mockResolvedValue(incident);
    prisma.companionIncidentReport.update.mockResolvedValue({
      ...incident,
      status: "inReview",
      assignedToUserId: "0-supply",
      assignedAt: now
    });
    prisma.companionIncidentReport.findUniqueOrThrow.mockResolvedValue({
      ...incident,
      status: "inReview",
      assignedToUserId: "0-supply",
      assignedAt: now,
      assignedTo: { id: "0-supply", role: "supply", profile: { displayName: "供应运营" } }
    });

    await expect(service.assignIncident("admin-z", incident.id, {
      assignedToUserId: "0-supply"
    })).resolves.toEqual(expect.objectContaining({ id: incident.id, status: "inReview" }));

    const staffLocks = prisma.$queryRaw.mock.calls.filter(([template]: [TemplateStringsArray]) =>
      template.join("?").includes('FROM "StaffCredential"')
    );
    expect(staffLocks.map((call: unknown[]) => call[1])).toEqual(["0-supply", "admin-z"]);
    const incidentLockOrder = prisma.$queryRaw.mock.calls.findIndex(
      ([template]: [TemplateStringsArray]) => template.join("?").includes('FROM "CompanionIncidentReport"')
    );
    expect(incidentLockOrder).toBeGreaterThan(1);
  });

  it("requires the current supply assignee to resolve while retaining admin override", async () => {
    const existing = {
      id: "incident-resolve",
      companionId: companion.id,
      orderId: null,
      status: "inReview",
      assignedToUserId: "supply-other"
    };
    prisma.companionIncidentReport.findUnique.mockResolvedValue(existing);

    await expect(service.resolveIncident("supply-1", existing.id, {
      status: "resolved",
      resolution: "已核验并完成受控处理。"
    })).rejects.toMatchObject({
      code: "COMPANION_INCIDENT_ASSIGNEE_REQUIRED",
      status: 403
    });
    expect(prisma.companionIncidentReport.update).not.toHaveBeenCalled();
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
      COMMERCIAL_SURFACE: "full",
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

  it("fails closed before database reads, queueing, signing, or review mutations on text-only", async () => {
    configValues = {
      ...configValues,
      COMMERCIAL_SURFACE: "text_only",
      COMPANION_VOICE_EVIDENCE_VIEWER_URL: "https://evidence.example.com/listen",
      COMPANION_VOICE_EVIDENCE_SIGNING_SECRET: "controlled-viewer-secret"
    };

    await expect(service.createVoiceIntroReadUrl("admin-1", companion.id)).rejects.toMatchObject({
      code: "VOICE_INTRO_UNAVAILABLE",
      status: 503
    });
    await expect(service.reviewVoiceIntro("admin-1", companion.id, {
      status: "rejected",
      reviewedAssetReference: "evidence/voice/current.aac"
    })).rejects.toMatchObject({
      code: "VOICE_INTRO_UNAVAILABLE",
      status: 503
    });
    await expect(service.adminVoiceIntros()).rejects.toMatchObject({
      code: "VOICE_INTRO_UNAVAILABLE",
      status: 503
    });

    expect(prisma.companionProfile.findUnique).not.toHaveBeenCalled();
    expect(prisma.companionProfile.findMany).not.toHaveBeenCalled();
    expect(prisma.companionProfile.count).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("redacts historical voice references from the owner overview on text-only", async () => {
    configValues = { ...configValues, COMMERCIAL_SURFACE: "text_only" };
    const internal = service as any;
    jest.spyOn(internal, "ownCompanion").mockResolvedValue({
      ...companion,
      voiceIntroAssetRef: "evidence/voice/current.aac",
      voiceIntroDurationSeconds: 18,
      voiceIntroStatus: "pendingReview"
    });
    for (const method of [
      "commercialProfileForCompanion",
      "trainingForCompanion",
      "qualityForCompanion",
      "actionsForCompanion",
      "incidentsForCompanion",
      "withdrawalsForCompanion",
      "operationalSummaryForCompanion"
    ]) {
      jest.spyOn(internal, method).mockResolvedValue({});
    }

    const result = await service.overview("owner-1");

    expect(result.companion.voiceIntro).toEqual({
      assetReference: null,
      durationSeconds: null,
      status: "pendingReview"
    });
  });

  it("rejects a stale voice-intro approval even when the evidence viewer is configured", async () => {
    configValues = {
      COMMERCIAL_SURFACE: "full",
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
