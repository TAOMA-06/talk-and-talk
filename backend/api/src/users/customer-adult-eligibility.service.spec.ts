import { HttpStatus } from "@nestjs/common";

import {
  assertCurrentCustomerAdultEligibility,
  CustomerAdultEligibilityService
} from "./customer-adult-eligibility.service";

describe("CustomerAdultEligibilityService", () => {
  const now = new Date("2026-08-01T00:00:00.000Z");
  const baseRecord = (overrides: Record<string, unknown> = {}) => ({
    id: "eligibility-1",
    userId: "customer-1",
    status: "pending",
    verificationMethod: "externalProvider",
    evidenceReference: "provider:opaque-token-a1b2",
    submittedById: "customer-1",
    submittedAt: new Date("2026-07-31T00:00:00.000Z"),
    reviewedById: null,
    verifiedAt: null,
    validUntil: null,
    reviewReason: null,
    createdAt: new Date("2026-07-31T00:00:00.000Z"),
    updatedAt: new Date("2026-07-31T00:00:00.000Z"),
    subject: {
      id: "customer-1",
      role: "user",
      accountStatus: "active",
      profile: { displayName: "测试客户" }
    },
    reviewedBy: null,
    ...overrides
  });

  let tx: any;
  let prisma: any;
  let audit: any;
  let service: CustomerAdultEligibilityService;

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: { findUnique: jest.fn().mockResolvedValue({ id: "customer-1", role: "user" }) },
      customerAdultEligibility: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn()
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) }
    };
    prisma = {
      ...tx,
      customerAdultEligibility: {
        ...tx.customerAdultEligibility,
        findMany: jest.fn(),
        count: jest.fn()
      },
      $transaction: jest.fn(async (callback: (database: unknown) => Promise<unknown>) => callback(tx))
    };
    audit = { record: jest.fn().mockResolvedValue({}) };
    service = new CustomerAdultEligibilityService(prisma, audit);
  });

  it("keeps consent/profile claims separate from the server eligibility fact", async () => {
    await expect(service.getMyStatus("customer-1")).resolves.toEqual(expect.objectContaining({
      currentAdult: false,
      status: "notSubmitted",
      recordedStatus: null,
      canSubmit: true,
      recovery: expect.objectContaining({
        accountRightsRemainAvailable: true,
        unpaidOrderCancellationRemainsAvailable: true,
        paidUnfulfilledRefundRequestsRemainAvailable: true
      })
    }));
  });

  it("creates only a pending self-submission with an opaque evidence reference", async () => {
    tx.customerAdultEligibility.create.mockResolvedValue(baseRecord());

    const result = await service.submit("customer-1", {
      verificationMethod: "externalProvider",
      evidenceReference: "provider:opaque-token-a1b2",
      evidenceProcessingConfirmed: true
    });

    expect(tx.customerAdultEligibility.create).toHaveBeenCalledWith({
      data: {
        userId: "customer-1",
        status: "pending",
        verificationMethod: "externalProvider",
        evidenceReference: "provider:opaque-token-a1b2",
        submittedById: "customer-1"
      }
    });
    expect(result).toEqual(expect.objectContaining({
      currentAdult: false,
      status: "pending",
      evidenceReferenceMasked: "provider:••••a1b2"
    }));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "customer.adult_eligibility_submitted" }),
      tx
    );
    expect(JSON.stringify(audit.record.mock.calls[0][0].metadata)).not.toContain("opaque-token");
  });

  it("rejects raw identity-number material instead of persisting it", async () => {
    await expect(service.submit("customer-1", {
      verificationMethod: "secureManualReview",
      evidenceReference: "manual:11010519491231002X",
      evidenceProcessingConfirmed: true
    })).rejects.toMatchObject({
      code: "CUSTOMER_ADULT_ELIGIBILITY_EVIDENCE_INVALID",
      status: HttpStatus.BAD_REQUEST
    });
    expect(tx.customerAdultEligibility.create).not.toHaveBeenCalled();
  });

  it("applies an independent adult decision while holding the customer row lock", async () => {
    tx.customerAdultEligibility.findUnique.mockResolvedValue(baseRecord());
    tx.customerAdultEligibility.update.mockImplementation(async ({ data }: any) => baseRecord({
      ...data,
      reviewedBy: { id: "supply-2", profile: { displayName: "复核员" } },
      updatedAt: new Date("2026-08-01T00:01:00.000Z")
    }));

    const result = await service.markAdult(
      { id: "supply-2", role: "supply" },
      "eligibility-1",
      { validUntil: new Date(Date.now() + 180 * 24 * 60 * 60_000).toISOString(), reason: "外部核验结果有效" }
    );

    expect(result).toEqual(expect.objectContaining({ status: "adult", reviewedBy: expect.objectContaining({ id: "supply-2" }) }));
    expect(tx.customerAdultEligibility.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "adult",
        reviewedById: "supply-2",
        verifiedAt: expect.any(Date),
        validUntil: expect.any(Date)
      })
    }));
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("does not allow the submitter to review their own evidence", async () => {
    tx.customerAdultEligibility.findUnique.mockResolvedValue(baseRecord({ submittedById: "supply-2" }));

    await expect(service.markIneligible(
      { id: "supply-2", role: "supply" },
      "eligibility-1",
      { reason: "证据未能证明成年资格" }
    )).rejects.toMatchObject({
      code: "CUSTOMER_ADULT_ELIGIBILITY_INDEPENDENT_REVIEW_REQUIRED",
      status: HttpStatus.FORBIDDEN
    });
    expect(tx.customerAdultEligibility.update).not.toHaveBeenCalled();
  });

  it.each([
    [null, "CUSTOMER_ADULT_ELIGIBILITY_REQUIRED"],
    [baseRecord(), "CUSTOMER_ADULT_ELIGIBILITY_PENDING"],
    [baseRecord({ status: "ineligible", reviewedById: "supply-2", verifiedAt: now }), "CUSTOMER_ADULT_ELIGIBILITY_INELIGIBLE"],
    [baseRecord({
      status: "adult",
      reviewedById: "supply-2",
      verifiedAt: new Date("2026-01-01T00:00:00.000Z"),
      validUntil: new Date("2026-07-31T23:59:59.000Z")
    }), "CUSTOMER_ADULT_ELIGIBILITY_EXPIRED"]
  ])("fails closed for non-current fact %#", async (record, code) => {
    const db = { customerAdultEligibility: { findFirst: jest.fn().mockResolvedValue(record) } } as any;
    await expect(assertCurrentCustomerAdultEligibility(db, "customer-1", now))
      .rejects.toMatchObject({ code });
  });

  it("accepts only a reviewed adult fact whose validity window is current", async () => {
    const record = baseRecord({
      status: "adult",
      reviewedById: "supply-2",
      verifiedAt: new Date("2026-07-31T00:00:00.000Z"),
      validUntil: new Date("2027-01-01T00:00:00.000Z")
    });
    const db = { customerAdultEligibility: { findFirst: jest.fn().mockResolvedValue(record) } } as any;

    await expect(assertCurrentCustomerAdultEligibility(db, "customer-1", now)).resolves.toEqual({
      recordId: "eligibility-1",
      verifiedAt: record.verifiedAt,
      validUntil: record.validUntil,
      verificationMethod: "externalProvider"
    });
  });

  it("rejects a current fact that expires before the scheduled service ends", async () => {
    const record = baseRecord({
      status: "adult",
      reviewedById: "supply-2",
      verifiedAt: new Date("2026-07-31T00:00:00.000Z"),
      validUntil: new Date("2026-08-02T00:00:00.000Z")
    });
    const db = { customerAdultEligibility: { findFirst: jest.fn().mockResolvedValue(record) } } as any;

    await expect(assertCurrentCustomerAdultEligibility(
      db,
      "customer-1",
      now,
      new Date("2026-08-03T00:00:00.000Z")
    )).rejects.toMatchObject({
      code: "CUSTOMER_ADULT_ELIGIBILITY_VALIDITY_TOO_SHORT",
      details: expect.objectContaining({
        eligibilityStatus: "expiresBeforeServiceEnd",
        validUntil: "2026-08-02T00:00:00.000Z",
        requiredThrough: "2026-08-03T00:00:00.000Z"
      })
    });
  });
});
