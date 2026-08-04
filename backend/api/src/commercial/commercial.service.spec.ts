import { CommercialService } from "./commercial.service";
import { latestReadyWeChatBillDate } from "../payments/wechat-reconciliation-gate";

describe("CommercialService", () => {
  const prisma = { $queryRaw: jest.fn(), $transaction: jest.fn() } as any;
  const config = { get: jest.fn().mockReturnValue(24) } as any;
  const audit = { record: jest.fn().mockResolvedValue({}) } as any;
  let service: CommercialService;
  let legalHoldPolicyApproved = true;
  const readinessBillDate = latestReadyWeChatBillDate(new Date(), 10);

  const legalHoldConfigValue = (key: string): unknown => {
    if (key === "ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_APPROVED") {
      return legalHoldPolicyApproved;
    }
    if (key === "ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_VERSION") return "2026.08-v1";
    if (key === "ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_APPROVAL_REFERENCE") {
      return "legal:hold-policy-2026-08";
    }
    if (key === "ACCOUNT_DATA_RETENTION_LEGAL_HOLD_REASON_CODES_JSON") {
      return JSON.stringify([{
        code: "COURT_ORDER",
        actions: ["placement", "release"],
        categories: ["support_disputes_safety"]
      }]);
    }
    return undefined;
  };

  const reconciliationRuns = (
    kinds = ["tradeAll", "fundBasic", "fundOperation", "fundFees"],
    billDate = readinessBillDate
  ) =>
    kinds.map((kind) => ({
      billDate: new Date(`${billDate}T00:00:00.000Z`),
      kind,
      status: "reconciled"
    }));

  const reminderReadiness = () => {
    const fanoutResult = {
      status: "clear",
      checkedAt: new Date().toISOString(),
      backlog: {
        total: 0,
        due: 0,
        processing: 0,
        retryScheduled: 0,
        expiredLeases: 0,
        failed: 0,
        oldestCreatedAt: null,
        oldestDueAgeSeconds: null,
        backlogSlaSeconds: 300,
        backlogSlaBreached: false,
        runnerDisabledWithDueBacklog: false
      }
    };
    const pipelineResult = {
      status: "clear",
      failedPreparation: 0,
      failedReservation: 0,
      failedDelivery: 0,
      expiredPreparationLeases: 0,
      expiredReservationLeases: 0,
      expiredDeliveryClaimLeases: 0,
      expiredAttemptLeases: 0,
      backlogSlaBreached: false,
      preparationRunnerDisabledWithDueBacklog: false,
      deliveryRunnerDisabledWithDueBacklog: false,
      terminalAttempts: { total: 0, resolved: 0, unresolved: 0 }
    };
    return {
      fanout: { operationalReadiness: jest.fn().mockResolvedValue(fanoutResult) } as any,
      pipeline: { operationalReadiness: jest.fn().mockResolvedValue(pipelineResult) } as any,
      fanoutResult,
      pipelineResult
    };
  };

  const earning = (overrides: Record<string, unknown> = {}) => ({
    id: "e1", orderId: "o1", companionId: "c1", grossCents: 10000, platformFeeBps: 1000,
    platformFeeCents: 1000, payableCents: 9000, status: "available", availableAt: new Date(),
    payoutSubmittedAt: null, payoutSubmittedById: null, paidAt: null, paidReference: null,
    paidAmountCents: null, paidRecipientRef: null, payoutEvidenceDigest: null,
    settlementRecipientRefSnapshot: "recipient-c1", settlementRecipientMaskedSnapshot: "****1234",
    taxProfileRefSnapshot: "tax-c1", identityEvidenceRefSnapshot: "identity-evidence-c1",
    serviceAgreementVersionSnapshot: "v1", serviceAgreementEvidenceRefSnapshot: "agreement-evidence-c1",
    holdReason: null, createdAt: new Date(), updatedAt: new Date(),
    order: {
      scheduledAt: new Date(),
      status: "completed",
      amountCents: 10000,
      companionNameSnapshot: "林屿",
      adultEligibilityVerdictSnapshot: "adult",
      adultEligibilityVerifiedAtSnapshot: new Date(Date.now() - 24 * 60 * 60_000),
      adultEligibilityValidUntilSnapshot: new Date(Date.now() + 180 * 24 * 60 * 60_000)
    },
    companion: {
      id: "c1",
      name: "林屿",
      ownerUserId: "u-companion",
      commercialProfile: {
        status: "verified",
        adultEligibilityVerdict: "adult",
        adultEligibilityValidUntil: new Date(Date.now() + 180 * 24 * 60 * 60_000)
      }
    },
    ...overrides
  });

  function dbFor(current: any, updateResult: any = current, blockers: { support?: any; refund?: any } = {}) {
    return {
      $queryRaw: jest.fn(),
      companionEarning: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ orderId: current.orderId, companionId: current.companionId })
          .mockResolvedValueOnce(current),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue(updateResult),
        updateMany: jest.fn()
      },
      order: {
        findUnique: jest.fn().mockResolvedValue({
          completedAt: new Date("2026-07-20T00:00:00.000Z"),
          refundRequestDeadlineAt: new Date("2026-07-23T00:00:00.000Z"),
          refundPolicyVersionSnapshot: "2026.08-v1",
          refundRequestWindowHoursSnapshot: 72,
          adultEligibilityVerdictSnapshot: "adult",
          adultEligibilityVerifiedAtSnapshot: new Date(Date.now() - 24 * 60 * 60_000),
          adultEligibilityValidUntilSnapshot: new Date(Date.now() + 180 * 24 * 60 * 60_000)
        })
      },
      companionRecovery: { findFirst: jest.fn().mockResolvedValue(null) },
      supportTicket: { findFirst: jest.fn().mockResolvedValue(blockers.support ?? null) },
      refundTransaction: { findFirst: jest.fn().mockResolvedValue(blockers.refund ?? null) },
      auditLog: { create: jest.fn() }
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    legalHoldPolicyApproved = true;
    config.get.mockImplementation((key: string) => {
      const legalHoldValue = legalHoldConfigValue(key);
      if (legalHoldValue !== undefined) return legalHoldValue;
      if (key === "ACCOUNT_DELETION_RETENTION_POLICY_APPROVED") return true;
      if (key === "ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE") {
        return "legal:retention-approval-2026";
      }
      if (key === "REFUND_POLICY_VERSION") return "2026.08-v1";
      if (key === "REFUND_POLICY_APPROVED") return true;
      if (key === "REFUND_POLICY_APPROVAL_REFERENCE") return "legal:refund-policy-2026-08";
      if (key === "WECHAT_DAILY_BILL_RECONCILIATION_ENABLED") return true;
      if (key === "WECHAT_DAILY_BILL_RECONCILIATION_APPROVED") return true;
      if (key === "WECHAT_DAILY_BILL_RECONCILIATION_APPROVAL_REFERENCE") {
        return "finance:wechat-daily-bill-sop-2026-08";
      }
      if (key === "WECHAT_DAILY_BILL_RECONCILIATION_START_DATE") return readinessBillDate;
      if (key === "WECHAT_DAILY_BILL_RECONCILIATION_HOUR") return 10;
      return 24;
    });
    service = new CommercialService(prisma, config, audit);
  });

  it("paginates the selected earning status while summarizing the authoritative whole ledger", async () => {
    const available = earning({ id: "earning-page", status: "available", payableCents: 9000 });
    prisma.companionProfile = { findUnique: jest.fn().mockResolvedValue({ id: "c1" }) };
    prisma.companionEarning = {
      findMany: jest.fn().mockResolvedValue([available]),
      count: jest.fn().mockResolvedValue(2),
      groupBy: jest.fn().mockResolvedValue([
        { status: "available", _count: { _all: 2 }, _sum: { payableCents: 18_000 } },
        { status: "held", _count: { _all: 1 }, _sum: { payableCents: 7_000 } },
        { status: "pending", _count: { _all: 1 }, _sum: { payableCents: 8_000 } },
        { status: "paid", _count: { _all: 3 }, _sum: { payableCents: 27_000 } }
      ])
    };

    const result = await service.listForCompanion("owner-1", {
      page: 2,
      pageSize: 1,
      status: "available"
    });

    expect(prisma.companionEarning.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { companionId: "c1", status: "available" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: 1,
      take: 1
    }));
    expect(prisma.companionEarning.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: { companionId: "c1" }
    }));
    expect(result.pagination).toEqual({ page: 2, pageSize: 1, total: 2, totalPages: 2 });
    expect(result.summary).toMatchObject({
      totalCount: 7,
      availableCents: 18_000,
      pendingOrHeldCents: 15_000,
      paidCents: 27_000
    });
  });

  it("binds an adult-eligibility verdict and validity window to commercial verification", async () => {
    const submittedAt = new Date(Date.now() - 60_000);
    const trainingExpiresAt = new Date(Date.now() + 180 * 24 * 60 * 60_000);
    const profile = {
      companionId: "c1",
      status: "pendingReview",
      settlementRecipientMasked: "****1234",
      taxProfileRef: "tax-c1",
      identityEvidenceRef: "kyc/adult-result-c1",
      serviceAgreementVersion: "2026.1",
      serviceAgreementEvidenceRef: "agreement-c1",
      submittedAt,
      submittedById: "admin-submit",
      verifiedAt: null,
      verifiedById: null,
      nextReviewDueAt: null
    };
    const db = {
      $queryRaw: jest.fn(),
      companionProfile: {
        findUnique: jest.fn().mockResolvedValue({
          id: "c1",
          ownerUserId: "user-c1",
          owner: {
            accountStatus: "active",
            profile: { isVerified: true, age: 28 }
          }
        })
      },
      companionCommercialProfile: {
        findUnique: jest.fn().mockResolvedValue(profile),
        update: jest.fn().mockImplementation(({ data }: any) => ({
          ...profile,
          ...data
        }))
      },
      companionTrainingRecord: {
        findMany: jest.fn().mockResolvedValue([
          { moduleCode: "service-boundaries", moduleVersion: "2026.1", expiresAt: trainingExpiresAt },
          { moduleCode: "safety-escalation", moduleVersion: "2026.1", expiresAt: trainingExpiresAt },
          { moduleCode: "privacy-refresh", moduleVersion: "2026.1", expiresAt: trainingExpiresAt }
        ])
      }
    } as any;
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    const result = await service.verifyCommercialProfile("admin-review", "c1");

    expect(db.companionCommercialProfile.update).toHaveBeenCalledWith({
      where: { companionId: "c1" },
      data: expect.objectContaining({
        status: "verified",
        verifiedById: "admin-review",
        adultEligibilityVerdict: "adult",
        adultEligibilityVerifiedAt: expect.any(Date),
        adultEligibilityValidUntil: trainingExpiresAt,
        adultEligibilityEvidenceRef: "kyc/adult-result-c1"
      })
    });
    expect(result.adultEligibility).toEqual({
      verdict: "adult",
      verifiedAt: expect.any(String),
      validUntil: trainingExpiresAt.toISOString(),
      evidenceAvailable: true
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "commercial.companion_profile_verified",
      metadata: expect.objectContaining({
        adultEligibilityVerdict: "adult",
        adultEligibilityValidUntil: trainingExpiresAt.toISOString()
      })
    }), db);
  });

  it("rejects commercial verification when identity review does not establish adulthood", async () => {
    const db = {
      $queryRaw: jest.fn(),
      companionProfile: {
        findUnique: jest.fn().mockResolvedValue({
          id: "c1",
          ownerUserId: "user-c1",
          owner: {
            accountStatus: "active",
            profile: { isVerified: true, age: 17 }
          }
        })
      },
      companionCommercialProfile: {
        findUnique: jest.fn().mockResolvedValue({
          companionId: "c1",
          status: "pendingReview",
          submittedById: "admin-submit"
        }),
        update: jest.fn()
      },
      companionTrainingRecord: { findMany: jest.fn() }
    } as any;
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    await expect(service.verifyCommercialProfile("admin-review", "c1")).rejects.toMatchObject({
      code: "COMPANION_ADULT_ELIGIBILITY_REQUIRED"
    });
    expect(db.companionCommercialProfile.update).not.toHaveBeenCalled();
    expect(db.companionTrainingRecord.findMany).not.toHaveBeenCalled();
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
    // Payouts serialize the Order, Earning and CompanionProfile so a
    // concurrent profile suspension cannot race past the final eligibility
    // check.
    expect(db.$queryRaw).toHaveBeenCalledTimes(3);
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
          completedAt: new Date("2026-07-20T00:00:00.000Z"),
          refundRequestDeadlineAt: new Date("2026-07-23T00:00:00.000Z"),
          refundPolicyVersionSnapshot: "2026.08-v1",
          refundRequestWindowHoursSnapshot: 72,
          adultEligibilityVerdictSnapshot: "adult",
          adultEligibilityVerifiedAtSnapshot: new Date(Date.now() - 365 * 24 * 60 * 60_000),
          adultEligibilityValidUntilSnapshot: new Date(Date.now() + 24 * 60 * 60_000)
        })
      },
      companionCommercialProfile: {
        findUnique: jest.fn().mockResolvedValue({
          status: "verified",
          adultEligibilityVerdict: "adult",
          adultEligibilityValidUntil: new Date(Date.now() + 24 * 60 * 60_000)
        })
      },
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

  it("rechecks the commercial profile after taking the shared profile lock", async () => {
    const postLock = earning({
      companion: {
        id: "c1",
        name: "林屿",
        ownerUserId: "u-companion",
        commercialProfile: {
          status: "suspended",
          adultEligibilityVerdict: "adult",
          adultEligibilityValidUntil: new Date(Date.now() + 24 * 60 * 60_000)
        }
      }
    });
    const db = dbFor(postLock);
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    await expect(service.claimPayout("admin-1", "e1")).rejects.toMatchObject({
      code: "EARNING_COMMERCIAL_PROFILE_NOT_VERIFIED"
    });

    expect(db.$queryRaw.mock.calls.map((call: any[]) => call[1])).toEqual([
      postLock.orderId,
      postLock.id,
      postLock.companionId
    ]);
    expect(db.companionEarning.update).not.toHaveBeenCalled();
  });

  it("serializes profile suspension on the same CompanionProfile row used by payout", async () => {
    const profile = {
      companionId: "c1",
      status: "verified",
      adultEligibilityVerdict: "adult",
      adultEligibilityValidUntil: new Date(Date.now() + 24 * 60 * 60_000)
    };
    const db: any = {
      $queryRaw: jest.fn(async () => []),
      companionCommercialProfile: {
        findUnique: jest.fn(async () => profile),
        update: jest.fn(async ({ data }: any) => ({ ...profile, ...data }))
      },
      companionProfile: {
        findUnique: jest.fn(async () => ({ ownerUserId: "u-companion" })),
        updateMany: jest.fn(async () => ({ count: 1 }))
      }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    await expect(service.suspendCommercialProfile(
      "admin-safety",
      "c1",
      "身份或结算资料需要重新核验"
    )).resolves.toEqual(expect.objectContaining({ status: "suspended" }));
    expect(db.$queryRaw.mock.calls[0][1]).toBe("c1");
    expect(db.companionCommercialProfile.findUnique.mock.invocationCallOrder[0])
      .toBeGreaterThan(db.$queryRaw.mock.invocationCallOrder[0]);
  });

  it("preserves transfer evidence and opens recovery when a complaint appears between provider scan and locked payout verification", async () => {
    const submitted = earning({
      status: "held",
      holdReason: "payout_verification_pending",
      payoutSubmittedAt: new Date("2026-08-01T03:00:00.000Z"),
      payoutSubmittedById: "admin-1",
      paidReference: "WX-TRANSFER-1",
      paidAmountCents: 9_000,
      paidRecipientRef: "recipient-c1",
      payoutEvidenceDigest: "a".repeat(64)
    });
    const paymentDisputes = {
      refreshActiveForOrder: jest.fn(async () => ({ active: false, disputeIds: [] }))
    } as any;
    service = new CommercialService(prisma, config, audit, paymentDisputes);
    prisma.companionEarning = {
      findUnique: jest.fn(async () => ({ orderId: submitted.orderId }))
    };
    const snapshot = {
      companionId: submitted.companionId,
      settlementRecipientRefSnapshot: submitted.settlementRecipientRefSnapshot,
      settlementRecipientMaskedSnapshot: submitted.settlementRecipientMaskedSnapshot,
      taxProfileRefSnapshot: submitted.taxProfileRefSnapshot,
      identityEvidenceRefSnapshot: submitted.identityEvidenceRefSnapshot,
      serviceAgreementVersionSnapshot: submitted.serviceAgreementVersionSnapshot,
      serviceAgreementEvidenceRefSnapshot: submitted.serviceAgreementEvidenceRefSnapshot
    };
    let earningRead = 0;
    const held = { ...submitted, holdReason: "payment_dispute_transfer_outcome_unknown" };
    const db: any = {
      $queryRaw: jest.fn(async () => []),
      companionEarning: {
        findUnique: jest.fn(async () => {
          earningRead += 1;
          if (earningRead === 1) {
            return { orderId: submitted.orderId, companionId: submitted.companionId };
          }
          if (earningRead === 2) return submitted;
          return snapshot;
        }),
        update: jest.fn(async () => held)
      },
      order: {
        findUnique: jest.fn(async () => ({
          completedAt: new Date("2026-07-20T00:00:00.000Z"),
          refundRequestDeadlineAt: new Date("2026-07-23T00:00:00.000Z"),
          refundPolicyVersionSnapshot: "2026.08-v1",
          refundRequestWindowHoursSnapshot: 72,
          adultEligibilityVerdictSnapshot: "adult",
          adultEligibilityVerifiedAtSnapshot: submitted.order.adultEligibilityVerifiedAtSnapshot,
          adultEligibilityValidUntilSnapshot: submitted.order.adultEligibilityValidUntilSnapshot
        }))
      },
      paymentDispute: {
        findFirst: jest.fn(async () => ({ id: "dispute-raced" })),
        findMany: jest.fn(async () => [{ id: "dispute-raced" }])
      },
      attendanceDispute: { findFirst: jest.fn(async () => null) },
      supportTicket: { findFirst: jest.fn(async () => null) },
      refundTransaction: { findFirst: jest.fn(async () => null) },
      companionRecovery: {
        findFirst: jest.fn(async () => null),
        upsert: jest.fn(async () => ({}))
      },
      companionCommercialProfile: {
        findUnique: jest.fn(async () => submitted.companion.commercialProfile)
      }
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(db));

    await expect(service.verifyPayout("admin-2", submitted.id)).rejects.toMatchObject({
      code: "EARNING_PAYOUT_OUTCOME_UNKNOWN"
    });

    expect(db.companionEarning.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: submitted.id },
      data: {
        status: "held",
        holdReason: "payment_dispute_transfer_outcome_unknown"
      }
    }));
    expect(held).toMatchObject({
      paidReference: "WX-TRANSFER-1",
      paidAmountCents: 9_000,
      paidRecipientRef: "recipient-c1",
      payoutEvidenceDigest: "a".repeat(64)
    });
    expect(db.companionRecovery.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { disputeId_earningId: { disputeId: "dispute-raced", earningId: submitted.id } },
      create: expect.objectContaining({ reason: "payoutStateUncertain", amountCents: 9_000 })
    }));
    expect(db.$queryRaw.mock.calls.slice(0, 3).map((call: any[]) => call[1]))
      .toEqual([submitted.orderId, submitted.id, submitted.companionId]);
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
          completedAt: new Date("2026-07-20T00:00:00.000Z"),
          refundRequestDeadlineAt: new Date("2026-07-23T00:00:00.000Z"),
          refundPolicyVersionSnapshot: "2026.08-v1",
          refundRequestWindowHoursSnapshot: 72,
          adultEligibilityVerdictSnapshot: "adult",
          adultEligibilityVerifiedAtSnapshot: new Date(Date.now() - 365 * 24 * 60 * 60_000),
          adultEligibilityValidUntilSnapshot: new Date(Date.now() + 24 * 60 * 60_000)
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

  it("treats critical moderation and overdue account appeals as commercial readiness blockers", async () => {
    const readinessPrisma = {
      refundTransaction: { count: jest.fn().mockResolvedValue(0) },
      supportTicket: { count: jest.fn().mockResolvedValue(0) },
      accountDeletionRequest: {
        count: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve(where?.dueAt?.lt && where?.status?.in ? 6 : 0))
      },
      accountDataRetentionRecord: { count: jest.fn().mockResolvedValue(0) },
      accountDataRetentionLegalHoldAction: { count: jest.fn().mockResolvedValue(0) },
      authIdentityTombstone: { count: jest.fn().mockResolvedValue(0) },
      userAccountAppeal: { count: jest.fn().mockResolvedValue(7) },
      companionAccountAppeal: { count: jest.fn().mockResolvedValue(8) },
      notificationDelivery: { count: jest.fn().mockResolvedValue(0) },
      availabilityReminderFanoutJob: { count: jest.fn().mockResolvedValue(0) },
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
      paymentTransaction: {
        count: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve(where?.providerPaidAt === null ? 0 : 5))
      },
      paymentDispute: { count: jest.fn().mockResolvedValue(0) },
      weChatBillReconciliationRun: { findMany: jest.fn().mockResolvedValue(reconciliationRuns()) },
      weChatReconciliationIssue: { count: jest.fn().mockResolvedValue(0) },
      weChatReconciliationResolutionProposal: { count: jest.fn().mockResolvedValue(0) },
      order: { count: jest.fn().mockResolvedValue(0) },
      $queryRaw: jest.fn().mockResolvedValue([])
    } as any;
    const reminder = reminderReadiness();
    const readinessService = new CommercialService(
      readinessPrisma,
      config,
      audit,
      undefined,
      reminder.fanout,
      reminder.pipeline
    );

    const result = await readinessService.operationalReadiness();

    expect(result.status).toBe("attentionRequired");
    expect(result.blockers).toEqual(expect.objectContaining({
      criticalModeration: 1,
      overdueModeration: 2,
      moderationProviderUnavailable: 3,
      mediaDeletionBacklog: 4,
      stalePrepays: 5,
      overdueAccountDeletions: 6,
      accountDeletionPendingErasure: 0,
      accountDeletionRetentionApprovalBacklog: 0,
      accountDeletionRetentionPolicyUnapproved: 0,
      dataRetentionLegalHoldPolicyUnapproved: 0,
      dataRetentionLegalHoldPendingActions: 0,
      overdueUserAccountAppeals: 7,
      overdueCompanionAccountAppeals: 8
    }));
    expect(readinessPrisma.accountDeletionRequest.count).toHaveBeenCalledWith({
      where: {
        status: { in: ["pending", "processing"] },
        dueAt: { lt: expect.any(Date) }
      }
    });
    expect(readinessPrisma.userAccountAppeal.count).toHaveBeenCalledWith({
      where: { status: "pending", reviewDueAt: { lt: expect.any(Date) } }
    });
    expect(readinessPrisma.companionAccountAppeal.count).toHaveBeenCalledWith({
      where: { status: "pending", reviewDueAt: { lt: expect.any(Date) } }
    });
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

    readinessPrisma.accountDeletionRequest.count.mockResolvedValue(0);
    readinessPrisma.moderationCase.count.mockResolvedValue(0);
    readinessPrisma.mediaAsset.count.mockResolvedValue(0);
    readinessPrisma.paymentTransaction.count.mockResolvedValue(0);
    const appealsOnly = await readinessService.operationalReadiness();

    expect(appealsOnly.status).toBe("attentionRequired");
    expect(Object.entries(appealsOnly.blockers).filter(([, count]) => count > 0)).toEqual([
      ["overdueUserAccountAppeals", 7],
      ["overdueCompanionAccountAppeals", 8]
    ]);

    readinessPrisma.userAccountAppeal.count.mockResolvedValue(0);
    readinessPrisma.companionAccountAppeal.count.mockResolvedValue(0);
    readinessPrisma.weChatBillReconciliationRun.findMany.mockResolvedValue(
      reconciliationRuns(["tradeAll", "fundBasic", "fundOperation"])
    );
    readinessPrisma.weChatReconciliationIssue.count.mockResolvedValue(2);
    const reconciliationOnly = await readinessService.operationalReadiness();

    expect(Object.entries(reconciliationOnly.blockers).filter(([, count]) => count > 0)).toEqual([
      ["wechatDailyBillReconciliationIncomplete", 1],
      ["wechatDailyBillOpenIssues", 2]
    ]);
    expect(reconciliationOnly.dailyBillReconciliation).toEqual(expect.objectContaining({
      enabled: true,
      approved: true,
      completedRuns: 3,
      requiredRuns: 4,
      unresolvedIssues: 2
    }));

    readinessPrisma.weChatBillReconciliationRun.findMany.mockResolvedValue(reconciliationRuns());
    readinessPrisma.weChatReconciliationIssue.count.mockResolvedValue(0);
    config.get.mockImplementation((key: string) => {
      const legalHoldValue = legalHoldConfigValue(key);
      if (legalHoldValue !== undefined) return legalHoldValue;
      if (key === "ACCOUNT_DELETION_RETENTION_POLICY_APPROVED") return false;
      if (key === "ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE") return "";
      if (key === "WECHAT_DAILY_BILL_RECONCILIATION_ENABLED") return true;
      if (key === "WECHAT_DAILY_BILL_RECONCILIATION_APPROVED") return true;
      if (key === "WECHAT_DAILY_BILL_RECONCILIATION_APPROVAL_REFERENCE") {
        return "finance:wechat-daily-bill-sop-2026-08";
      }
      if (key === "WECHAT_DAILY_BILL_RECONCILIATION_START_DATE") return readinessBillDate;
      if (key === "WECHAT_DAILY_BILL_RECONCILIATION_HOUR") return 10;
      return 24;
    });
    const approvalOnly = await readinessService.operationalReadiness();

    expect(approvalOnly.status).toBe("attentionRequired");
    expect(Object.entries(approvalOnly.blockers).filter(([, count]) => count > 0)).toEqual([
      ["accountDeletionRetentionPolicyUnapproved", 1]
    ]);

    config.get.mockImplementation((key: string) => {
      const legalHoldValue = legalHoldConfigValue(key);
      if (legalHoldValue !== undefined) return legalHoldValue;
      if (key === "ACCOUNT_DELETION_RETENTION_POLICY_APPROVED") return true;
      if (key === "ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE") {
        return "legal:retention-approval-2026";
      }
      if (key === "WECHAT_DAILY_BILL_RECONCILIATION_ENABLED") return true;
      if (key === "WECHAT_DAILY_BILL_RECONCILIATION_APPROVED") return true;
      if (key === "WECHAT_DAILY_BILL_RECONCILIATION_APPROVAL_REFERENCE") {
        return "finance:wechat-daily-bill-sop-2026-08";
      }
      if (key === "WECHAT_DAILY_BILL_RECONCILIATION_START_DATE") return readinessBillDate;
      if (key === "WECHAT_DAILY_BILL_RECONCILIATION_HOUR") return 10;
      return 24;
    });
    readinessPrisma.accountDataRetentionRecord.count.mockImplementation(({ where }: any) =>
      Promise.resolve(where?.disposition === "pendingErasure" ? 9 : 0));
    const pendingErasureOnly = await readinessService.operationalReadiness();

    expect(Object.entries(pendingErasureOnly.blockers).filter(([, count]) => count > 0)).toEqual([
      ["accountDeletionPendingErasure", 9]
    ]);
    expect(readinessPrisma.accountDataRetentionRecord.count).toHaveBeenCalledWith({
      where: { disposition: "pendingErasure" }
    });

    readinessPrisma.accountDataRetentionRecord.count.mockImplementation(({ where }: any) =>
      Promise.resolve(where?.policyApprovalStatus === "pendingLegalApproval" ? 6 : 0));
    const approvalBacklogOnly = await readinessService.operationalReadiness();

    expect(Object.entries(approvalBacklogOnly.blockers).filter(([, count]) => count > 0)).toEqual([
      ["accountDeletionRetentionApprovalBacklog", 6]
    ]);
    expect(readinessPrisma.accountDataRetentionRecord.count).toHaveBeenCalledWith({
      where: { policyApprovalStatus: "pendingLegalApproval" }
    });

    readinessPrisma.accountDataRetentionRecord.count.mockResolvedValue(0);
    readinessPrisma.accountDataRetentionLegalHoldAction.count.mockResolvedValue(4);
    const legalHoldActionsOnly = await readinessService.operationalReadiness();

    expect(Object.entries(legalHoldActionsOnly.blockers).filter(([, count]) => count > 0)).toEqual([
      ["dataRetentionLegalHoldPendingActions", 4]
    ]);
    expect(readinessPrisma.accountDataRetentionLegalHoldAction.count).toHaveBeenCalledWith({
      where: { status: "pending" }
    });
    expect(readinessPrisma.accountDataRetentionRecord.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        disposition: { in: ["pendingErasure", "retainedRestricted"] },
        legalHolds: { none: { releasedAt: null } },
        legalHoldActions: { none: { action: "placement", status: "pending" } }
      })
    });

    readinessPrisma.accountDataRetentionLegalHoldAction.count.mockResolvedValue(0);
    legalHoldPolicyApproved = false;
    const legalHoldPolicyOnly = await readinessService.operationalReadiness();

    expect(Object.entries(legalHoldPolicyOnly.blockers).filter(([, count]) => count > 0)).toEqual([
      ["dataRetentionLegalHoldPolicyUnapproved", 1]
    ]);
    legalHoldPolicyApproved = true;

    readinessPrisma.$queryRaw.mockImplementation(async (parts: TemplateStringsArray) => {
      const sql = Array.from(parts).join("?");
      if (sql.includes('"status" = \'inService\'') && sql.includes("COUNT(*)")) {
        return [{ count: 137 }];
      }
      if (sql.includes('"status" = \'inService\'')) {
        return [
          { id: "stale-1", scheduledAt: new Date("2026-07-01T00:00:00.000Z") },
          { id: "stale-2", scheduledAt: new Date("2026-07-01T00:00:00.000Z") }
        ];
      }
      return [{ count: 0 }];
    });
    const staleInServiceOnly = await readinessService.operationalReadiness();

    expect(Object.entries(staleInServiceOnly.blockers).filter(([, count]) => count > 0)).toEqual([
      ["staleInService", 137]
    ]);
    expect(staleInServiceOnly.staleInServiceOrders).toEqual([
      { id: "stale-1", scheduledAt: "2026-07-01T00:00:00.000Z" },
      { id: "stale-2", scheduledAt: "2026-07-01T00:00:00.000Z" }
    ]);
    expect(staleInServiceOnly).toEqual(expect.objectContaining({
      staleInServiceSampleLimit: 100,
      staleInServiceSampleTruncated: true
    }));
    const staleSampleSql = readinessPrisma.$queryRaw.mock.calls
      .map(([parts]: [TemplateStringsArray]) => Array.from(parts).join("?"))
      .find((sql: string) => sql.includes('"status" = \'inService\'') && sql.includes("ORDER BY"));
    expect(staleSampleSql).toContain('ORDER BY "scheduledAt" ASC, "id" ASC');

    readinessPrisma.accountDeletionRequest.count.mockImplementation(({ where }: any) => {
      if (where?.status?.in) return Promise.resolve(0);
      if (where?.executionStatus === "failed") return Promise.resolve(2);
      if (where?.executionStatus === "processing" && where?.OR) return Promise.resolve(3);
      if (where?.executionStatus === "processing") return Promise.resolve(1);
      if (where?.status === "processing" && where?.OR) return Promise.resolve(4);
      return Promise.resolve(0);
    });
    readinessPrisma.$queryRaw.mockImplementation(async (parts: TemplateStringsArray) => {
      const sql = Array.from(parts).join("?");
      if (sql.includes('FROM "AccountDeletionRequest"')) {
        return [{ dueAt: new Date(Date.now() - 10 * 60_000) }];
      }
      return [];
    });
    const deletionExecutionOnly = await readinessService.operationalReadiness();
    expect(Object.entries(deletionExecutionOnly.blockers).filter(([, count]) => count > 0))
      .toEqual([
        ["accountDeletionExecutionFailed", 2],
        ["accountDeletionExecutionExpiredLeases", 3],
        ["accountDeletionExecutionBacklogSlaBreached", 1]
      ]);
    expect(deletionExecutionOnly.accountDeletionExecution).toEqual(expect.objectContaining({
      dueBacklog: 4,
      processing: 1,
      failed: 2,
      expiredLeases: 3,
      oldestDueAt: expect.any(String),
      oldestDueAgeSeconds: expect.any(Number),
      backlogSlaSeconds: 300,
      backlogSlaBreached: true
    }));

    readinessPrisma.accountDeletionRequest.count.mockResolvedValue(0);
    readinessPrisma.$queryRaw.mockResolvedValue([]);
    readinessPrisma.authIdentityTombstone.count.mockImplementation(({ where }: any) =>
      Promise.resolve(where?.keyId ? 5 : where?.expiresAt?.lte ? 2 : 0));
    readinessPrisma.$queryRaw.mockImplementation(async (parts: TemplateStringsArray) => {
      const sql = Array.from(parts).join("?");
      if (sql.includes('FROM "AccountDeletionRequest" request')
        && sql.includes('"AuthIdentityTombstone"')) {
        return [{ count: 3 }];
      }
      return [];
    });
    const tombstoneOnly = await readinessService.operationalReadiness();
    expect(Object.entries(tombstoneOnly.blockers).filter(([, count]) => count > 0)).toEqual([
      ["accountDeletionAuthTombstoneCoverageGaps", 3],
      ["accountDeletionAuthTombstoneUnknownKeys", 5]
    ]);
    expect(tombstoneOnly.accountDeletionAuthTombstones).toEqual({
      coverageGaps: 3,
      unknownKeyBacklog: 5,
      expiredCleanupBacklog: 2,
      configuredKeyIds: []
    });
    expect(readinessPrisma.authIdentityTombstone.count).toHaveBeenCalledWith({
      where: {
        keyId: { not: "" },
        OR: [
          { deletionRequest: { status: "processing" } },
          {
            deletionRequest: { status: "completed" },
            OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }]
          }
        ]
      }
    });

    readinessPrisma.authIdentityTombstone.count.mockResolvedValue(0);
    readinessPrisma.$queryRaw.mockResolvedValue([]);
    reminder.fanoutResult.status = "attentionRequired";
    Object.assign(reminder.fanoutResult.backlog, {
      total: 4,
      due: 4,
      failed: 2,
      expiredLeases: 1
    });
    const fanoutOnly = await readinessService.operationalReadiness();
    expect(Object.entries(fanoutOnly.blockers).filter(([, count]) => count > 0)).toEqual([
      ["availabilityReminderFanoutFailed", 2],
      ["availabilityReminderFanoutExpiredLeases", 1]
    ]);
    expect(fanoutOnly.availabilityReminder.backlog.total).toBe(4);
  });

  it("exposes only aggregate voice-drain readiness and blocks traffic during an emergency or due close", async () => {
    config.get.mockImplementation((key: string, fallback?: unknown) => {
      const legalHoldValue = legalHoldConfigValue(key);
      if (legalHoldValue !== undefined) return legalHoldValue;
      if (key === "ACCOUNT_DELETION_RETENTION_POLICY_APPROVED") return true;
      if (key === "ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE") {
        return "legal:retention-approval-2026";
      }
      if (key === "WECHAT_DAILY_BILL_RECONCILIATION_ENABLED") return true;
      if (key === "WECHAT_DAILY_BILL_RECONCILIATION_APPROVED") return true;
      if (key === "WECHAT_DAILY_BILL_RECONCILIATION_APPROVAL_REFERENCE") {
        return "finance:wechat-daily-bill-sop-2026-08";
      }
      if (key === "WECHAT_DAILY_BILL_RECONCILIATION_START_DATE") return readinessBillDate;
      if (key === "WECHAT_DAILY_BILL_RECONCILIATION_HOUR") return 10;
      if (key === "TRTC_ENABLED") return true;
      if (key === "TRTC_ROOM_CONTROL_ENABLED") return true;
      if (key === "TRTC_EMERGENCY_STOP_ENABLED") return true;
      return fallback ?? 24;
    });
    const readinessPrisma = {
      refundTransaction: { count: jest.fn().mockResolvedValue(0) },
      supportTicket: { count: jest.fn().mockResolvedValue(0) },
      accountDeletionRequest: { count: jest.fn().mockResolvedValue(0) },
      accountDataRetentionRecord: { count: jest.fn().mockResolvedValue(0) },
      accountDataRetentionLegalHoldAction: { count: jest.fn().mockResolvedValue(0) },
      userAccountAppeal: { count: jest.fn().mockResolvedValue(0) },
      companionAccountAppeal: { count: jest.fn().mockResolvedValue(0) },
      notificationDelivery: { count: jest.fn().mockResolvedValue(0) },
      companionCommercialProfile: { count: jest.fn().mockResolvedValue(0) },
      companionRecovery: { count: jest.fn().mockResolvedValue(0) },
      companionEarning: { count: jest.fn().mockResolvedValue(0) },
      moderationCase: { count: jest.fn().mockResolvedValue(0) },
      mediaAsset: { count: jest.fn().mockResolvedValue(0) },
      paymentTransaction: { count: jest.fn().mockResolvedValue(0) },
      paymentDispute: { count: jest.fn().mockResolvedValue(0) },
      weChatBillReconciliationRun: { findMany: jest.fn().mockResolvedValue(reconciliationRuns()) },
      weChatReconciliationIssue: { count: jest.fn().mockResolvedValue(0) },
      weChatReconciliationResolutionProposal: { count: jest.fn().mockResolvedValue(0) },
      order: { count: jest.fn().mockResolvedValue(0) },
      voiceSession: { count: jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(3) },
      $queryRaw: jest.fn().mockResolvedValue([])
    } as any;
    const reminder = reminderReadiness();
    const readinessService = new CommercialService(
      readinessPrisma,
      config,
      audit,
      undefined,
      reminder.fanout,
      reminder.pipeline
    );

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

  it("blocks false-green notification and availability-reminder pipeline states", async () => {
    let scenario: "notification" | "healthy" | "disabled" | "reminder" = "notification";
    let notificationEnabled = true;
    config.get.mockImplementation((key: string, fallback?: unknown) => {
      const legalHoldValue = legalHoldConfigValue(key);
      if (legalHoldValue !== undefined) return legalHoldValue;
      if (key === "ACCOUNT_DELETION_RETENTION_POLICY_APPROVED") return true;
      if (key === "ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE") {
        return "legal:retention-approval-2026";
      }
      if (key === "WECHAT_DAILY_BILL_RECONCILIATION_ENABLED") return true;
      if (key === "WECHAT_DAILY_BILL_RECONCILIATION_APPROVED") return true;
      if (key === "WECHAT_DAILY_BILL_RECONCILIATION_APPROVAL_REFERENCE") {
        return "finance:wechat-daily-bill-sop-2026-08";
      }
      if (key === "WECHAT_DAILY_BILL_RECONCILIATION_START_DATE") return readinessBillDate;
      if (key === "WECHAT_DAILY_BILL_RECONCILIATION_HOUR") return 10;
      if (key === "WECHAT_PAY_COMPLAINTS_ENABLED") return true;
      if (key === "NOTIFICATION_DELIVERY_ENABLED") return notificationEnabled;
      if (key === "NOTIFICATION_DELIVERY_INTERVAL_SECONDS") return 90;
      return fallback ?? 24;
    });
    const notificationDelivery = {
      count: jest.fn().mockImplementation(({ where }: any) => {
        if (scenario === "reminder") return Promise.resolve(0);
        if (scenario === "healthy") {
          if (where?.status === "processing") return Promise.resolve(where?.OR ? 0 : 1);
          if (where?.status === "pending" && !where?.nextAttemptAt) return Promise.resolve(2);
          if (where?.status === "pending" && where?.nextAttemptAt?.lte instanceof Date) {
            return Promise.resolve(Date.now() - where.nextAttemptAt.lte.getTime() > 60_000 ? 0 : 2);
          }
          return Promise.resolve(0);
        }
        if (scenario === "disabled") {
          return Promise.resolve(where?.status === "pending" && !where?.nextAttemptAt ? 3 : 0);
        }
        if (where?.status === "failed") return Promise.resolve(4);
        if (where?.status === "processing") return Promise.resolve(where?.OR ? 1 : 2);
        if (where?.status === "pending" && !where?.nextAttemptAt) return Promise.resolve(3);
        if (where?.status === "pending" && where?.nextAttemptAt?.lte instanceof Date) {
          return Promise.resolve(Date.now() - where.nextAttemptAt.lte.getTime() > 60_000 ? 1 : 2);
        }
        return Promise.resolve(0);
      }),
      findFirst: jest.fn().mockImplementation(() => Promise.resolve(
        scenario === "notification"
          ? { nextAttemptAt: new Date(Date.now() - 5 * 60_000) }
          : scenario === "healthy"
            ? { nextAttemptAt: new Date(Date.now() - 30_000) }
            : null
      ))
    };
    const readinessPrisma = {
      refundTransaction: { count: jest.fn().mockResolvedValue(0) },
      supportTicket: { count: jest.fn().mockResolvedValue(0) },
      accountDeletionRequest: { count: jest.fn().mockResolvedValue(0) },
      accountDataRetentionRecord: { count: jest.fn().mockResolvedValue(0) },
      accountDataRetentionLegalHoldAction: { count: jest.fn().mockResolvedValue(0) },
      userAccountAppeal: { count: jest.fn().mockResolvedValue(0) },
      companionAccountAppeal: { count: jest.fn().mockResolvedValue(0) },
      notificationDelivery,
      availabilityReminderCandidate: {
        count: jest.fn().mockImplementation(() => Promise.resolve(scenario === "reminder" ? 5 : 0))
      },
      availabilityReminderHandoff: {
        count: jest.fn().mockImplementation(() => Promise.resolve(scenario === "reminder" ? 6 : 0))
      },
      availabilityReminderAttempt: {
        count: jest.fn().mockImplementation(({ where }: any) => {
          if (scenario !== "reminder") return Promise.resolve(0);
          if (where?.status === "reserved") return Promise.resolve(7);
          if (where?.status === "failedBeforeSend") return Promise.resolve(10);
          if (where?.status === "rejected") return Promise.resolve(11);
          if (where?.status === "uncertain") return Promise.resolve(12);
          if (where?.status?.in) return Promise.resolve(where?.OR ? 9 : 8);
          return Promise.resolve(0);
        })
      },
      availabilityReminderFanoutJob: { count: jest.fn().mockResolvedValue(0) },
      companionCommercialProfile: { count: jest.fn().mockResolvedValue(0) },
      companionRecovery: { count: jest.fn().mockResolvedValue(0) },
      companionEarning: { count: jest.fn().mockResolvedValue(0) },
      moderationCase: { count: jest.fn().mockResolvedValue(0) },
      mediaAsset: { count: jest.fn().mockResolvedValue(0) },
      paymentTransaction: { count: jest.fn().mockResolvedValue(0) },
      paymentDispute: { count: jest.fn().mockResolvedValue(0) },
      weChatBillReconciliationRun: { findMany: jest.fn().mockResolvedValue(reconciliationRuns()) },
      weChatReconciliationIssue: { count: jest.fn().mockResolvedValue(0) },
      weChatReconciliationResolutionProposal: { count: jest.fn().mockResolvedValue(0) },
      order: { count: jest.fn().mockResolvedValue(0) },
      $queryRaw: jest.fn().mockResolvedValue([])
    } as any;
    const reminderReadinessProviders = reminderReadiness();
    const readinessService = new CommercialService(
      readinessPrisma,
      config,
      audit,
      undefined,
      reminderReadinessProviders.fanout,
      reminderReadinessProviders.pipeline
    );

    const notification = await readinessService.operationalReadiness();
    expect(notification.notificationDelivery).toEqual(expect.objectContaining({
      enabled: true,
      intervalSeconds: 90,
      slaSeconds: 180,
      pendingTotal: 3,
      duePending: 2,
      overduePending: 1,
      oldestDueAt: expect.any(String),
      oldestDueAgeSeconds: expect.any(Number),
      processing: 2,
      expiredProcessing: 1,
      unreadFailed: 4
    }));
    expect(Object.entries(notification.blockers).filter(([, count]) => count > 0)).toEqual([
      ["notificationDeliveryOverduePending", 1],
      ["failedNotifications", 4],
      ["staleNotificationLeases", 1]
    ]);

    scenario = "healthy";
    const healthy = await readinessService.operationalReadiness();
    expect(healthy.status).toBe("clear");
    expect(healthy.notificationDelivery).toEqual(expect.objectContaining({
      pendingTotal: 2,
      duePending: 2,
      overduePending: 0,
      processing: 1,
      expiredProcessing: 0,
      unreadFailed: 0
    }));
    expect(Object.values(healthy.blockers).every((count) => count === 0)).toBe(true);

    scenario = "disabled";
    notificationEnabled = false;
    const disabled = await readinessService.operationalReadiness();
    expect(Object.entries(disabled.blockers).filter(([, count]) => count > 0)).toEqual([
      ["notificationDeliveryDisabledWithPending", 3]
    ]);

    scenario = "reminder";
    notificationEnabled = true;
    Object.assign(reminderReadinessProviders.pipelineResult, {
      status: "processing",
      pendingCandidates: 5,
      pending: 6,
      reservedAttempts: 7,
      activeAttempts: 8
    });
    const freshReminder = await readinessService.operationalReadiness();
    expect(freshReminder.status).toBe("clear");
    expect(freshReminder.availabilityReminder.status).toBe("processing");
    expect(Object.values(freshReminder.blockers).every((count) => count === 0)).toBe(true);

    Object.assign(reminderReadinessProviders.pipelineResult, {
      status: "attentionRequired",
      expiredPreparationLeases: 2,
      expiredReservationLeases: 3,
      expiredDeliveryClaimLeases: 4,
      expiredAttemptLeases: 9,
      failedPreparation: 10,
      failedReservation: 11,
      failedDelivery: 12,
      backlogSlaBreached: true,
      preparationRunnerDisabledWithDueBacklog: true,
      deliveryRunnerDisabledWithDueBacklog: true,
      terminalAttempts: { total: 20, resolved: 7, unresolved: 13 }
    });
    const reminder = await readinessService.operationalReadiness();
    expect(Object.entries(reminder.blockers).filter(([, count]) => count > 0)).toEqual([
      ["availabilityReminderPreparationFailures", 10],
      ["availabilityReminderReservationFailures", 11],
      ["availabilityReminderDeliveryFailures", 12],
      ["availabilityReminderPreparationExpiredLeases", 2],
      ["availabilityReminderReservationExpiredLeases", 3],
      ["availabilityReminderDeliveryClaimExpiredLeases", 4],
      ["availabilityReminderAttemptExpiredLeases", 9],
      ["availabilityReminderPipelineBacklogSlaBreached", 1],
      ["availabilityReminderPreparationRunnerDisabledWithDueBacklog", 1],
      ["availabilityReminderDeliveryRunnerDisabledWithDueBacklog", 1],
      ["availabilityReminderTerminalUnresolved", 13]
    ]);
  });
});
