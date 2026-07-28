import { ReviewCaseService } from "./review-case.service";
import { ReviewModerationService } from "./review-moderation.service";

describe("ReviewModerationService", () => {
  const moderation = {
    overview: jest.fn(),
    listCases: jest.fn(),
    getCase: jest.fn(),
    conversationEvidence: jest.fn(),
    applyAction: jest.fn(),
    createLabel: jest.fn(),
    exportLabels: jest.fn()
  };
  const reviewer = { id: "reviewer-1", username: "reviewer.liu", displayName: "刘审核", role: "reviewer" as const };
  const lead = { id: "lead-1", username: "lead.chen", displayName: "陈负责人", role: "lead" as const };
  let service: ReviewModerationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ReviewModerationService(moderation as unknown as ReviewCaseService);
  });

  it("requires a reason before a high-risk reviewer decision reaches the business layer", async () => {
    await expect(service.applyAction("case-1", reviewer, "confirmViolation")).rejects.toMatchObject({
      code: "REVIEW_DECISION_NOTE_REQUIRED"
    });
    expect(moderation.applyAction).not.toHaveBeenCalled();
  });

  it("keeps chat restrictions with a review lead", async () => {
    await expect(service.applyAction("case-1", reviewer, "restrict24h", "重复违规")).rejects.toMatchObject({
      code: "REVIEW_LEAD_REQUIRED"
    });
    expect(moderation.applyAction).not.toHaveBeenCalled();
  });

  it("passes a typed review-staff actor into the controlled decision channel", async () => {
    moderation.applyAction.mockResolvedValue({ case: { id: "case-1" } });

    await service.applyAction("case-1", lead, "restrict7d", "高风险重复违规，升级限言");

    expect(moderation.applyAction).toHaveBeenCalledWith("case-1", {
      id: "lead-1",
      kind: "reviewStaff",
      displayName: "陈负责人",
      role: "lead"
    }, "restrict7d", "高风险重复违规，升级限言");
  });
});
