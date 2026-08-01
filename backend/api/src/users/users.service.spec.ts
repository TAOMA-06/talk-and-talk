import {
  ACCOUNT_DELETION_RETAINED_SNAPSHOT_REGISTRY
} from "./account-deletion-retained-snapshot.registry";
import { UsersService } from "./users.service";

function retainedQueryText(input: any): string {
  if (Array.isArray(input)) return Array.from(input).join("?");
  if (Array.isArray(input?.strings)) return Array.from(input.strings).join("?");
  return String(input?.sql ?? input ?? "");
}

describe("UsersService", () => {
  const prisma = {
    user: {
      findUnique: jest.fn()
    },
    userProfile: {
      upsert: jest.fn()
    },
    legalConsentReceipt: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn()
    },
    accountDeletionRequest: {
      count: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn()
    },
    order: {
      findMany: jest.fn(),
      count: jest.fn()
    },
    refundTransaction: { count: jest.fn() },
    supportTicket: { count: jest.fn() },
    paymentDispute: { count: jest.fn() },
    attendanceDispute: { count: jest.fn() },
    orderRescheduleRequest: { count: jest.fn() },
    voiceSession: { count: jest.fn() },
    moderationCase: { count: jest.fn() },
    moderationAppeal: { count: jest.fn() },
    userAccountAppeal: { count: jest.fn() },
    dataRightsRequest: { count: jest.fn() },
    invoiceRequest: { count: jest.fn() },
    identityVerificationRequest: { count: jest.fn() }
  } as any;

  const audit = { record: jest.fn().mockResolvedValue({}) } as any;
  const legalArchive = { assertVersionPublished: jest.fn().mockResolvedValue(undefined) } as any;
  const moderation = { moderateAsync: jest.fn() } as any;
  const moderationCases = { createFromResult: jest.fn() } as any;
  const authTombstones = {
    installForDeletionTx: jest.fn().mockResolvedValue(1),
    assertCoverageTx: jest.fn().mockResolvedValue(1),
    sealExpiryForDeletionTx: jest.fn().mockResolvedValue(new Date("2036-01-01T00:00:00.000Z")),
    assertPersistedCoverageTx: jest.fn().mockResolvedValue(1)
  } as any;
  const legalDefinition = {
    API_PREFIX: "api/v1",
    LEGAL_CONSENT_VERSION: "2.0-2026-07-20",
    LEGAL_PRIVACY_URL: "https://api.talkandtalk.app/legal/privacy.html",
    LEGAL_TERMS_URL: "https://api.talkandtalk.app/legal/terms.html"
  };
  const config = {
    getOrThrow: jest.fn((key: keyof typeof legalDefinition) => legalDefinition[key]),
    get: jest.fn((key: string) => {
      if (key === "ACCOUNT_DELETION_RETENTION_POLICY_APPROVED") return true;
      if (key === "ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE") return "legal-approval-2026-001";
      return undefined;
    })
  } as any;
  let service: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    config.get.mockImplementation((key: string) => {
      if (key === "ACCOUNT_DELETION_RETENTION_POLICY_APPROVED") return true;
      if (key === "ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE") return "legal-approval-2026-001";
      return undefined;
    });
    moderation.moderateAsync.mockResolvedValue({ decision: "allow" });
    service = new UsersService(
      prisma,
      audit,
      config,
      legalArchive,
      moderation,
      moderationCases,
      authTombstones
    );
  });

  it("paginates and counts the filtered account deletion queue", async () => {
    const createdAt = new Date("2026-07-20T01:00:00.000Z");
    prisma.accountDeletionRequest.findMany.mockResolvedValue([{
      id: "deletion-26",
      userId: "user-26",
      status: "processing",
      note: null,
      processingStartedById: "admin-1",
      processingStartedAt: createdAt,
      completedById: null,
      completedAt: null,
      dueAt: new Date("2026-07-21T01:00:00.000Z"),
      policyVersion: "2026.1",
      createdAt,
      updatedAt: createdAt,
      user: { id: "user-26", role: "user", accountStatus: "restricted", createdAt }
    }]);
    prisma.accountDeletionRequest.count.mockResolvedValue(51);

    const result = await service.listDeletionRequests("processing", 2, 25);

    expect(prisma.accountDeletionRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: "processing" },
      skip: 25,
      take: 25,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    }));
    expect(prisma.accountDeletionRequest.count).toHaveBeenCalledWith({ where: { status: "processing" } });
    expect(result.pagination).toEqual({ page: 2, pageSize: 25, total: 51, totalPages: 3 });
    expect(result.items[0]).toEqual(expect.objectContaining({
      id: "deletion-26",
      status: "processing",
      dueAt: "2026-07-21T01:00:00.000Z",
      policyVersion: "2026.1",
      overdue: expect.any(Boolean)
    }));
    expect(result.policy).toEqual(expect.objectContaining({ version: "2026.1", businessDays: 15 }));
  });

  it("updates only safe profile fields", async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: "u1", role: "user" })
      .mockResolvedValueOnce({
        id: "u1",
        role: "user",
        profile: {
          displayName: "小楷",
          phone: "+8613800138000",
          age: 20,
          gender: "male",
          isVerified: false,
          safetyScore: 80
        }
      });
    prisma.userProfile.upsert.mockResolvedValue({});

    const result = await service.updateMe("u1", {
      displayName: "小楷",
      gender: "male",
      age: 20,
      role: "admin",
      safetyScore: 0
    } as any);

    expect(prisma.userProfile.upsert).toHaveBeenCalledWith({
      where: { userId: "u1" },
      create: { userId: "u1", displayName: "小楷", gender: "male", age: 20 },
      update: { displayName: "小楷", gender: "male", age: 20 }
    });
    expect(result.profile!.safetyScore).toBe(80);
  });

  it("updates only provided profile fields", async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: "u1", role: "user" })
      .mockResolvedValueOnce({
        id: "u1",
        role: "user",
        profile: {
          displayName: "小楷",
          phone: "+8613800138000",
          age: 20,
          gender: "male",
          isVerified: false,
          safetyScore: 80
        }
      });
    prisma.userProfile.upsert.mockResolvedValue({});

    await service.updateMe("u1", { age: 23 });

    expect(prisma.userProfile.upsert).toHaveBeenCalledWith({
      where: { userId: "u1" },
      create: { userId: "u1", age: 23 },
      update: { age: 23 }
    });
  });

  it("clears gender to null instead of storing a fabricated undisclosed category", async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: "u1", role: "user" })
      .mockResolvedValueOnce({
        id: "u1",
        role: "user",
        profile: {
          displayName: "小楷",
          phone: null,
          age: 20,
          gender: null,
          isVerified: false,
          safetyScore: 80
        }
      });
    prisma.userProfile.upsert.mockResolvedValue({});

    const result = await service.updateMe("u1", { gender: null });

    expect(prisma.userProfile.upsert).toHaveBeenCalledWith({
      where: { userId: "u1" },
      create: { userId: "u1", gender: null },
      update: { gender: null }
    });
    expect(result.profile?.gender).toBeNull();
  });

  it("does not publish a display name that fails profile moderation", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "u1", role: "user" });
    moderation.moderateAsync.mockResolvedValue({
      decision: "block",
      riskLevel: "high",
      priority: "high",
      score: 0.95,
      reasons: ["疑似联系方式"],
      matchedRules: ["contact.phone"],
      categories: ["privateContact"],
      policyVersion: "chat-v2",
      usedAI: false
    });
    moderationCases.createFromResult.mockResolvedValue({ id: "case-name-1" });

    await expect(service.updateMe("u1", { displayName: "13800138000" }))
      .rejects.toMatchObject({
        code: "DISPLAY_NAME_REQUIRES_REVISION",
        details: { moderationCaseId: "case-name-1", decision: "block" }
      });
    expect(prisma.userProfile.upsert).not.toHaveBeenCalled();
  });

  it("skips upsert when no profile fields are provided", async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: "u1", role: "user" })
      .mockResolvedValueOnce({
        id: "u1",
        role: "user",
        profile: {
          displayName: "小楷",
          phone: "+8613800138000",
          age: 20,
          gender: "male",
          isVerified: false,
          safetyScore: 80
        }
      });

    await service.updateMe("u1", {});

    expect(prisma.userProfile.upsert).not.toHaveBeenCalled();
  });

  it("records the server-authoritative legal consent definition", async () => {
    const created = {
      id: "lc1",
      userId: "u1",
      version: "2.0-2026-07-20",
      privacyVersion: "2.0-2026-07-20",
      termsVersion: "2.0-2026-07-20",
      privacyAccepted: true,
      termsAccepted: true,
      adultConfirmed: true,
      acceptedAt: new Date("2026-07-18T08:00:00.000Z"),
      consentedAt: new Date("2026-07-18T08:00:02.000Z"),
      withdrawnAt: null,
      privacyUrl: "https://api.talkandtalk.app/legal/privacy.html",
      termsUrl: "https://api.talkandtalk.app/legal/terms.html",
      source: "web"
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      legalConsentReceipt: {
        findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null),
        create: jest.fn().mockResolvedValue(created)
      }
    };
    prisma.$transaction = jest.fn(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    const result = await service.recordLegalConsent("u1", {
      version: "2.0-2026-07-20",
      acceptedAt: "2026-07-18T08:00:00.000Z",
      privacyAccepted: true,
      termsAccepted: true,
      adultConfirmed: true,
      privacyUrl: "https://api.talkandtalk.app/legal/privacy.html",
      termsUrl: "https://api.talkandtalk.app/legal/terms.html",
      source: "web"
    });

    expect(tx.legalConsentReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u1",
        version: "2.0-2026-07-20",
        privacyVersion: "2.0-2026-07-20",
        termsVersion: "2.0-2026-07-20",
        adultConfirmed: true,
        privacyUrl: "https://api.talkandtalk.app/legal/privacy.html",
        termsUrl: "https://api.talkandtalk.app/legal/terms.html",
        source: "web"
      })
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "u1",
        subjectUserIds: ["u1"],
        action: "legal.consent_recorded",
        resourceType: "legalConsentReceipt",
        resourceId: "lc1",
        metadata: expect.objectContaining({
          previousVersion: null,
          version: "2.0-2026-07-20",
          privacyArchiveUrl: "https://api.talkandtalk.app/api/v1/legal/privacy/versions/2.0-2026-07-20",
          termsArchiveUrl: "https://api.talkandtalk.app/api/v1/legal/terms/versions/2.0-2026-07-20"
        })
      }),
      tx
    );
    expect(result.receipt).toEqual(expect.objectContaining({
      id: "lc1",
      userId: "u1",
      version: "2.0-2026-07-20",
      recordedAt: "2026-07-18T08:00:02.000Z"
    }));
  });

  it("returns the original receipt idempotently for the same user and version", async () => {
    const existing = {
      id: "lc1",
      userId: "u1",
      version: "2.0-2026-07-20",
      privacyVersion: "2.0-2026-07-20",
      termsVersion: "2.0-2026-07-20",
      privacyAccepted: true,
      termsAccepted: true,
      adultConfirmed: true,
      acceptedAt: new Date("2026-07-17T08:00:00.000Z"),
      consentedAt: new Date("2026-07-17T08:00:01.000Z"),
      withdrawnAt: null,
      privacyUrl: "https://api.talkandtalk.app/legal/privacy.html",
      termsUrl: "https://api.talkandtalk.app/legal/terms.html",
      source: "wechatMiniProgram"
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      legalConsentReceipt: {
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn()
      }
    };
    prisma.$transaction = jest.fn(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    const result = await service.recordLegalConsent("u1", {
      version: existing.version,
      acceptedAt: "2026-07-18T00:00:00.000Z",
      privacyAccepted: true,
      termsAccepted: true,
      adultConfirmed: true,
      privacyUrl: existing.privacyUrl,
      termsUrl: existing.termsUrl,
      source: "wechatMiniProgram"
    });

    expect(result.receipt.id).toBe("lc1");
    expect(result.receipt.acceptedAt).toBe("2026-07-17T08:00:00.000Z");
    expect(tx.legalConsentReceipt.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects forged legal versions and document URLs before persistence", async () => {
    prisma.$transaction = jest.fn();
    const current = {
      version: "2.0-2026-07-20",
      acceptedAt: "2026-07-18T00:00:00.000Z",
      privacyAccepted: true as const,
      termsAccepted: true as const,
      adultConfirmed: true as const,
      privacyUrl: "https://api.talkandtalk.app/legal/privacy.html",
      termsUrl: "https://api.talkandtalk.app/legal/terms.html",
      source: "wechatMiniProgram" as const
    };

    await expect(service.recordLegalConsent("u1", { ...current, version: "2.0-forged" }))
      .rejects.toMatchObject({ code: "LEGAL_CONSENT_DOCUMENT_MISMATCH" });
    await expect(service.recordLegalConsent("u1", {
      ...current,
      privacyUrl: "https://attacker.example/privacy"
    })).rejects.toMatchObject({ code: "LEGAL_CONSENT_DOCUMENT_MISMATCH" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a client-claimed acceptance time beyond the clock-skew allowance", async () => {
    prisma.$transaction = jest.fn();

    await expect(service.recordLegalConsent("u1", {
      version: "2.0-2026-07-20",
      acceptedAt: "2100-01-01T00:00:00.000Z",
      privacyAccepted: true,
      termsAccepted: true,
      adultConfirmed: true,
      privacyUrl: "https://api.talkandtalk.app/legal/privacy.html",
      termsUrl: "https://api.talkandtalk.app/legal/terms.html",
      source: "wechatMiniProgram"
    })).rejects.toMatchObject({ code: "LEGAL_CONSENT_ACCEPTED_AT_INVALID" });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("only treats the current server-published legal consent as valid", async () => {
    prisma.legalConsentReceipt.findFirst
      .mockResolvedValueOnce({
        id: "lc1",
        userId: "u1",
        version: "2.0-2026-07-20",
        privacyVersion: "2.0-2026-07-20",
        termsVersion: "2.0-2026-07-20",
        privacyAccepted: true,
        termsAccepted: true,
        adultConfirmed: true,
        acceptedAt: new Date("2026-07-19T08:00:00.000Z"),
        consentedAt: new Date("2026-07-19T08:00:01.000Z"),
        withdrawnAt: null,
        privacyUrl: "https://api.talkandtalk.app/legal/privacy.html",
        termsUrl: "https://api.talkandtalk.app/legal/terms.html",
        source: "wechatMiniProgram"
      })
      .mockResolvedValueOnce({
        id: "lc-old",
        userId: "u1",
        version: "2.0-2026-08-01",
        privacyVersion: "2.0-2026-08-01",
        termsVersion: "2.0-2026-08-01",
        privacyAccepted: true,
        termsAccepted: true,
        adultConfirmed: true,
        acceptedAt: new Date("2026-07-19T08:00:00.000Z"),
        consentedAt: new Date("2026-07-19T08:00:01.000Z"),
        withdrawnAt: null,
        privacyUrl: "https://api.talkandtalk.app/legal/privacy.html",
        termsUrl: "https://api.talkandtalk.app/legal/terms.html",
        source: "wechatMiniProgram"
      });

    await expect(service.getLegalConsent("u1", "2.0-2026-07-20"))
      .resolves.toEqual(expect.objectContaining({ valid: true, receipt: expect.objectContaining({ id: "lc1" }) }));
    await expect(service.getLegalConsent("u1", "2.0-2026-08-01"))
      .resolves.toEqual(expect.objectContaining({ valid: false, receipt: expect.objectContaining({ id: "lc-old" }) }));
  });

  it("creates an account deletion request under a user-row lock and returns active requests idempotently", async () => {
    const existing = {
      id: "dr1",
      userId: "u1",
      status: "pending",
      note: null,
      dueAt: new Date("2026-08-07T08:00:00.000Z"),
      policyVersion: "2026.1",
      createdAt: new Date("2026-07-19T08:00:00.000Z"),
      updatedAt: new Date("2026-07-19T08:00:00.000Z")
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "u1",
          role: "user",
          staffCredential: null,
          companionProfile: null
        })
      },
      accountDeletionRequest: {
        findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(existing),
        create: jest.fn()
      }
    };
    prisma.$transaction = jest.fn(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    await expect(service.requestDeletion("u1")).resolves.toEqual(expect.objectContaining({
      id: "dr1",
      status: "pending",
      dueAt: "2026-08-07T08:00:00.000Z",
      policyVersion: "2026.1",
      policy: expect.objectContaining({ businessDays: 15 })
    }));
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.accountDeletionRequest.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("persists the versioned deletion deadline and returns the same SLA facts", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "u1",
          role: "user",
          staffCredential: null,
          companionProfile: null
        })
      },
      accountDeletionRequest: {
        findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({
          id: "dr-new",
          note: null,
          processingStartedAt: null,
          completedAt: null,
          updatedAt: data.createdAt,
          ...data
        }))
      }
    };
    prisma.$transaction = jest.fn(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    const result = await service.requestDeletion("u1");

    expect(tx.accountDeletionRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u1",
        status: "pending",
        createdAt: expect.any(Date),
        dueAt: expect.any(Date),
        policyVersion: "2026.1"
      })
    });
    const persisted = tx.accountDeletionRequest.create.mock.calls[0][0].data;
    expect(persisted.dueAt.toISOString()).toBe(
      new Date(result.dueAt).toISOString()
    );
    expect(result).toEqual(expect.objectContaining({
      id: "dr-new",
      policyVersion: "2026.1",
      overdue: false,
      policy: expect.objectContaining({
        calendarRule: expect.stringContaining("周六和周日"),
        holidayNotice: expect.stringContaining("法定节假日")
      })
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      subjectUserIds: ["u1"],
      action: "account.deletion_requested",
      metadata: expect.objectContaining({
        dueAt: result.dueAt,
        policyVersion: "2026.1"
      })
    }), tx);
  });

  it("rejects workforce accounts before creating a consumer deletion request", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "admin-1",
          role: "admin",
          staffCredential: { id: "credential-1" },
          companionProfile: null
        })
      },
      accountDeletionRequest: {
        findFirst: jest.fn(),
        create: jest.fn()
      }
    };
    prisma.$transaction = jest.fn(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    await expect(service.requestDeletion("admin-1")).rejects.toMatchObject({
      code: "DELETION_STAFF_OFFBOARDING_REQUIRED",
      status: 409
    });
    expect(tx.accountDeletionRequest.findFirst).not.toHaveBeenCalled();
    expect(tx.accountDeletionRequest.create).not.toHaveBeenCalled();
  });

  it("puts a companion into supply-draining without restricting existing-order access", async () => {
    const createdAt = new Date("2026-07-19T08:00:00.000Z");
    const updateResult = { count: 1 };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "companion-user-1",
          role: "companion",
          staffCredential: null,
          companionProfile: { id: "companion-1" }
        }),
        updateMany: jest.fn()
      },
      accountDeletionRequest: {
        findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({
          id: "dr-companion",
          note: null,
          processingStartedAt: null,
          completedAt: null,
          updatedAt: data.createdAt,
          ...data
        }))
      },
      companionProfile: { update: jest.fn().mockResolvedValue({}) },
      companionCommercialProfile: { updateMany: jest.fn().mockResolvedValue(updateResult) },
      companionServiceOffering: { updateMany: jest.fn().mockResolvedValue(updateResult) },
      companionAvailabilityWindow: { updateMany: jest.fn().mockResolvedValue(updateResult) },
      companionRecurringAvailabilityRule: { updateMany: jest.fn().mockResolvedValue(updateResult) },
      companionAvailabilityBlackout: { updateMany: jest.fn().mockResolvedValue(updateResult) },
      companionRecommendationPolicy: { updateMany: jest.fn().mockResolvedValue(updateResult) }
    };
    prisma.$transaction = jest.fn(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    await expect(service.requestDeletion("companion-user-1")).resolves.toEqual(
      expect.objectContaining({ id: "dr-companion", status: "pending" })
    );
    expect(tx.companionProfile.update).toHaveBeenCalledWith({
      where: { id: "companion-1" },
      data: { isPublished: false, isOnline: false, availability: "busy" }
    });
    expect(tx.companionServiceOffering.updateMany).not.toHaveBeenCalled();
    expect(tx.companionAvailabilityWindow.updateMany).not.toHaveBeenCalled();
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(createdAt).toBeInstanceOf(Date);
  });

  it("returns the caller's latest deletion status or null together with the current policy", async () => {
    const request = {
      id: "dr-latest",
      userId: "u1",
      status: "completed",
      processingStartedAt: new Date("2026-07-21T00:00:00.000Z"),
      completedAt: new Date("2026-07-22T00:00:00.000Z"),
      dueAt: new Date("2026-08-07T08:00:00.000Z"),
      policyVersion: "2026.1",
      createdAt: new Date("2026-07-19T08:00:00.000Z"),
      updatedAt: new Date("2026-07-22T00:00:00.000Z")
    };
    prisma.accountDeletionRequest.findFirst
      .mockResolvedValueOnce(request)
      .mockResolvedValueOnce(null);

    await expect(service.getMyDeletionRequest("u1")).resolves.toEqual({
      request: expect.objectContaining({
        id: "dr-latest",
        status: "completed",
        overdue: false,
        dueAt: "2026-08-07T08:00:00.000Z"
      }),
      policy: expect.objectContaining({ version: "2026.1", businessDays: 15 })
    });
    await expect(service.getMyDeletionRequest("u1")).resolves.toEqual({
      request: null,
      policy: expect.objectContaining({ version: "2026.1", businessDays: 15 })
    });
    expect(prisma.accountDeletionRequest.findFirst).toHaveBeenNthCalledWith(1, {
      where: { userId: "u1" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
  });

  it("cancels only the caller's pending deletion while preserving independent account restrictions", async () => {
    const request = {
      id: "dr-pending",
      userId: "u1",
      status: "pending",
      note: null,
      cancelledAt: null,
      companionReactivationRequired: false,
      processingStartedAt: null,
      completedAt: null,
      dueAt: new Date("2026-08-07T08:00:00.000Z"),
      policyVersion: "2026.1",
      createdAt: new Date("2026-07-19T08:00:00.000Z"),
      updatedAt: new Date("2026-07-19T08:01:00.000Z")
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "u1",
          role: "user",
          accountStatus: "restricted",
          staffCredential: null,
          companionProfile: null
        }),
        updateMany: jest.fn()
      },
      accountDeletionRequest: {
        findFirst: jest.fn().mockResolvedValue(request),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      notification: { upsert: jest.fn().mockResolvedValue({ id: "notification-1" }) }
    };
    prisma.$transaction = jest.fn(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    await expect(service.cancelMyDeletionRequest("u1")).resolves.toEqual(expect.objectContaining({
      id: "dr-pending",
      status: "cancelled",
      cancelledAt: expect.any(String),
      canCancel: false,
      companionReactivationRequired: false,
      cancellation: expect.objectContaining({
        idempotent: false,
        accountStatusPreserved: "restricted",
        independentAccountActionsPreserved: true,
        sessionsRestored: false
      })
    }));
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.accountDeletionRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: "dr-pending",
        userId: "u1",
        status: "pending",
        updatedAt: new Date("2026-07-19T08:01:00.000Z")
      },
      data: {
        status: "cancelled",
        cancelledAt: expect.any(Date),
        companionReactivationRequired: false,
        updatedAt: expect.any(Date)
      }
    });
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(tx.notification.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { eventKey: "account-deletion:dr-pending:cancelled" },
      create: expect.objectContaining({
        userId: "u1",
        type: "supportUpdate",
        eventKey: "account-deletion:dr-pending:cancelled"
      }),
      update: {}
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "u1",
      subjectUserIds: ["u1"],
      action: "account.deletion_cancelled",
      metadata: expect.objectContaining({
        accountStatusPreserved: "restricted",
        independentAccountActionsPreserved: true,
        sessionsRestored: false
      })
    }), tx);
  });

  it("keeps cancelled companion supply offline and requires a fresh commercial reactivation review", async () => {
    const updateResult = { count: 1 };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "companion-user-1",
          role: "companion",
          accountStatus: "active",
          staffCredential: null,
          companionProfile: { id: "companion-1" }
        })
      },
      accountDeletionRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "dr-companion",
          userId: "companion-user-1",
          status: "pending",
          note: null,
          cancelledAt: null,
          companionReactivationRequired: false,
          processingStartedAt: null,
          completedAt: null,
          dueAt: new Date("2026-08-07T08:00:00.000Z"),
          policyVersion: "2026.1",
          createdAt: new Date("2026-07-19T08:00:00.000Z"),
          updatedAt: new Date("2026-07-19T08:01:00.000Z")
        }),
        updateMany: jest.fn().mockResolvedValue(updateResult)
      },
      companionProfile: { update: jest.fn().mockResolvedValue({}) },
      companionCommercialProfile: { updateMany: jest.fn().mockResolvedValue(updateResult) },
      companionServiceOffering: { updateMany: jest.fn().mockResolvedValue(updateResult) },
      companionAvailabilityWindow: { updateMany: jest.fn().mockResolvedValue(updateResult) },
      companionRecurringAvailabilityRule: { updateMany: jest.fn().mockResolvedValue(updateResult) },
      companionAvailabilityBlackout: { updateMany: jest.fn().mockResolvedValue(updateResult) },
      companionRecommendationPolicy: { updateMany: jest.fn().mockResolvedValue(updateResult) },
      notification: { upsert: jest.fn().mockResolvedValue({ id: "notification-companion" }) }
    };
    prisma.$transaction = jest.fn(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    const result = await service.cancelMyDeletionRequest("companion-user-1");

    expect(result).toEqual(expect.objectContaining({
      status: "cancelled",
      companionReactivationRequired: true,
      cancellation: expect.objectContaining({
        companionSupply: expect.objectContaining({
          automaticRestore: false,
          reactivationRequired: true,
          state: "manualReviewRequired",
          requirements: expect.arrayContaining([
            "activeAccount",
            "currentAdultEligibility",
            "verifiedCommercialProfile",
            "currentServiceAgreement",
            "reviewedOfferingsAndAvailability",
            "operationsRepublish"
          ])
        })
      })
    }));
    expect(tx.companionProfile.update).toHaveBeenCalledWith({
      where: { id: "companion-1" },
      data: { isPublished: false, isOnline: false, availability: "busy" }
    });
    expect(tx.companionServiceOffering.updateMany).not.toHaveBeenCalled();
    expect(tx.companionAvailabilityWindow.updateMany).not.toHaveBeenCalled();
    expect(tx.companionCommercialProfile.updateMany).toHaveBeenLastCalledWith({
      where: {
        companionId: "companion-1",
        status: "suspended",
        suspendedReason: {
          in: ["account_deletion_draining", "account_deletion_processing"]
        }
      },
      data: {
        suspendedAt: expect.any(Date),
        suspendedById: "companion-user-1",
        suspendedReason: "account_deletion_cancelled_requires_reactivation"
      }
    });
    expect(tx.accountDeletionRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ companionReactivationRequired: true })
    }));
  });

  it("returns a cancelled deletion idempotently without repeating audit or notification", async () => {
    const cancelledAt = new Date("2026-07-20T08:00:00.000Z");
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "u1",
          role: "user",
          accountStatus: "active",
          staffCredential: null,
          companionProfile: null
        })
      },
      accountDeletionRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "dr-cancelled",
          userId: "u1",
          status: "cancelled",
          note: null,
          cancelledAt,
          companionReactivationRequired: false,
          processingStartedAt: null,
          completedAt: null,
          dueAt: new Date("2026-08-07T08:00:00.000Z"),
          policyVersion: "2026.1",
          createdAt: new Date("2026-07-19T08:00:00.000Z"),
          updatedAt: cancelledAt
        }),
        updateMany: jest.fn()
      },
      notification: { upsert: jest.fn() }
    };
    prisma.$transaction = jest.fn(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    await expect(service.cancelMyDeletionRequest("u1")).resolves.toEqual(expect.objectContaining({
      id: "dr-cancelled",
      status: "cancelled",
      cancellation: expect.objectContaining({ idempotent: true })
    }));
    expect(tx.accountDeletionRequest.updateMany).not.toHaveBeenCalled();
    expect(tx.notification.upsert).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each(["processing", "completed", "rejected"])(
    "rejects cancellation after a request reaches %s",
    async (status) => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: "u1",
            role: "user",
            accountStatus: "banned",
            staffCredential: null,
            companionProfile: null
          })
        },
        accountDeletionRequest: {
          findFirst: jest.fn().mockResolvedValue({
            id: `dr-${status}`,
            userId: "u1",
            status,
            updatedAt: new Date()
          }),
          updateMany: jest.fn()
        },
        notification: { upsert: jest.fn() }
      };
      prisma.$transaction = jest.fn(async (callback: (db: any) => Promise<unknown>) => callback(tx));

      await expect(service.cancelMyDeletionRequest("u1")).rejects.toMatchObject({
        code: "DELETION_REQUEST_NOT_CANCELLABLE",
        status: 409,
        details: expect.objectContaining({ status, sessionsRestored: false })
      });
      expect(tx.accountDeletionRequest.updateMany).not.toHaveBeenCalled();
      expect(tx.notification.upsert).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    }
  );

  it("settles a companion-side deletion order as the real customer payer", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      accountDeletionRequest: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ userId: "companion-user-1" })
          .mockResolvedValueOnce({
            userId: "companion-user-1",
            status: "processing",
            user: { companionProfile: { id: "companion-1" } }
          })
      },
      order: {
        findUnique: jest.fn().mockResolvedValue({
          userId: "customer-1",
          companionId: "companion-1"
        })
      }
    };
    prisma.$transaction = jest.fn(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    await expect(service.getDeletionSettlementUserId("dr-companion", "order-1"))
      .resolves.toBe("customer-1");
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("does not expose an unrelated order through deletion settlement", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      accountDeletionRequest: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ userId: "companion-user-1" })
          .mockResolvedValueOnce({
            userId: "companion-user-1",
            status: "processing",
            user: { companionProfile: { id: "companion-1" } }
          })
      },
      order: {
        findUnique: jest.fn().mockResolvedValue({
          userId: "other-customer",
          companionId: "other-companion"
        })
      }
    };
    prisma.$transaction = jest.fn(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    await expect(service.getDeletionSettlementUserId("dr-companion", "other-order"))
      .rejects.toMatchObject({ code: "ORDER_NOT_FOUND", status: 404 });
  });

  it("rejects a second deletion request after the original account deletion completed", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "u1",
          role: "user",
          staffCredential: null,
          companionProfile: null
        })
      },
      accountDeletionRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "dr-completed",
          userId: "u1",
          status: "completed",
          updatedAt: new Date()
        }),
        create: jest.fn()
      }
    };
    prisma.$transaction = jest.fn(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    await expect(service.requestDeletion("u1"))
      .rejects.toMatchObject({ code: "DELETION_ALREADY_COMPLETED" });
    expect(tx.accountDeletionRequest.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("starts a deletion request once and treats a repeated start as idempotent", async () => {
    let status = "pending";
    const request = {
      id: "dr1",
      userId: "u1",
      status,
      note: null,
      createdAt: new Date("2026-07-19T08:00:00.000Z"),
      updatedAt: new Date("2026-07-19T08:01:00.000Z"),
      user: {
        id: "u1",
        role: "user",
        accountStatus: "active",
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        staffCredential: null,
        companionProfile: null
      }
    };
    const zeroCount = jest.fn().mockResolvedValue(0);
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      accountDeletionRequest: {
        updateMany: jest.fn().mockImplementation(() => {
          status = "processing";
          request.status = status;
          return Promise.resolve({ count: 1 });
        }),
        findUnique: jest.fn().mockImplementation(({ select }: any) => Promise.resolve(
          select ? { userId: "u1" } : { ...request, status }
        ))
      },
      user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      order: { count: zeroCount },
      refundTransaction: { count: zeroCount },
      supportTicket: { count: zeroCount },
      paymentDispute: { count: zeroCount },
      attendanceDispute: { count: zeroCount },
      orderRescheduleRequest: { count: zeroCount },
      voiceSession: { count: zeroCount },
      moderationCase: { count: zeroCount },
      moderationAppeal: { count: zeroCount },
      userAccountAppeal: { count: zeroCount },
      dataRightsRequest: { count: zeroCount },
      invoiceRequest: { count: zeroCount },
      identityVerificationRequest: { count: zeroCount },
      refreshToken: {
        findMany: jest.fn().mockResolvedValue([{ id: "session-1" }, { id: "session-2" }]),
        updateMany: jest.fn().mockResolvedValue({ count: 2 })
      }
    };
    prisma.$transaction = jest.fn(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    await expect(service.startDeletionRequest("dr1", "admin1"))
      .resolves.toEqual(expect.objectContaining({ id: "dr1", status: "processing" }));
    await expect(service.startDeletionRequest("dr1", "admin2"))
      .resolves.toEqual(expect.objectContaining({ id: "dr1", status: "processing" }));
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "admin1",
      subjectUserIds: ["u1"],
      action: "account.deletion_processing_started",
      metadata: expect.objectContaining({ accountRestricted: true, revokedRefreshTokenCount: 2 })
    }), tx);
    expect(tx.accountDeletionRequest.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ id: "dr1", status: "pending", updatedAt: expect.any(Date) }),
        data: expect.objectContaining({
          status: "processing",
          processingStartedById: "admin1",
          processingStartedAt: expect.any(Date)
        })
      })
    );
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: "u1", accountStatus: "active" },
      data: { accountStatus: "restricted" }
    });
    expect(tx.refreshToken.updateMany).toHaveBeenCalledTimes(1);
    expect(authTombstones.installForDeletionTx).toHaveBeenCalledTimes(1);
    expect(authTombstones.installForDeletionTx).toHaveBeenCalledWith(
      tx,
      "dr1",
      "u1",
      expect.any(Date)
    );
  });

  it("does not restrict a companion until provider-side obligations have drained", async () => {
    const zeroCount = jest.fn().mockResolvedValue(0);
    const pending = {
      id: "dr-companion",
      userId: "companion-user-1",
      status: "pending",
      note: null,
      createdAt: new Date("2026-07-19T08:00:00.000Z"),
      updatedAt: new Date("2026-07-19T08:01:00.000Z"),
      user: {
        id: "companion-user-1",
        role: "companion",
        accountStatus: "active",
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        staffCredential: null,
        companionProfile: { id: "companion-1" }
      }
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      accountDeletionRequest: {
        findUnique: jest.fn().mockImplementation(({ select }: any) => Promise.resolve(
          select ? { userId: pending.userId } : pending
        )),
        updateMany: jest.fn()
      },
      order: { count: jest.fn().mockResolvedValue(1) },
      refundTransaction: { count: zeroCount },
      supportTicket: { count: zeroCount },
      paymentDispute: { count: zeroCount },
      attendanceDispute: { count: zeroCount },
      orderRescheduleRequest: { count: zeroCount },
      voiceSession: { count: zeroCount },
      moderationCase: { count: zeroCount },
      moderationAppeal: { count: zeroCount },
      userAccountAppeal: { count: zeroCount },
      dataRightsRequest: { count: zeroCount },
      invoiceRequest: { count: zeroCount },
      identityVerificationRequest: { count: zeroCount },
      companionEarning: { count: zeroCount },
      companionWithdrawalRequest: { count: zeroCount },
      companionRecovery: { count: zeroCount },
      companionAccountAppeal: { count: zeroCount },
      companionIncidentReport: { count: zeroCount },
      user: { updateMany: jest.fn() },
      refreshToken: { updateMany: jest.fn() }
    };
    prisma.$transaction = jest.fn(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    await expect(service.startDeletionRequest("dr-companion", "admin-1"))
      .rejects.toMatchObject({
        code: "DELETION_HAS_ACTIVE_OBLIGATIONS",
        details: expect.objectContaining({
          counts: expect.objectContaining({ orders: 1, companionEarnings: 0 })
        })
      });
    expect(tx.accountDeletionRequest.updateMany).not.toHaveBeenCalled();
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it("records immutable second-person approval and queues erasure without claiming completion", async () => {
    const processingStartedAt = new Date(Date.now() - 120_000);
    const processing = {
      id: "dr1",
      userId: "u1",
      status: "processing",
      note: null,
      processingStartedById: "admin-start",
      processingStartedAt,
      approvedById: null,
      approvedAt: null,
      executionStatus: "idle",
      executionPhase: "awaiting_second_review",
      executionAttemptCount: 0,
      executionFailureCount: 0,
      executionProcessedCount: 0,
      completedById: null,
      completedAt: null,
      createdAt: new Date("2026-07-19T08:00:00.000Z"),
      updatedAt: processingStartedAt,
      user: {
        id: "u1",
        role: "user",
        accountStatus: "restricted",
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        staffCredential: null,
        companionProfile: null
      }
    };
    const zeroCount = jest.fn().mockResolvedValue(0);
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      accountDeletionRequest: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn()
          .mockResolvedValueOnce({ userId: "u1" })
          .mockResolvedValueOnce(processing)
      },
      order: { count: zeroCount },
      refundTransaction: { count: zeroCount },
      supportTicket: { count: zeroCount },
      paymentDispute: { count: zeroCount },
      attendanceDispute: { count: zeroCount },
      orderRescheduleRequest: { count: zeroCount },
      voiceSession: { count: zeroCount },
      moderationCase: { count: zeroCount },
      moderationAppeal: { count: zeroCount },
      userAccountAppeal: { count: zeroCount },
      dataRightsRequest: { count: zeroCount },
      invoiceRequest: { count: zeroCount },
      identityVerificationRequest: { count: zeroCount },
      refreshToken: { deleteMany: jest.fn() },
      authIdentity: { deleteMany: jest.fn() },
      user: { update: jest.fn() },
      accountDataRetentionRecord: { createMany: jest.fn() }
    };
    prisma.$transaction = jest.fn(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    await expect(service.completeDeletionRequest("dr1", "admin-approve", "  independently reviewed  "))
      .resolves.toEqual(expect.objectContaining({
        id: "dr1",
        status: "processing",
        approvedById: "admin-approve",
        approvedAt: expect.any(String),
        execution: expect.objectContaining({
          status: "queued",
          phase: "pending_customer_adult_eligibility",
          processedCount: 0
        }),
        user: expect.objectContaining({ accountStatus: "restricted" })
      }));
    expect(tx.accountDeletionRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "dr1",
        status: "processing",
        approvedAt: null,
        executionStatus: "idle"
      }),
      data: expect.objectContaining({
        approvedById: "admin-approve",
        approvalNote: "independently reviewed",
        retentionApprovalReference: "legal-approval-2026-001",
        executionStatus: "queued",
        executionPhase: "pending_customer_adult_eligibility"
      })
    }));
    expect(tx.refreshToken.deleteMany).not.toHaveBeenCalled();
    expect(tx.authIdentity.deleteMany).not.toHaveBeenCalled();
    expect(tx.accountDataRetentionRecord.createMany).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(authTombstones.assertCoverageTx).toHaveBeenCalledWith(tx, "dr1", "u1");
    expect(authTombstones.sealExpiryForDeletionTx).toHaveBeenCalledWith(
      tx,
      "dr1",
      expect.any(Date)
    );
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "admin-approve",
      subjectUserIds: ["u1"],
      action: "account.deletion_execution_queued"
    }), tx);
  });

  it("fails closed before touching the database when the retention schedule lacks external approval", async () => {
    config.get.mockImplementation((key: string) =>
      key === "ACCOUNT_DELETION_RETENTION_POLICY_APPROVED" ? false : ""
    );
    prisma.$transaction = jest.fn();

    await expect(service.completeDeletionRequest("dr1", "admin1", "reviewed"))
      .rejects.toMatchObject({
        code: "DELETION_RETENTION_POLICY_NOT_APPROVED",
        status: 503,
        details: { policyVersion: "2026.2-technical-baseline" }
      });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("repairs and approves a missing legacy ledger on an idempotent completion retry", async () => {
    const completedAt = new Date("2026-07-22T00:00:00.000Z");
    const completed = {
      id: "dr-legacy",
      userId: "u1",
      status: "completed",
      note: "legacy completion",
      processingStartedById: "admin-start",
      processingStartedAt: new Date("2026-07-21T00:00:00.000Z"),
      completedById: "admin-complete",
      completedAt,
      dueAt: new Date("2026-08-07T00:00:00.000Z"),
      policyVersion: "2026.1",
      createdAt: new Date("2026-07-20T00:00:00.000Z"),
      updatedAt: completedAt,
      user: {
        id: "u1",
        role: "user",
        accountStatus: "banned",
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        staffCredential: null,
        companionProfile: null
      }
    };
    const tx = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ recordCount: "7" }]),
      accountDeletionRequest: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ userId: "u1" })
          .mockResolvedValueOnce(completed)
      }
    };
    prisma.$transaction = jest.fn(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    await expect(service.completeDeletionRequest("dr-legacy", "admin-retry", "reviewed"))
      .resolves.toEqual(expect.objectContaining({ id: "dr-legacy", status: "completed" }));

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    const repairQuery = Array.from(tx.$queryRaw.mock.calls[1][0] as string[]).join("");
    expect(repairQuery).toContain("ensure_completed_account_deletion_retention_ledger");
    expect(tx.$queryRaw.mock.calls[1].slice(1)).toEqual([
      "dr-legacy",
      "legal-approval-2026-001"
    ]);
  });

  it("requires a different administrator to complete a started account deletion", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      accountDeletionRequest: {
        updateMany: jest.fn(),
        findUnique: jest.fn()
          .mockResolvedValueOnce({ userId: "u1" })
          .mockResolvedValueOnce({
            id: "dr1",
            userId: "u1",
            status: "processing",
            note: null,
            processingStartedById: "admin1",
            processingStartedAt: new Date(Date.now() - 120_000),
            completedById: null,
            completedAt: null,
            createdAt: new Date(Date.now() - 180_000),
            updatedAt: new Date(Date.now() - 120_000),
            user: { id: "u1", role: "user", accountStatus: "restricted", createdAt: new Date() }
          })
      },
      order: { count: jest.fn() },
      refundTransaction: { count: jest.fn() }
    };
    prisma.$transaction = jest.fn(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    await expect(service.completeDeletionRequest("dr1", "admin1", "reviewed"))
      .rejects.toMatchObject({
        code: "DELETION_SECOND_REVIEW_REQUIRED",
        status: 403
      });
    expect(tx.order.count).not.toHaveBeenCalled();
    expect(tx.accountDeletionRequest.updateMany).not.toHaveBeenCalled();
  });

  it("blocks completion while active orders remain and performs no anonymization", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      accountDeletionRequest: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn()
          .mockResolvedValueOnce({ userId: "u1" })
          .mockResolvedValueOnce({
            id: "dr1",
            userId: "u1",
            status: "processing",
            note: null,
            processingStartedById: "admin-start",
            processingStartedAt: new Date(Date.now() - 120_000),
            completedById: null,
            completedAt: null,
            createdAt: new Date("2026-07-19T07:00:00.000Z"),
            updatedAt: new Date(Date.now() - 120_000),
            user: { id: "u1", role: "user", accountStatus: "restricted", createdAt: new Date() }
          })
      },
      order: { count: jest.fn().mockResolvedValue(1) },
      refundTransaction: { count: jest.fn().mockResolvedValue(0) },
      supportTicket: { count: jest.fn().mockResolvedValue(0) },
      paymentDispute: { count: jest.fn().mockResolvedValue(0) },
      attendanceDispute: { count: jest.fn().mockResolvedValue(0) },
      orderRescheduleRequest: { count: jest.fn().mockResolvedValue(0) },
      voiceSession: { count: jest.fn().mockResolvedValue(0) },
      moderationCase: { count: jest.fn().mockResolvedValue(0) },
      moderationAppeal: { count: jest.fn().mockResolvedValue(0) },
      userAccountAppeal: { count: jest.fn().mockResolvedValue(0) },
      dataRightsRequest: { count: jest.fn().mockResolvedValue(0) },
      invoiceRequest: { count: jest.fn().mockResolvedValue(0) },
      identityVerificationRequest: { count: jest.fn().mockResolvedValue(0) },
      refreshToken: { deleteMany: jest.fn() },
      authIdentity: { deleteMany: jest.fn() },
      staffCredential: { deleteMany: jest.fn() },
      userProfile: { deleteMany: jest.fn() },
      user: { update: jest.fn() }
    };
    prisma.$transaction = jest.fn(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    await expect(service.completeDeletionRequest("dr1", "admin1", "reviewed"))
      .rejects.toMatchObject({
        code: "DELETION_HAS_ACTIVE_OBLIGATIONS",
        details: expect.objectContaining({
          total: 1,
          counts: expect.objectContaining({ orders: 1 })
        })
      });
    expect(tx.refreshToken.deleteMany).not.toHaveBeenCalled();
    expect(tx.authIdentity.deleteMany).not.toHaveBeenCalled();
    expect(tx.userProfile.deleteMany).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("returns deletion settlement details without exposing user profile data", async () => {
    prisma.accountDeletionRequest.findUnique.mockResolvedValue({
      id: "dr1",
      userId: "u1",
      status: "processing",
      note: null,
      createdAt: new Date("2026-07-19T00:00:00.000Z"),
      updatedAt: new Date("2026-07-19T00:05:00.000Z"),
      user: { id: "u1", role: "user", accountStatus: "restricted", createdAt: new Date("2026-07-01T00:00:00.000Z") }
    });
    prisma.order.findMany.mockResolvedValue([{
      id: "o1",
      userId: "u1",
      status: "paid",
      amountCents: 3900,
      scheduledAt: new Date("2026-07-20T10:00:00.000Z"),
      payments: [{ id: "p1", outTradeNo: "T1", status: "success", expiresAt: null }],
      refunds: []
    }]);
    prisma.order.count.mockResolvedValueOnce(26).mockResolvedValueOnce(0);
    for (const delegate of [
      prisma.refundTransaction,
      prisma.supportTicket,
      prisma.paymentDispute,
      prisma.attendanceDispute,
      prisma.orderRescheduleRequest,
      prisma.voiceSession,
      prisma.moderationCase,
      prisma.moderationAppeal,
      prisma.userAccountAppeal,
      prisma.dataRightsRequest,
      prisma.invoiceRequest,
      prisma.identityVerificationRequest
    ]) delegate.count.mockResolvedValue(0);

    const result = await service.getDeletionSettlementDetails("dr1", 2, 25);

    expect(result).toEqual(expect.objectContaining({
      request: expect.objectContaining({ id: "dr1", userId: "u1", status: "processing" }),
      blockingObligations: {
        clear: true,
        total: 0,
        counts: expect.objectContaining({ orders: 0, supportTickets: 0, dataRightsRequests: 0 })
      },
      retentionPolicy: {
        version: "2026.2-technical-baseline",
        approved: true,
        approvalReference: "legal-approval-2026-001"
      },
      orders: [expect.objectContaining({
        id: "o1",
        relationship: "customer",
        payment: { id: "p1", outTradeNo: "T1", status: "success", expiresAt: null },
        refund: null
      })],
      pagination: { page: 2, pageSize: 25, total: 26, totalPages: 2 }
    }));
    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "u1" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: 25,
      take: 25
    }));
    expect(prisma.order.count).toHaveBeenNthCalledWith(1, { where: { userId: "u1" } });
  });

  describe("retained snapshot final gate", () => {
    const approvedAt = new Date("2026-08-01T08:00:00.000Z");

    function finalGateHarness() {
      const progressRows = ACCOUNT_DELETION_RETAINED_SNAPSHOT_REGISTRY.map((source) => ({
        id: `progress-${source.category}-${source.sourceKey}`,
        category: source.category,
        sourceKey: source.sourceKey,
        highWaterAt: approvedAt,
        cursorCreatedAt: new Date("2026-08-01T07:00:00.000Z") as Date | null,
        cursorId: `${source.sourceKey}-last` as string | null,
        observedCount: 1,
        completedAt: new Date("2026-08-01T08:01:00.000Z") as Date | null
      }));
      const executionRetainedCounts = progressRows.reduce<Record<string, number>>(
        (counts, row) => {
          counts[row.category] = (counts[row.category] ?? 0) + row.observedCount;
          return counts;
        },
        {}
      );
      const db = {
        $executeRawUnsafe: jest.fn().mockResolvedValue(0),
        $queryRaw: jest.fn(async (input: any) => (
          Array.isArray(input) ? progressRows : [{ exists: false }]
        ))
      } as any;
      const request = {
        id: "deletion-final-1",
        userId: "user-final-1",
        companionIdSnapshot: "companion-final-1",
        approvedAt,
        executionRetainedCounts
      };
      return { db, progressRows, request };
    }

    it("requires the exact completed registry and reconciles every category aggregate", async () => {
      const { db, request } = finalGateHarness();

      await expect((service as any).assertRetainedSnapshotFinalGate(db, request)).resolves.toEqual({
        transactions_tax_invoices: 16,
        support_disputes_safety: 25,
        consent_rights_account_governance: 10
      });

      expect(db.$executeRawUnsafe.mock.calls.map(([sql]: [string]) => sql)).toEqual([
        "SET LOCAL statement_timeout = '3000ms'",
        "SET LOCAL lock_timeout = '500ms'"
      ]);
      expect(db.$queryRaw).toHaveBeenCalledTimes(52);
      const queries = db.$queryRaw.mock.calls.map(([query]: [any]) => retainedQueryText(query));
      expect(queries[0]).toContain('FROM "AccountDeletionRetentionSnapshotProgress"');
      expect(queries[0]).toContain("FOR UPDATE");
      expect(queries.join("\n")).not.toContain("SKIP LOCKED");
    });

    it("fails finalization when one expected progress source is absent", async () => {
      const { db, progressRows, request } = finalGateHarness();
      progressRows.pop();

      await expect((service as any).assertRetainedSnapshotFinalGate(db, request))
        .rejects.toThrow("final registry is incomplete");
      expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it("fails finalization on a changed high-water or an incomplete source", async () => {
      const highWaterHarness = finalGateHarness();
      highWaterHarness.progressRows[0].highWaterAt = new Date("2026-08-01T08:00:00.001Z");
      await expect((service as any).assertRetainedSnapshotFinalGate(
        highWaterHarness.db,
        highWaterHarness.request
      )).rejects.toThrow("high-water changed");

      const incompleteHarness = finalGateHarness();
      incompleteHarness.progressRows[0].completedAt = null;
      await expect((service as any).assertRetainedSnapshotFinalGate(
        incompleteHarness.db,
        incompleteHarness.request
      )).rejects.toThrow("source is incomplete");
    });

    it("fails finalization before ledger creation when an approval-late row exists", async () => {
      const { db, request } = finalGateHarness();
      db.$queryRaw.mockImplementation(async (input: any) => {
        if (Array.isArray(input)) {
          return ACCOUNT_DELETION_RETAINED_SNAPSHOT_REGISTRY.map((source) => ({
            id: `progress-${source.category}-${source.sourceKey}`,
            category: source.category,
            sourceKey: source.sourceKey,
            highWaterAt: approvedAt,
            cursorCreatedAt: null,
            cursorId: null,
            observedCount: 1,
            completedAt: new Date("2026-08-01T08:01:00.000Z")
          }));
        }
        return [{ exists: retainedQueryText(input).includes('FROM "LegalConsentReceipt"') }];
      });

      await expect((service as any).assertRetainedSnapshotFinalGate(db, request))
        .rejects.toThrow(
          "late arrival: consent_rights_account_governance/legal_consent_receipts"
        );
      const lateQueries = db.$queryRaw.mock.calls.slice(1)
        .map(([query]: [any]) => retainedQueryText(query));
      expect(lateQueries.some((query: string) => query.includes('"stableTime" >'))).toBe(true);
    });

    it("rejects an aggregate that does not exactly match durable source counts", async () => {
      const { db, request } = finalGateHarness();
      request.executionRetainedCounts.transactions_tax_invoices += 1;

      await expect((service as any).assertRetainedSnapshotFinalGate(db, request))
        .rejects.toThrow("aggregate mismatch: transactions_tax_invoices");
      expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });
});
