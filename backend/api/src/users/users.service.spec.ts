import { UsersService } from "./users.service";

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
      findUnique: jest.fn()
    },
    order: {
      findMany: jest.fn()
    }
  } as any;

  const audit = { record: jest.fn().mockResolvedValue({}) } as any;
  const legalArchive = { assertVersionPublished: jest.fn().mockResolvedValue(undefined) } as any;
  const moderation = { moderateAsync: jest.fn() } as any;
  const moderationCases = { createFromResult: jest.fn() } as any;
  const legalDefinition = {
    API_PREFIX: "api/v1",
    LEGAL_CONSENT_VERSION: "2.0-2026-07-20",
    LEGAL_PRIVACY_URL: "https://api.talkandtalk.app/legal/privacy.html",
    LEGAL_TERMS_URL: "https://api.talkandtalk.app/legal/terms.html"
  };
  const config = {
    getOrThrow: jest.fn((key: keyof typeof legalDefinition) => legalDefinition[key])
  } as any;
  let service: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    moderation.moderateAsync.mockResolvedValue({ decision: "allow" });
    service = new UsersService(prisma, audit, config, legalArchive, moderation, moderationCases);
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
      source: "wechatMiniProgram"
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
      source: "wechatMiniProgram"
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
        source: "wechatMiniProgram"
      })
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "u1",
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
      createdAt: new Date("2026-07-19T08:00:00.000Z"),
      updatedAt: new Date("2026-07-19T08:00:00.000Z")
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      accountDeletionRequest: {
        findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(existing),
        create: jest.fn()
      }
    };
    prisma.$transaction = jest.fn(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    await expect(service.requestDeletion("u1")).resolves.toEqual(expect.objectContaining({
      id: "dr1",
      status: "pending"
    }));
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.accountDeletionRequest.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects a second deletion request after the original account deletion completed", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
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
    const processing = {
      id: "dr1",
      userId: "u1",
      status: "processing",
      note: null,
      createdAt: new Date("2026-07-19T08:00:00.000Z"),
      updatedAt: new Date("2026-07-19T08:01:00.000Z"),
      user: {
        id: "u1",
        role: "user",
        accountStatus: "active",
        createdAt: new Date("2026-07-01T00:00:00.000Z")
      }
    };
    const claims = [{ count: 1 }, { count: 0 }];
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      accountDeletionRequest: {
        updateMany: jest.fn().mockImplementation(() => Promise.resolve(claims.shift())),
        findUnique: jest.fn().mockResolvedValue(processing)
      },
      user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) }
    };
    prisma.$transaction = jest.fn(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    await expect(service.startDeletionRequest("dr1", "admin1"))
      .resolves.toEqual(expect.objectContaining({ id: "dr1", status: "processing" }));
    await expect(service.startDeletionRequest("dr1", "admin2"))
      .resolves.toEqual(expect.objectContaining({ id: "dr1", status: "processing" }));
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "admin1",
      action: "account.deletion_processing_started",
      metadata: expect.objectContaining({ accountRestricted: true, revokedRefreshTokenCount: 2 })
    }), tx);
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: "u1", accountStatus: "active" },
      data: { accountStatus: "restricted" }
    });
    expect(tx.refreshToken.updateMany).toHaveBeenCalledTimes(1);
  });

  it("completes deletion atomically while retaining finance records and anonymizing identity data", async () => {
    const processing = {
      id: "dr1",
      userId: "u1",
      status: "processing",
      note: null,
      createdAt: new Date("2026-07-19T08:00:00.000Z"),
      updatedAt: new Date(Date.now() - 120_000),
      user: {
        id: "u1",
        role: "user",
        accountStatus: "active",
        createdAt: new Date("2026-07-01T00:00:00.000Z")
      }
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      accountDeletionRequest: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn()
          .mockResolvedValueOnce({ userId: "u1" })
          .mockResolvedValueOnce(processing)
      },
      order: { count: jest.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(2) },
      paymentTransaction: { count: jest.fn().mockResolvedValue(2) },
      refundTransaction: { count: jest.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1) },
      refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
      authIdentity: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      staffCredential: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      userProfile: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      user: { update: jest.fn().mockResolvedValue({ id: "u1", accountStatus: "banned" }) }
    };
    prisma.$transaction = jest.fn(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    await expect(service.completeDeletionRequest("dr1", "admin1", "  identity verified by support  "))
      .resolves.toEqual(expect.objectContaining({
        id: "dr1",
        status: "completed",
        user: expect.objectContaining({ accountStatus: "banned" }),
        retainedRecords: { orders: 2, payments: 2, refunds: 1 }
      }));
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "u1", revokedAt: null }
    }));
    expect(tx.authIdentity.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
    expect(tx.staffCredential.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
    expect(tx.userProfile.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
      data: {
        displayName: null,
        phone: null,
        age: null,
        gender: null,
        isVerified: false,
        safetyScore: 80
      }
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { accountStatus: "banned" }
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "admin1",
      action: "account.deletion_completed",
      metadata: expect.objectContaining({
        retainedOrderCount: 2,
        retainedPaymentCount: 2,
        retainedRefundCount: 1,
        removedStaffCredentialCount: 1
      })
    }), tx);
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
            createdAt: new Date("2026-07-19T07:00:00.000Z"),
            updatedAt: new Date(Date.now() - 120_000),
            user: { id: "u1", role: "user", accountStatus: "restricted", createdAt: new Date() }
          })
      },
      order: { count: jest.fn().mockResolvedValue(1) },
      refundTransaction: { count: jest.fn().mockResolvedValue(0) },
      refreshToken: { updateMany: jest.fn() },
      authIdentity: { deleteMany: jest.fn() },
      staffCredential: { deleteMany: jest.fn() },
      userProfile: { updateMany: jest.fn() },
      user: { update: jest.fn() }
    };
    prisma.$transaction = jest.fn(async (callback: (db: any) => Promise<unknown>) => callback(tx));

    await expect(service.completeDeletionRequest("dr1", "admin1", "reviewed"))
      .rejects.toMatchObject({ code: "DELETION_HAS_ACTIVE_FINANCIAL_OBLIGATIONS" });
    expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(tx.authIdentity.deleteMany).not.toHaveBeenCalled();
    expect(tx.userProfile.updateMany).not.toHaveBeenCalled();
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
      status: "paid",
      amountCents: 3900,
      scheduledAt: new Date("2026-07-20T10:00:00.000Z"),
      payments: [{ id: "p1", outTradeNo: "T1", status: "success", expiresAt: null }],
      refunds: []
    }]);

    const result = await service.getDeletionSettlementDetails("dr1");

    expect(result).toEqual(expect.objectContaining({
      request: expect.objectContaining({ id: "dr1", userId: "u1", status: "processing" }),
      orders: [expect.objectContaining({
        id: "o1",
        payment: { id: "p1", outTradeNo: "T1", status: "success", expiresAt: null },
        refund: null
      })]
    }));
    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "u1" }
    }));
  });
});
