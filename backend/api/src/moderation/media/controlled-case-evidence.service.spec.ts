import { ControlledCaseEvidenceService } from "./controlled-case-evidence.service";

const assetId = "11111111-1111-4111-8111-111111111111";

describe("ControlledCaseEvidenceService", () => {
  const prisma: any = {
    supportTicket: { findUnique: jest.fn() },
    attendanceDispute: { findUnique: jest.fn() },
    companionProfile: { findFirst: jest.fn() },
    userAccountAction: { findFirst: jest.fn() },
    companionAccountAction: { findFirst: jest.fn() },
    controlledCaseEvidenceAttachment: { findUnique: jest.fn(), findFirst: jest.fn() }
  };
  const mediaAssets: any = {
    assertCaseEvidenceMediaEnabled: jest.fn(),
    isCaseEvidenceMediaEnabled: jest.fn(() => true),
    reserveControlled: jest.fn(),
    completeControlled: jest.fn(),
    controlledStatus: jest.fn(),
    controlledAttachmentDto: jest.fn((item) => ({ id: item.id })),
    approvedReadUrl: jest.fn().mockResolvedValue("https://storage.example/read")
  };
  const worker: any = { enqueue: jest.fn() };
  let service: ControlledCaseEvidenceService;

  beforeEach(() => {
    jest.clearAllMocks();
    mediaAssets.assertCaseEvidenceMediaEnabled.mockImplementation(() => undefined);
    mediaAssets.isCaseEvidenceMediaEnabled.mockReturnValue(true);
    prisma.userAccountAction.findFirst.mockResolvedValue(null);
    prisma.companionAccountAction.findFirst.mockResolvedValue(null);
    prisma.controlledCaseEvidenceAttachment.findFirst.mockResolvedValue(null);
    service = new ControlledCaseEvidenceService(prisma, mediaAssets, worker);
  });

  it("rejects controlled evidence before target lookup, binding, worker, or read-url access on text-only", async () => {
    mediaAssets.assertCaseEvidenceMediaEnabled.mockImplementation(() => {
      throw Object.assign(new Error("media disabled"), { code: "MEDIA_FEATURE_DISABLED", status: 503 });
    });
    mediaAssets.isCaseEvidenceMediaEnabled.mockReturnValue(false);
    const db = {
      $queryRaw: jest.fn(),
      mediaAsset: { findMany: jest.fn() },
      controlledCaseEvidenceAttachment: { create: jest.fn() }
    };

    await expect(service.reserveForSupport(
      { id: "customer-1", role: "user" } as any,
      "ticket-1",
      { kind: "image", mimeType: "image/jpeg", sizeBytes: 10, sha256: "a".repeat(64) }
    )).rejects.toMatchObject({ code: "MEDIA_FEATURE_DISABLED", status: 503 });
    await expect(service.complete("customer-1", assetId))
      .rejects.toMatchObject({ code: "MEDIA_FEATURE_DISABLED", status: 503 });
    expect(() => service.status("customer-1", assetId)).toThrow("media disabled");
    await expect(service.createReadUrl({ id: "customer-1", role: "user" } as any, "binding-1"))
      .rejects.toMatchObject({ code: "MEDIA_FEATURE_DISABLED", status: 503 });
    await expect(service.bindSupportFact(db, {
      assetIds: [assetId],
      userId: "customer-1",
      supportTicketId: "ticket-1",
      orderSupportFactId: "fact-1"
    })).rejects.toMatchObject({ code: "MEDIA_FEATURE_DISABLED", status: 503 });
    expect(service.attachmentDtos({ evidenceAttachments: [{ id: "binding-1", mediaAsset: { status: "approved" } }] }))
      .toEqual([]);

    expect(prisma.supportTicket.findUnique).not.toHaveBeenCalled();
    expect(mediaAssets.completeControlled).not.toHaveBeenCalled();
    expect(mediaAssets.controlledStatus).not.toHaveBeenCalled();
    expect(mediaAssets.approvedReadUrl).not.toHaveBeenCalled();
    expect(worker.enqueue).not.toHaveBeenCalled();
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.mediaAsset.findMany).not.toHaveBeenCalled();
    expect(mediaAssets.controlledAttachmentDto).not.toHaveBeenCalled();
  });

  it("reserves support evidence only for the requester who remains an order participant", async () => {
    prisma.supportTicket.findUnique.mockResolvedValue({
      id: "ticket-1",
      userId: "customer-1",
      orderId: "order-1",
      category: "orderIssue",
      status: "open",
      order: {
        userId: "customer-1",
        companion: { ownerUserId: "companion-1" }
      }
    });
    mediaAssets.reserveControlled.mockResolvedValue({ asset: { id: assetId } });

    await expect(service.reserveForSupport(
      { id: "customer-1", role: "user" } as any,
      "ticket-1",
      { kind: "image", mimeType: "image/jpeg", sizeBytes: 10, sha256: "a".repeat(64) }
    )).resolves.toEqual({ asset: { id: assetId } });
    expect(mediaAssets.reserveControlled).toHaveBeenCalledWith(expect.objectContaining({
      uploaderId: "customer-1",
      purpose: "orderSupportFact",
      scope: { supportTicketId: "ticket-1" }
    }));

    await expect(service.reserveForSupport(
      { id: "other-user", role: "user" } as any,
      "ticket-1",
      { kind: "image", mimeType: "image/jpeg", sizeBytes: 10, sha256: "a".repeat(64) }
    )).rejects.toMatchObject({ code: "SUPPORT_TICKET_NOT_FOUND", status: 404 });
  });

  it("reserves appeal evidence only inside the owned active action window", async () => {
    prisma.userAccountAction.findFirst.mockResolvedValue({
      id: "action-1",
      userId: "customer-1",
      revokedAt: null,
      appeal: null,
      appealDeadlineAt: new Date(Date.now() + 60_000)
    });
    prisma.companionProfile.findFirst.mockResolvedValue({ id: "companion-1" });
    prisma.companionAccountAction.findFirst.mockResolvedValue({
      id: "companion-action-1",
      companionId: "companion-1",
      revokedAt: null,
      appeals: [],
      appealDeadlineAt: new Date(Date.now() + 60_000)
    });
    mediaAssets.reserveControlled.mockResolvedValue({ asset: { id: assetId } });

    await service.reserveForUserAccountAppeal("customer-1", "action-1", {
      kind: "image", mimeType: "image/jpeg", sizeBytes: 10, sha256: "a".repeat(64)
    });
    expect(mediaAssets.reserveControlled).toHaveBeenLastCalledWith(expect.objectContaining({
      uploaderId: "customer-1",
      purpose: "userAccountAppeal",
      scope: { userAccountActionId: "action-1" }
    }));

    await service.reserveForCompanionAccountAppeal("owner-1", "companion-action-1", {
      kind: "image", mimeType: "image/jpeg", sizeBytes: 10, sha256: "b".repeat(64)
    });
    expect(mediaAssets.reserveControlled).toHaveBeenLastCalledWith(expect.objectContaining({
      uploaderId: "owner-1",
      purpose: "companionAccountAppeal",
      scope: { companionAccountActionId: "companion-action-1" }
    }));

    prisma.userAccountAction.findFirst.mockResolvedValue({
      id: "action-1",
      revokedAt: new Date(),
      appeal: null,
      appealDeadlineAt: new Date(Date.now() + 60_000)
    });
    await expect(service.reserveForUserAccountAppeal("customer-1", "action-1", {
      kind: "image", mimeType: "image/jpeg", sizeBytes: 10, sha256: "c".repeat(64)
    })).rejects.toMatchObject({ code: "USER_ACCOUNT_ACTION_REVOKED", status: 409 });
  });

  it("enqueues standalone moderation after idempotent provider completion", async () => {
    mediaAssets.completeControlled.mockResolvedValue({ asset: { id: assetId, status: "scanning" } });

    await expect(service.complete("customer-1", assetId)).resolves.toEqual({
      asset: { id: assetId, status: "scanning" }
    });
    expect(worker.enqueue).toHaveBeenCalledWith(assetId);
  });

  it("binds only the exact approved unused owner-and-scope assets under row locks", async () => {
    const db: any = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      mediaAsset: {
        findMany: jest.fn().mockResolvedValue([{
          id: assetId,
          uploaderId: "customer-1",
          purpose: "orderSupportFact",
          supportTicketId: "ticket-1",
          status: "approved"
        }])
      },
      controlledCaseEvidenceAttachment: { create: jest.fn().mockResolvedValue({ id: "binding-1" }) }
    };

    await service.bindSupportFact(db, {
      assetIds: [assetId],
      userId: "customer-1",
      supportTicketId: "ticket-1",
      orderSupportFactId: "fact-1"
    });

    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(db.mediaAsset.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: { in: [assetId] },
        uploaderId: "customer-1",
        purpose: "orderSupportFact",
        supportTicketId: "ticket-1",
        status: "approved",
        controlledCaseAttachment: null
      })
    });
    expect(db.controlledCaseEvidenceAttachment.create).toHaveBeenCalledWith({
      data: {
        mediaAssetId: assetId,
        purpose: "orderSupportFact",
        boundByUserId: "customer-1",
        orderSupportFactId: "fact-1"
      }
    });
  });

  it("single-binds approved appeal evidence to the exact created appeal", async () => {
    const db: any = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      mediaAsset: {
        findMany: jest.fn().mockResolvedValue([{
          id: assetId,
          uploaderId: "customer-1",
          purpose: "userAccountAppeal",
          userAccountActionId: "action-1",
          status: "approved"
        }])
      },
      controlledCaseEvidenceAttachment: { create: jest.fn() }
    };

    await service.bindUserAccountAppeal(db, {
      assetIds: [assetId],
      userId: "customer-1",
      actionId: "action-1",
      appealId: "appeal-1"
    });

    expect(db.controlledCaseEvidenceAttachment.create).toHaveBeenCalledWith({
      data: {
        mediaAssetId: assetId,
        purpose: "userAccountAppeal",
        boundByUserId: "customer-1",
        userAccountAppealId: "appeal-1"
      }
    });
  });

  it("fails closed when any requested asset is pending, expired, reused or foreign", async () => {
    const db: any = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      mediaAsset: { findMany: jest.fn().mockResolvedValue([]) },
      controlledCaseEvidenceAttachment: { create: jest.fn() }
    };

    await expect(service.bindSupportFact(db, {
      assetIds: [assetId],
      userId: "customer-1",
      supportTicketId: "ticket-1",
      orderSupportFactId: "fact-1"
    })).rejects.toMatchObject({ code: "CASE_EVIDENCE_ASSET_INVALID", status: 422 });
    expect(db.controlledCaseEvidenceAttachment.create).not.toHaveBeenCalled();
  });

  it("issues read URLs only inside the existing participant or staff assignment boundary", async () => {
    const attachment = {
      id: "binding-1",
      mediaAsset: { status: "approved", expiresAt: new Date(Date.now() + 60_000) },
      orderSupportFact: {
        supportTicket: { userId: "customer-1", assignedToUserId: "support-1" }
      },
      attendanceDisputeStatement: null,
      companionIncidentReport: null
    };
    prisma.controlledCaseEvidenceAttachment.findUnique.mockResolvedValue(attachment);

    await expect(service.createReadUrl(
      { id: "support-2", role: "support" } as any,
      "binding-1"
    )).rejects.toMatchObject({ code: "CASE_EVIDENCE_NOT_FOUND", status: 404 });
    expect(mediaAssets.approvedReadUrl).not.toHaveBeenCalled();

    await expect(service.createReadUrl(
      { id: "support-1", role: "support" } as any,
      "binding-1"
    )).resolves.toMatchObject({ attachmentId: "binding-1", url: "https://storage.example/read" });
  });

  it("limits account-appeal evidence to the appellant or current independent reviewer", async () => {
    const attachment = {
      id: "binding-appeal-1",
      mediaAsset: { status: "approved", expiresAt: new Date(Date.now() + 60_000) },
      orderSupportFact: null,
      attendanceDisputeStatement: null,
      companionIncidentReport: null,
      companionAccountAppeal: null,
      userAccountAppeal: {
        userId: "customer-1",
        assignedToUserId: "admin-reviewer",
        action: { createdById: "admin-original" }
      }
    };
    prisma.controlledCaseEvidenceAttachment.findUnique.mockResolvedValue(attachment);

    await expect(service.createReadUrl(
      { id: "admin-other", role: "admin" } as any,
      attachment.id
    )).rejects.toMatchObject({ code: "CASE_EVIDENCE_NOT_FOUND", status: 404 });

    await expect(service.createReadUrl(
      { id: "admin-reviewer", role: "admin" } as any,
      attachment.id
    )).resolves.toMatchObject({ attachmentId: attachment.id });

    await expect(service.createReadUrl(
      { id: "customer-1", role: "user" } as any,
      attachment.id
    )).resolves.toMatchObject({ attachmentId: attachment.id });
  });

  it("limits companion-appeal evidence to the owner or current independent assignee", async () => {
    const attachment = {
      id: "binding-companion-appeal-1",
      mediaAsset: { status: "approved", expiresAt: new Date(Date.now() + 60_000) },
      orderSupportFact: null,
      attendanceDisputeStatement: null,
      companionIncidentReport: null,
      userAccountAppeal: null,
      companionAccountAppeal: {
        assignedToUserId: "supply-current",
        action: { createdById: "supply-original" },
        companion: { ownerUserId: "owner-1" }
      }
    };
    prisma.controlledCaseEvidenceAttachment.findUnique.mockResolvedValue(attachment);

    for (const user of [
      { id: "supply-other", role: "supply" },
      { id: "admin-other", role: "admin" },
      { id: "supply-original", role: "supply" }
    ]) {
      await expect(service.createReadUrl(user as any, attachment.id))
        .rejects.toMatchObject({ code: "CASE_EVIDENCE_NOT_FOUND", status: 404 });
    }
    for (const user of [
      { id: "supply-current", role: "supply" },
      { id: "owner-1", role: "companion" }
    ]) {
      await expect(service.createReadUrl(user as any, attachment.id))
        .resolves.toMatchObject({ attachmentId: attachment.id });
    }
  });

  it("limits companion incident evidence to its owner, current supply assignee, or admin", async () => {
    const attachment = {
      id: "binding-incident-1",
      mediaAsset: { status: "approved", expiresAt: new Date(Date.now() + 60_000) },
      orderSupportFact: null,
      attendanceDisputeStatement: null,
      userAccountAppeal: null,
      companionAccountAppeal: null,
      companionIncidentReport: {
        assignedToUserId: "supply-current",
        companion: { ownerUserId: "owner-1" }
      }
    };
    prisma.controlledCaseEvidenceAttachment.findUnique.mockResolvedValue(attachment);

    await expect(service.createReadUrl(
      { id: "supply-other", role: "supply" } as any,
      attachment.id
    )).rejects.toMatchObject({ code: "CASE_EVIDENCE_NOT_FOUND", status: 404 });
    for (const user of [
      { id: "supply-current", role: "supply" },
      { id: "owner-1", role: "companion" },
      { id: "admin-1", role: "admin" }
    ]) {
      await expect(service.createReadUrl(user as any, attachment.id))
        .resolves.toMatchObject({ attachmentId: attachment.id });
    }
  });
});
