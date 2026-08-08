import { CompanionLifecycleService } from "./companion-lifecycle.service";

describe("CompanionLifecycleService quality cases", () => {
  const prisma = {
    companionProfile: { findUnique: jest.fn() },
    companionTrainingRecord: { findMany: jest.fn() },
    companionAccountAction: { findFirst: jest.fn(), count: jest.fn() },
    companionAccountAppeal: { create: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    companionIncidentReport: { create: jest.fn(), findMany: jest.fn(), findUniqueOrThrow: jest.fn(), count: jest.fn() },
    companionQualityCase: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      update: jest.fn()
    },
    companionRemediationTask: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      update: jest.fn()
    },
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
    isPublished: true,
    voiceIntroAssetRef: null,
    voiceIntroDurationSeconds: null,
    voiceIntroStatus: "notSubmitted"
  };

  beforeEach(() => {
    jest.clearAllMocks();
    configValues = {
      COMPANION_APPEAL_SUBMISSION_DAYS: 30,
      COMPANION_VOICE_EVIDENCE_VIEWER_URL: "",
      COMPANION_VOICE_EVIDENCE_SIGNING_SECRET: "",
      COMPANION_VOICE_EVIDENCE_URL_TTL_SECONDS: 300
    };
    config.get.mockImplementation((key: string) => configValues[key]);
    prisma.companionProfile.findUnique.mockResolvedValue(companion);
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    service = new CompanionLifecycleService(prisma, audit, commercial, config, notifications, caseEvidence);
  });

  it("requires at least one remediation task for needsRemediation grades", async () => {
    await expect(service.createQualityCase("supply-1", {
      companionId: companion.id,
      grade: "needsRemediation",
      reasonCode: "service_quality",
      summary: "近期履约投诉需要完成指定整改模块"
    })).rejects.toMatchObject({ code: "COMPANION_QUALITY_TASKS_REQUIRED" });
  });

  it("creates needsRemediation tasks in the same transaction", async () => {
    const dueAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
    const now = new Date("2026-08-04T08:00:00.000Z");
    const db = {
      $queryRaw: jest.fn(),
      companionProfile: {
        findUnique: jest.fn().mockResolvedValue(companion),
        update: jest.fn()
      },
      companionIncidentReport: { findFirst: jest.fn() },
      companionAccountAction: { findFirst: jest.fn(), create: jest.fn() },
      companionCommercialProfile: { updateMany: jest.fn() },
      companionQualityCase: {
        create: jest.fn().mockImplementation(({ data }: any) => ({
          id: "case-1",
          companionId: companion.id,
          grade: data.grade,
          reasonCode: data.reasonCode,
          summary: data.summary,
          sourceIncidentId: data.sourceIncidentId,
          sourceActionId: data.sourceActionId,
          createdById: data.createdById,
          status: data.status,
          closedAt: data.closedAt,
          closedById: data.closedById,
          createdAt: now,
          updatedAt: now,
          tasks: (data.tasks?.create ?? []).map((task: any, index: number) => ({
            id: `task-${index + 1}`,
            caseId: "case-1",
            ...task,
            completedAt: null,
            evidenceRef: null,
            completedByCompanion: false,
            waivedAt: null,
            waivedById: null,
            waiverReason: null,
            createdAt: now,
            updatedAt: now
          }))
        }))
      }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    const result = await service.createQualityCase("supply-1", {
      companionId: companion.id,
      grade: "needsRemediation",
      reasonCode: "service_quality",
      summary: "近期履约投诉需要完成指定整改模块",
      tasks: [{ title: "完成服务边界复训", moduleCode: "service-boundaries", dueAt }]
    });

    expect(result.status).toBe("open");
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks?.[0]).toEqual(expect.objectContaining({
      title: "完成服务边界复训",
      moduleCode: "service-boundaries",
      status: "open"
    }));
    expect(db.companionQualityCase.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        grade: "needsRemediation",
        tasks: {
          create: [expect.objectContaining({
            title: "完成服务边界复训",
            moduleCode: "service-boundaries",
            status: "open"
          })]
        }
      })
    }));
  });

  it("unpublishes when restrictIntake creates a service restriction", async () => {
    const now = new Date("2026-08-04T08:00:00.000Z");
    jest.spyOn(Date, "now").mockReturnValue(now.getTime());
    const db = {
      $queryRaw: jest.fn(),
      companionProfile: {
        findUnique: jest.fn().mockResolvedValue(companion),
        update: jest.fn()
      },
      companionIncidentReport: { findFirst: jest.fn() },
      companionAccountAction: {
        findFirst: jest.fn(),
        create: jest.fn().mockImplementation(({ data }: any) => ({
          id: "action-restrict-1",
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
      companionCommercialProfile: { updateMany: jest.fn() },
      companionQualityCase: {
        create: jest.fn().mockImplementation(({ data }: any) => ({
          id: "case-restrict-1",
          companionId: companion.id,
          grade: data.grade,
          reasonCode: data.reasonCode,
          summary: data.summary,
          sourceIncidentId: null,
          sourceActionId: data.sourceActionId,
          createdById: data.createdById,
          status: data.status,
          closedAt: null,
          closedById: null,
          createdAt: now,
          updatedAt: now,
          tasks: []
        }))
      }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    const result = await service.createQualityCase("supply-1", {
      companionId: companion.id,
      grade: "restrictIntake",
      reasonCode: "intake_quality_risk",
      summary: "质量复核期间暂停接单，待整改完成后再开放"
    });

    expect(result.sourceActionId).toBe("action-restrict-1");
    expect(db.companionAccountAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: "serviceRestriction" })
    });
    expect(db.companionProfile.update).toHaveBeenCalledWith({
      where: { id: companion.id },
      data: { isPublished: false, availability: "busy", isOnline: false }
    });
  });

  it("lets the companion owner complete an open remediation task", async () => {
    const now = new Date("2026-08-04T08:00:00.000Z");
    const db = {
      $queryRaw: jest.fn(),
      companionRemediationTask: {
        findUnique: jest.fn().mockResolvedValue({
          id: "task-1",
          caseId: "case-1",
          status: "open",
          case: { companionId: companion.id, status: "open" }
        }),
        update: jest.fn().mockImplementation(({ data }: any) => ({
          id: "task-1",
          caseId: "case-1",
          title: "完成服务边界复训",
          moduleCode: "service-boundaries",
          dueAt: now,
          status: data.status,
          completedAt: data.completedAt,
          evidenceRef: data.evidenceRef,
          completedByCompanion: data.completedByCompanion,
          waivedAt: null,
          waivedById: null,
          waiverReason: null,
          createdAt: now,
          updatedAt: now
        }))
      }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    const result = await service.completeRemediationTask("owner-1", "task-1", "evidence://module-pass");

    expect(result).toEqual(expect.objectContaining({
      status: "completed",
      completedByCompanion: true,
      evidenceRef: "evidence://module-pass"
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "commercial.companion_remediation_task_completed"
    }), db);
  });

  it("marks overdue remediation tasks and creates a service restriction when none is active", async () => {
    const dueAt = new Date("2026-08-01T08:00:00.000Z");
    const now = new Date("2026-08-04T08:00:00.000Z");
    jest.useFakeTimers().setSystemTime(now);
    prisma.companionRemediationTask.findMany.mockResolvedValue([
      {
        id: "task-overdue-1",
        caseId: "case-1",
        status: "open",
        dueAt,
        case: {
          companionId: companion.id,
          companion: { id: companion.id, ownerUserId: "owner-1" }
        }
      }
    ]);
    const db = {
      $queryRaw: jest.fn(),
      companionRemediationTask: {
        findUnique: jest.fn().mockResolvedValue({
          id: "task-overdue-1",
          caseId: "case-1",
          status: "open",
          dueAt,
          case: {
            companionId: companion.id,
            companion: { id: companion.id, ownerUserId: "owner-1" }
          }
        }),
        update: jest.fn().mockResolvedValue({ id: "task-overdue-1", status: "overdue" })
      },
      companionAccountAction: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }: any) => ({
          id: "action-overdue-1",
          companionId: companion.id,
          kind: data.kind,
          reasonCode: data.reasonCode,
          message: data.message,
          startsAt: now,
          endsAt: null,
          appealDeadlineAt: data.appealDeadlineAt,
          revokedAt: null,
          createdAt: now
        }))
      },
      companionProfile: {
        findUnique: jest.fn().mockResolvedValue(companion),
        update: jest.fn()
      },
      companionCommercialProfile: { updateMany: jest.fn() }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    const result = await service.processOverdueRemediationTasks(10);

    expect(result).toEqual({ scanned: 1, markedOverdue: 1, restrictionsCreated: 1 });
    expect(db.companionRemediationTask.update).toHaveBeenCalledWith({
      where: { id: "task-overdue-1" },
      data: { status: "overdue" }
    });
    expect(db.companionAccountAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "serviceRestriction",
        reasonCode: "quality_remediation_overdue"
      })
    });
    expect(db.companionProfile.update).toHaveBeenCalledWith({
      where: { id: companion.id },
      data: { isPublished: false, availability: "busy", isOnline: false }
    });
  });

  it("counts overdue remediation tasks for readiness", async () => {
    prisma.companionRemediationTask.count.mockResolvedValue(4);
    await expect(service.countOverdueRemediationTasks()).resolves.toBe(4);
    expect(prisma.companionRemediationTask.count).toHaveBeenCalledWith({
      where: { status: "overdue" }
    });
  });
});
