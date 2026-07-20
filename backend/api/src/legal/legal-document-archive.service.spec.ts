import { LegalDocumentArchiveService } from "./legal-document-archive.service";

describe("LegalDocumentArchiveService", () => {
  const prisma = {
    legalDocumentVersion: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn()
    }
  } as any;
  let service: LegalDocumentArchiveService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LegalDocumentArchiveService(prisma);
  });

  it("publishes a versioned HTML snapshot once", async () => {
    prisma.legalDocumentVersion.findUnique.mockResolvedValue(null);
    prisma.legalDocumentVersion.create.mockResolvedValue({ id: "doc-1", version: "1.0", html: "<h1>Terms</h1>" });

    await service.ensureSnapshot("terms", "1.0", "<h1>Terms</h1>");

    expect(prisma.legalDocumentVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ documentType: "terms", version: "1.0", html: "<h1>Terms</h1>" })
    }));
  });

  it("rejects a changed document published under an existing version", async () => {
    const originalHash = "a980d3ada6d8bfcda74075f046ab3b9bd415fd0e6287af9c6c7f7fce9a70ea7a";
    prisma.legalDocumentVersion.findUnique.mockResolvedValue({ contentHash: originalHash });

    await expect(service.ensureSnapshot("terms", "1.0", "<h1>Changed</h1>")).rejects.toThrow("changed without a version bump");
    expect(prisma.legalDocumentVersion.create).not.toHaveBeenCalled();
  });

  it("requires privacy and terms snapshots before recording current consent", async () => {
    prisma.legalDocumentVersion.findMany.mockResolvedValue([{ documentType: "privacy" }]);

    await expect(service.assertVersionPublished("1.0", ["privacy", "terms"]))
      .rejects.toThrow("Current legal document snapshots are not published: terms");
  });
});
