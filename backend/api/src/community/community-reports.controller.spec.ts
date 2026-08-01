import { CommunityReportsController } from "./community-reports.controller";

describe("CommunityReportsController", () => {
  it("routes only the authenticated caller to their private receipt list", async () => {
    const community = {
      listMyReportReceipts: jest.fn().mockResolvedValue({
        items: [{ id: "receipt-1", submittedAt: "2026-07-21T00:00:00.000Z", status: "received" }]
      })
    } as any;
    const controller = new CommunityReportsController(community);

    await expect(controller.mine({ id: "reporter-1" } as any)).resolves.toEqual({
      items: [{ id: "receipt-1", submittedAt: "2026-07-21T00:00:00.000Z", status: "received" }]
    });
    expect(community.listMyReportReceipts).toHaveBeenCalledWith(
      "reporter-1",
      expect.objectContaining({ page: 1, pageSize: 20 })
    );
  });
});
