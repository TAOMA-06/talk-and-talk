import { ControlledCaseEvidenceService } from "./controlled-case-evidence.service";

const assetId = "11111111-1111-4111-8111-111111111111";

describe("ControlledCaseEvidenceService", () => {
  const prisma: any = {
    supportTicket: { findUnique: jest.fn() },
    attendanceDispute: { findUnique: jest.fn() },
    companionProfile: { findFirst: jest.fn() },
    controlledCaseEvidenceAttachment: { findUnique: jest.fn() }
  };
  const mediaAssets: any = {
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
    service = new ControlledCaseEvidenceService(prisma, mediaAssets, worker);
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
});
