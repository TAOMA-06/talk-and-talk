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

  it("rejects a new verification grant before reading or writing identity state", async () => {
    tx.user.findUnique.mockResolvedValue({
      id: "user-1",
      role: "user",
      profile: { isVerified: false },
      companionProfile: null
    });
    await expect(service.submitRequest(actor, "user-1", {
      isVerified: true,
      reason: " 外部实名核验已完成 ",
      evidenceReference: "kyc:case-001"
    })).rejects.toMatchObject({ code: "IDENTITY_VERIFICATION_GRANT_FROZEN" });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.identityVerificationRequest.create).not.toHaveBeenCalled();
    expect(tx.userProfile.upsert).not.toHaveBeenCalled();
    expect(tx.companionProfile.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("allows a revocation proposal while grants are frozen", async () => {
    tx.user.findUnique.mockResolvedValue({
      id: "user-1",
      role: "user",
      profile: { isVerified: true },
      companionProfile: null
    });
    const revocation = record({
      requestedIsVerified: false,
      previousIsVerified: true,
      evidenceReference: "kyc:revoke-002"
    });
    tx.identityVerificationRequest.create.mockResolvedValue(revocation);

    await expect(service.submitRequest(actor, "user-1", {
      isVerified: false,
      reason: "撤销旧身份状态",
      evidenceReference: "kyc:revoke-002"
    })).resolves.toEqual(expect.objectContaining({ requestedIsVerified: false }));
    expect(tx.identityVerificationRequest.create).toHaveBeenCalled();
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

  it("rejects approval of a previously queued grant before mutating the subject", async () => {
    tx.identityVerificationRequest.findUnique.mockResolvedValue(record());
    await expect(service.approveRequest(secondActor, "verification-1", {
      reason: "第二人复核通过"
    })).rejects.toMatchObject({ code: "IDENTITY_VERIFICATION_GRANT_FROZEN" });

    expect(tx.user.findUnique).not.toHaveBeenCalled();
    expect(tx.userProfile.upsert).not.toHaveBeenCalled();
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
    tx.identityVerificationRequest.findUnique.mockResolvedValue(record({
      requestedIsVerified: false,
      previousIsVerified: true,
      evidenceReference: "kyc:revoke-state-changed"
    }));
    tx.user.findUnique.mockResolvedValue({
      id: "user-1",
      role: "user",
      profile: { isVerified: false }
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
