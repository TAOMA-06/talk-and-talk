import { CommercialService } from "./commercial.service";

describe("CommercialService", () => {
  const prisma = { $queryRaw: jest.fn(), $transaction: jest.fn() } as any;
  const config = { get: jest.fn().mockReturnValue(24) } as any;
  const audit = { record: jest.fn().mockResolvedValue({}) } as any;
  let service: CommercialService;

  const earning = (overrides: Record<string, unknown> = {}) => ({
    id: "e1", orderId: "o1", companionId: "c1", grossCents: 10000, platformFeeBps: 1000,
    platformFeeCents: 1000, payableCents: 9000, status: "available", availableAt: new Date(),
    payoutSubmittedAt: null, payoutSubmittedById: null, paidAt: null, paidReference: null,
    paidAmountCents: null, paidRecipientRef: null, payoutEvidenceDigest: null,
    settlementRecipientRefSnapshot: "recipient-c1", settlementRecipientMaskedSnapshot: "****1234",
    taxProfileRefSnapshot: "tax-c1", identityEvidenceRefSnapshot: "identity-evidence-c1",
    serviceAgreementVersionSnapshot: "v1", serviceAgreementEvidenceRefSnapshot: "agreement-evidence-c1",
    holdReason: null, createdAt: new Date(), updatedAt: new Date(),
    order: { scheduledAt: new Date(), status: "completed", amountCents: 10000, companionNameSnapshot: "林屿" },
    companion: { id: "c1", name: "林屿", ownerUserId: "u-companion", commercialProfile: { status: "verified" } },
    ...overrides
  });

  function dbFor(current: any, updateResult: any = current, blockers: { support?: any; refund?: any } = {}) {
    return {
      $queryRaw: jest.fn(),
      companionEarning: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ orderId: current.orderId })
          .mockResolvedValueOnce(current),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue(updateResult),
        updateMany: jest.fn()
      },
      order: { findUnique: jest.fn().mockResolvedValue({ completedAt: null, refundRequestDeadlineAt: null }) },
      companionRecovery: { findFirst: jest.fn().mockResolvedValue(null) },
      supportTicket: { findFirst: jest.fn().mockResolvedValue(blockers.support ?? null) },
      refundTransaction: { findFirst: jest.fn().mockResolvedValue(blockers.refund ?? null) },
      auditLog: { create: jest.fn() }
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    config.get.mockReturnValue(24);
    service = new CommercialService(prisma, config, audit);
  });

  it("stops new payout claims when the operational hard switch is paused", async () => {
    config.get.mockImplementation((key: string) => key === "PAYOUT_CLAIMS_ENABLED" ? false : 24);
    service = new CommercialService(prisma, config, audit);

    await expect(service.claimPayout("admin-1", "e1")).rejects.toMatchObject({
      code: "PAYOUT_CLAIMS_PAUSED"
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("claims an available earning before an operator performs a manual payout", async () => {
    const current = earning();
    const db = dbFor(current, earning({
      status: "held", holdReason: "payout_execution_claimed", payoutSubmittedAt: new Date(), payoutSubmittedById: "admin-1"
    }));
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    const result = await service.claimPayout("admin-1", "e1");

    expect(result.status).toBe("held");
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
    expect(db.companionEarning.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "held", holdReason: "payout_execution_claimed", payoutSubmittedById: "admin-1" })
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "commercial.earning_payout_claimed" }), db);
  });

  it("requires the payout claimant to record transfer evidence", async () => {
    const claimed = earning({
      status: "held", holdReason: "payout_execution_claimed", payoutSubmittedAt: new Date(), payoutSubmittedById: "admin-1"
    });
    const db = dbFor(claimed, earning({
      status: "held", holdReason: "payout_verification_pending", payoutSubmittedAt: new Date(),
      payoutSubmittedById: "admin-1", paidReference: "WX-REF-1"
    }));
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    const result = await service.recordPayoutEvidence("admin-1", "e1", {
      paidReference: " WX-REF-1 ",
      paidAmountCents: 9000,
      paidRecipientRef: "recipient-c1",
      payoutEvidenceDigest: "a".repeat(64)
    });

    expect(result.status).toBe("held");
    expect(db.companionEarning.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ holdReason: "payout_verification_pending", paidReference: "WX-REF-1" })
    }));
  });

  it("lets a different administrator release an abandoned claim only with no-transfer evidence", async () => {
    const claimed = earning({
      status: "held",
      holdReason: "payout_execution_claimed",
      payoutSubmittedAt: new Date(),
      payoutSubmittedById: "admin-1"
    });
    const snapshot = {
      companionId: claimed.companionId,
      settlementRecipientRefSnapshot: claimed.settlementRecipientRefSnapshot,
      settlementRecipientMaskedSnapshot: claimed.settlementRecipientMaskedSnapshot,
      taxProfileRefSnapshot: claimed.taxProfileRefSnapshot,
      identityEvidenceRefSnapshot: claimed.identityEvidenceRefSnapshot,
      serviceAgreementVersionSnapshot: claimed.serviceAgreementVersionSnapshot,
      serviceAgreementEvidenceRefSnapshot: claimed.serviceAgreementEvidenceRefSnapshot
    };
    const db = {
      $queryRaw: jest.fn(),
      companionEarning: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ orderId: claimed.orderId })
          .mockResolvedValueOnce(claimed)
          .mockResolvedValueOnce(snapshot),
        update: jest.fn().mockResolvedValue(earning({ status: "available" }))
      },
      order: {
        findUnique: jest.fn().mockResolvedValue({
          completedAt: new Date(Date.now() - 7 * 24 * 60 * 60_000),
          refundRequestDeadlineAt: new Date(Date.now() - 4 * 24 * 60 * 60_000)
        })
      },
      companionCommercialProfile: { findUnique: jest.fn().mockResolvedValue({ status: "verified" }) },
      companionRecovery: { findFirst: jest.fn().mockResolvedValue(null) },
      supportTicket: { findFirst: jest.fn().mockResolvedValue(null) },
      refundTransaction: { findFirst: jest.fn().mockResolvedValue(null) }
    } as any;
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    const result = await service.cancelPayoutClaim("admin-2", "e1", {
      reason: "领取人离岗，财务渠道确认未发生转账",
      noTransferEvidenceReference: "finance-case/no-transfer-001",
      evidenceDigest: "b".repeat(64)
    });

    expect(result.status).toBe("available");
    expect(db.companionEarning.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "available",
        payoutSubmittedAt: null,
        payoutSubmittedById: null
      })
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "commercial.earning_payout_claim_cancelled",
      metadata: expect.objectContaining({ originalClaimantId: "admin-1" })
    }), db);
  });

  it("requires a second administrator to verify a submitted payout", async () => {
    const submitted = earning({
      status: "held", holdReason: "payout_verification_pending", payoutSubmittedAt: new Date(),
      payoutSubmittedById: "admin-1", paidReference: "WX-REF-1", paidAmountCents: 9000,
      paidRecipientRef: "recipient-c1", payoutEvidenceDigest: "a".repeat(64)
    });
    const db = dbFor(submitted, earning({
      status: "paid", paidAt: new Date(), payoutSubmittedAt: submitted.payoutSubmittedAt,
      payoutSubmittedById: "admin-1", paidReference: "WX-REF-1"
    }));
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    const result = await service.verifyPayout("admin-2", "e1");

    expect(result.status).toBe("paid");
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "commercial.earning_payout_verified" }), db);
  });

  it("does not let the payout claimant self-verify", async () => {
    const submitted = earning({
      status: "held", holdReason: "payout_verification_pending", payoutSubmittedAt: new Date(),
      payoutSubmittedById: "admin-1", paidReference: "WX-REF-1", paidAmountCents: 9000,
      paidRecipientRef: "recipient-c1", payoutEvidenceDigest: "a".repeat(64)
    });
    const db = dbFor(submitted);
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    await expect(service.verifyPayout("admin-1", "e1")).rejects.toMatchObject({
      code: "EARNING_PAYOUT_SECOND_REVIEW_REQUIRED"
    });
  });

  it("commits a protective hold before reporting an unresolved-support conflict", async () => {
    const current = earning();
    const db = dbFor(current, earning({ status: "held", holdReason: "unresolved_support_ticket" }), { support: { id: "ticket-1" } });
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    await expect(service.claimPayout("admin-1", "e1")).rejects.toMatchObject({ code: "EARNING_HELD_FOR_SUPPORT" });
    expect(db.companionEarning.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "held", holdReason: "unresolved_support_ticket" }
    }));
  });

  it("keeps payout frozen when a failed refund still requires reconciliation", async () => {
    const current = earning();
    const db = dbFor(
      current,
      earning({ status: "held", holdReason: "refund_attention_required" }),
      { refund: { id: "refund-1", status: "failed" } }
    );
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    await expect(service.claimPayout("admin-1", "e1")).rejects.toMatchObject({
      code: "EARNING_HELD_FOR_FAILED_REFUND"
    });
    expect(db.companionEarning.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "held", holdReason: "refund_attention_required" }
    }));
  });

  it("does not promote matured funds when the current commercial profile is suspended", async () => {
    const current = earning({ status: "pending", availableAt: new Date(Date.now() - 60_000) });
    const db = {
      $queryRaw: jest.fn(),
      companionEarning: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(current)
          .mockResolvedValueOnce({
            companionId: current.companionId,
            settlementRecipientRefSnapshot: current.settlementRecipientRefSnapshot,
            settlementRecipientMaskedSnapshot: current.settlementRecipientMaskedSnapshot,
            taxProfileRefSnapshot: current.taxProfileRefSnapshot,
            identityEvidenceRefSnapshot: current.identityEvidenceRefSnapshot,
            serviceAgreementVersionSnapshot: current.serviceAgreementVersionSnapshot,
            serviceAgreementEvidenceRefSnapshot: current.serviceAgreementEvidenceRefSnapshot
          }),
        update: jest.fn().mockResolvedValue({})
      },
      order: {
        findUnique: jest.fn().mockResolvedValue({
          completedAt: new Date(Date.now() - 7 * 24 * 60 * 60_000),
          refundRequestDeadlineAt: new Date(Date.now() - 4 * 24 * 60 * 60_000)
        })
      },
      companionCommercialProfile: { findUnique: jest.fn().mockResolvedValue({ status: "suspended" }) },
      companionRecovery: { findFirst: jest.fn().mockResolvedValue(null) },
      supportTicket: { findFirst: jest.fn().mockResolvedValue(null) },
      refundTransaction: { findFirst: jest.fn().mockResolvedValue(null) }
    } as any;
    prisma.$queryRaw.mockResolvedValue([{ id: current.id, status: current.status, orderId: current.orderId }]);
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    await expect(service.reconcileEarnings()).resolves.toEqual({ scanned: 1, available: 0, held: 1 });
    expect(db.companionEarning.update).toHaveBeenCalledWith({
      where: { id: current.id },
      data: { status: "held", holdReason: "commercial_profile_not_verified" }
    });
  });

  it("treats critical and overdue moderation work as commercial readiness blockers", async () => {
    const readinessPrisma = {
      refundTransaction: { count: jest.fn().mockResolvedValue(0) },
      supportTicket: { count: jest.fn().mockResolvedValue(0) },
      notificationDelivery: { count: jest.fn().mockResolvedValue(0) },
      companionCommercialProfile: { count: jest.fn().mockResolvedValue(0) },
      companionRecovery: { count: jest.fn().mockResolvedValue(0) },
      companionEarning: { count: jest.fn().mockResolvedValue(0) },
      moderationCase: {
        count: jest.fn()
          .mockResolvedValueOnce(3)
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(2)
      },
      mediaAsset: { count: jest.fn().mockResolvedValue(4) },
      paymentTransaction: { count: jest.fn().mockResolvedValue(5) },
      order: { count: jest.fn().mockResolvedValue(0) },
      $queryRaw: jest.fn().mockResolvedValue([])
    } as any;
    const readinessService = new CommercialService(readinessPrisma, config, audit);

    const result = await readinessService.operationalReadiness();

    expect(result.status).toBe("attentionRequired");
    expect(result.blockers).toEqual(expect.objectContaining({
      criticalModeration: 1,
      overdueModeration: 2,
      moderationProviderUnavailable: 3,
      mediaDeletionBacklog: 4,
      stalePrepays: 5
    }));
    expect(readinessPrisma.moderationCase.count).toHaveBeenCalledWith({
      where: {
        status: { in: ["pending", "autoReviewing", "humanReview"] },
        priority: "critical"
      }
    });
    expect(readinessPrisma.moderationCase.count).toHaveBeenCalledWith({
      where: {
        status: { in: ["pending", "autoReviewing", "humanReview"] },
        matchedRules: { has: "provider.unavailable" }
      }
    });
  });

  it("exposes only aggregate voice-drain readiness and blocks traffic during an emergency or due close", async () => {
    config.get.mockImplementation((key: string, fallback?: unknown) => {
      if (key === "TRTC_ENABLED") return true;
      if (key === "TRTC_ROOM_CONTROL_ENABLED") return true;
      if (key === "TRTC_EMERGENCY_STOP_ENABLED") return true;
      return fallback ?? 24;
    });
    const readinessPrisma = {
      refundTransaction: { count: jest.fn().mockResolvedValue(0) },
      supportTicket: { count: jest.fn().mockResolvedValue(0) },
      notificationDelivery: { count: jest.fn().mockResolvedValue(0) },
      companionCommercialProfile: { count: jest.fn().mockResolvedValue(0) },
      companionRecovery: { count: jest.fn().mockResolvedValue(0) },
      companionEarning: { count: jest.fn().mockResolvedValue(0) },
      moderationCase: { count: jest.fn().mockResolvedValue(0) },
      mediaAsset: { count: jest.fn().mockResolvedValue(0) },
      paymentTransaction: { count: jest.fn().mockResolvedValue(0) },
      order: { count: jest.fn().mockResolvedValue(0) },
      voiceSession: { count: jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(3) },
      $queryRaw: jest.fn().mockResolvedValue([])
    } as any;
    const readinessService = new CommercialService(readinessPrisma, config, audit);

    const result = await readinessService.operationalReadiness();

    expect(result.status).toBe("attentionRequired");
    expect(result.blockers).toEqual(expect.objectContaining({
      voiceRoomControlDisabled: 0,
      voiceEmergencyStopActive: 1,
      voiceTerminationBacklog: 2,
      voiceEmergencyDrainPending: 3
    }));
    expect(result.voice).toEqual({
      enabled: true,
      roomControlEnabled: true,
      emergencyStopEnabled: true,
      terminationBacklog: 2,
      emergencyDrainPending: 3
    });
    expect(readinessPrisma.voiceSession.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        terminationCompletedAt: null,
        terminationRequestedAt: { not: null }
      })
    }));
    expect(JSON.stringify(result)).not.toContain("TENCENTCLOUD_SECRET");
  });
});
