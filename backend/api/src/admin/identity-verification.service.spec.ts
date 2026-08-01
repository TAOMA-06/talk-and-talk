import { IdentityVerificationService } from "./identity-verification.service";

describe("IdentityVerificationService", () => {
  const now = new Date("2026-07-31T10:00:00.000Z");
  const audit = { record: jest.fn() };
  const tx = {
    $queryRaw: jest.fn(),
    user: { findUnique: jest.fn() },
    userProfile: { upsert: jest.fn() },
    companionProfile: { updateMany: jest.fn() },
    identityVerificationRequest: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn()
    }
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    identityVerificationRequest: {
      findMany: jest.fn(),
      count: jest.fn()
    }
  };
  const service = new IdentityVerificationService(prisma as any, audit as any);

  const actor = { id: "supply-1", role: "supply" };
  const secondActor = { id: "supply-2", role: "supply" };

  function record(overrides: Record<string, unknown> = {}) {
    return {
      id: "verification-1",
      userId: "user-1",
      requestedIsVerified: true,
      previousIsVerified: false,
      status: "pending",
      reason: "外部实名核验已完成",
      evidenceReference: "kyc:case-001",
      submittedById: actor.id,
      submittedAt: now,
      reviewedById: null,
      reviewedAt: null,
      reviewReason: null,
      createdAt: now,
      updatedAt: now,
      subject: {
        id: "user-1",
        role: "user",
        accountStatus: "active",
        profile: { displayName: "申请人", isVerified: false },
        companionProfile: null
      },
      submittedBy: { id: actor.id, profile: { displayName: "供给一" } },
      reviewedBy: null,
      ...overrides
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    tx.$queryRaw.mockResolvedValue([]);
    tx.identityVerificationRequest.findFirst.mockResolvedValue(null);
    tx.companionProfile.updateMany.mockResolvedValue({ count: 1 });
    audit.record.mockResolvedValue(undefined);
  });

  it("submits a pending proposal without changing KYC or publication state", async () => {
    tx.user.findUnique.mockResolvedValue({
      id: "user-1",
      role: "user",
      profile: { isVerified: false },
      companionProfile: null
    });
    tx.identityVerificationRequest.create.mockResolvedValue(record());

    await expect(service.submitRequest(actor, "user-1", {
      isVerified: true,
      reason: " 外部实名核验已完成 ",
      evidenceReference: "kyc:case-001"
    })).resolves.toEqual(expect.objectContaining({
      id: "verification-1",
      status: "pending",
      requestedIsVerified: true,
      previousIsVerified: false
    }));

    expect(tx.identityVerificationRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: "user-1",
        previousIsVerified: false,
        requestedIsVerified: true,
        submittedById: actor.id
      })
    }));
    expect(tx.userProfile.upsert).not.toHaveBeenCalled();
    expect(tx.companionProfile.updateMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "identity.verification_change_submitted"
    }), tx);
  });

  it("rejects duplicate pending requests before writing", async () => {
    tx.user.findUnique.mockResolvedValue({
      id: "user-1",
      role: "user",
      profile: { isVerified: false },
      companionProfile: null
    });
    tx.identityVerificationRequest.findFirst.mockResolvedValue({
      id: "verification-existing",
      requestedIsVerified: true
    });

    await expect(service.submitRequest(actor, "user-1", {
      isVerified: true,
      reason: "重新提交核验申请",
      evidenceReference: "kyc:case-002"
    })).rejects.toMatchObject({
      code: "IDENTITY_VERIFICATION_REQUEST_ALREADY_PENDING"
    });
    expect(tx.identityVerificationRequest.create).not.toHaveBeenCalled();
  });

  it("requires a different staff member for both approval and rejection", async () => {
    tx.identityVerificationRequest.findUnique.mockResolvedValue(record());

    await expect(service.approveRequest(actor, "verification-1", {
      reason: "第二人复核通过"
    })).rejects.toMatchObject({
      code: "IDENTITY_VERIFICATION_SECOND_REVIEW_REQUIRED"
    });
    expect(tx.userProfile.upsert).not.toHaveBeenCalled();
    expect(tx.identityVerificationRequest.update).not.toHaveBeenCalled();
  });

  it("locks CompanionProfile before User and applies an approved verification", async () => {
    tx.identityVerificationRequest.findUnique.mockResolvedValue(record());
    tx.user.findUnique.mockResolvedValue({
      id: "user-1",
      role: "user",
      profile: { isVerified: false }
    });
    tx.identityVerificationRequest.update.mockResolvedValue(record({
      status: "approved",
      reviewedById: secondActor.id,
      reviewedAt: now,
      reviewReason: "第二人复核通过",
      subject: {
        id: "user-1",
        role: "user",
        accountStatus: "active",
        profile: { displayName: "申请人", isVerified: true },
        companionProfile: null
      },
      reviewedBy: { id: secondActor.id, profile: { displayName: "供给二" } }
    }));

    await expect(service.approveRequest(secondActor, "verification-1", {
      reason: "第二人复核通过"
    })).resolves.toEqual(expect.objectContaining({
      status: "approved",
      applied: true,
      unpublishedCompanions: 0
    }));

    const lockSql = tx.$queryRaw.mock.calls.map((call) => (call[0] as readonly string[]).join("?"));
    expect(lockSql[1]).toContain('FROM "CompanionProfile"');
    expect(lockSql[2]).toContain('FROM "User"');
    expect(tx.userProfile.upsert).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      create: { userId: "user-1", isVerified: true },
      update: { isVerified: true }
    });
    expect(tx.companionProfile.updateMany).not.toHaveBeenCalled();
  });

  it("unpublishes the companion in the same transaction when revocation is approved", async () => {
    const revocation = record({
      requestedIsVerified: false,
      previousIsVerified: true,
      evidenceReference: "kyc:revoke-001",
      subject: {
        id: "user-1",
        role: "companion",
        accountStatus: "active",
        profile: { displayName: "陪伴者", isVerified: true },
        companionProfile: { id: "companion-1", name: "陪伴者", isPublished: true }
      }
    });
    tx.identityVerificationRequest.findUnique.mockResolvedValue(revocation);
    tx.user.findUnique.mockResolvedValue({
      id: "user-1",
      role: "companion",
      profile: { isVerified: true }
    });
    tx.identityVerificationRequest.update.mockResolvedValue({
      ...revocation,
      status: "approved",
      reviewedById: secondActor.id,
      reviewedAt: now,
      reviewReason: "撤销证据复核通过",
      subject: {
        ...revocation.subject,
        profile: { displayName: "陪伴者", isVerified: false },
        companionProfile: { id: "companion-1", name: "陪伴者", isPublished: false }
      },
      reviewedBy: { id: secondActor.id, profile: { displayName: "供给二" } }
    });

    await expect(service.approveRequest(secondActor, "verification-1", {
      reason: "撤销证据复核通过"
    })).resolves.toEqual(expect.objectContaining({
      applied: true,
      unpublishedCompanions: 1
    }));
    expect(tx.companionProfile.updateMany).toHaveBeenCalledWith({
      where: { ownerUserId: "user-1", isPublished: true },
      data: { isPublished: false }
    });
  });

  it("records a rejection without mutating the subject", async () => {
    tx.identityVerificationRequest.findUnique.mockResolvedValue(record());
    tx.identityVerificationRequest.update.mockResolvedValue(record({
      status: "rejected",
      reviewedById: secondActor.id,
      reviewedAt: now,
      reviewReason: "外部证据无法匹配",
      reviewedBy: { id: secondActor.id, profile: { displayName: "供给二" } }
    }));

    await expect(service.rejectRequest(secondActor, "verification-1", {
      reason: "外部证据无法匹配"
    })).resolves.toEqual(expect.objectContaining({
      status: "rejected",
      applied: false,
      unpublishedCompanions: 0
    }));
    expect(tx.user.findUnique).not.toHaveBeenCalled();
    expect(tx.userProfile.upsert).not.toHaveBeenCalled();
    expect(tx.companionProfile.updateMany).not.toHaveBeenCalled();
  });

  it("fails closed if the subject state changed after submission", async () => {
    tx.identityVerificationRequest.findUnique.mockResolvedValue(record());
    tx.user.findUnique.mockResolvedValue({
      id: "user-1",
      role: "user",
      profile: { isVerified: true }
    });

    await expect(service.approveRequest(secondActor, "verification-1", {
      reason: "第二人复核通过"
    })).rejects.toMatchObject({ code: "IDENTITY_VERIFICATION_STATE_CHANGED" });
    expect(tx.userProfile.upsert).not.toHaveBeenCalled();
    expect(tx.identityVerificationRequest.update).not.toHaveBeenCalled();
  });

  it("lists the pending queue with bounded pagination", async () => {
    prisma.identityVerificationRequest.findMany.mockResolvedValue([record()]);
    prisma.identityVerificationRequest.count.mockResolvedValue(1);

    await expect(service.listRequests({
      status: "pending",
      page: 1,
      pageSize: 50
    })).resolves.toEqual(expect.objectContaining({
      items: [expect.objectContaining({ id: "verification-1", status: "pending" })],
      pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 }
    }));
    expect(prisma.identityVerificationRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: "pending" },
      take: 50
    }));
  });
});
