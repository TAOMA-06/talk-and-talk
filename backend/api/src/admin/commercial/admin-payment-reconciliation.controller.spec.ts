import { AdminPaymentReconciliationController } from "./admin-payment-reconciliation.controller";

describe("AdminPaymentReconciliationController", () => {
  const reconciliation = {
    readiness: jest.fn(),
    createRuns: jest.fn(),
    retryRun: jest.fn(),
    listRuns: jest.fn(),
    listIssues: jest.fn(),
    claimIssue: jest.fn(),
    submitResolutionProposal: jest.fn(),
    reviewResolutionProposal: jest.fn()
  };
  const controller = new AdminPaymentReconciliationController(reconciliation as any);
  const actor = { id: "finance-1", role: "finance" } as any;

  beforeEach(() => jest.clearAllMocks());

  it("forwards bounded list filters without inventing reconciliation facts", async () => {
    const query = { page: 2, pageSize: 50, status: "failed", billDate: "2026-07-31" } as any;
    reconciliation.listRuns.mockResolvedValue({ items: [], pagination: { page: 2, pageSize: 50, total: 0 } });

    await expect(controller.runs(query)).resolves.toEqual(expect.objectContaining({ items: [] }));
    expect(reconciliation.listRuns).toHaveBeenCalledWith(query);

    reconciliation.listIssues.mockResolvedValue({ items: [], pagination: { page: 1, pageSize: 50, total: 0 } });
    await controller.issues(actor, { page: 1, pageSize: 50 } as any);
    expect(reconciliation.listIssues).toHaveBeenCalledWith(actor, { page: 1, pageSize: 50 });
  });

  it("passes the authenticated finance actor into every mutation", async () => {
    reconciliation.createRuns.mockResolvedValue({ billDate: "2026-07-31", created: 4 });
    reconciliation.claimIssue.mockResolvedValue({ id: "issue-1", status: "investigating" });
    reconciliation.submitResolutionProposal.mockResolvedValue({ id: "issue-1", status: "investigating" });
    reconciliation.reviewResolutionProposal.mockResolvedValue({ id: "issue-1", status: "acceptedException" });

    await controller.createRuns(actor, { billDate: "2026-07-31" });
    await controller.claimIssue(actor, "00000000-0000-4000-8000-000000000001");
    await controller.submitResolution(actor, "00000000-0000-4000-8000-000000000001", {
      outcome: "acceptedException",
      resolutionCode: "APPROVED_PROVIDER_EXCEPTION",
      note: "Provider exception verified against the controlled statement.",
      evidenceReference: "finance:reconciliation/2026-07-31/case-1",
      evidenceDigestSha256: "a".repeat(64)
    });
    await controller.reviewResolution(actor, "00000000-0000-4000-8000-000000000001", {
      decision: "approve",
      note: "Independent reviewer verified the immutable evidence digest."
    });

    expect(reconciliation.createRuns).toHaveBeenCalledWith(actor, "2026-07-31");
    expect(reconciliation.claimIssue).toHaveBeenCalledWith(actor, "00000000-0000-4000-8000-000000000001");
    expect(reconciliation.submitResolutionProposal).toHaveBeenCalledWith(
      actor,
      "00000000-0000-4000-8000-000000000001",
      expect.objectContaining({ outcome: "acceptedException" })
    );
    expect(reconciliation.reviewResolutionProposal).toHaveBeenCalledWith(
      actor,
      "00000000-0000-4000-8000-000000000001",
      expect.objectContaining({ decision: "approve" })
    );
  });
});
