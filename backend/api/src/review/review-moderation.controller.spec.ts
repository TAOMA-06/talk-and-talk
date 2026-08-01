import "reflect-metadata";

import { GUARDS_METADATA } from "@nestjs/common/constants";

import { REVIEW_ROLES_KEY } from "./decorators/review-roles.decorator";
import { ReviewJwtAuthGuard } from "./guards/review-jwt-auth.guard";
import { ReviewRolesGuard } from "./guards/review-roles.guard";
import { ReviewModerationController } from "./review-moderation.controller";
import { ReviewModerationService } from "./review-moderation.service";
import { ReviewStaffOffboardingService } from "./review-staff-offboarding.service";

describe("ReviewModerationController staff offboarding", () => {
  const lead = {
    id: "11111111-1111-4111-8111-111111111111",
    username: "lead.chen",
    displayName: "陈负责人",
    role: "lead" as const
  };
  const moderation = {
    listActiveReviewers: jest.fn()
  };
  const offboarding = {
    listStaff: jest.fn(),
    suspend: jest.fn()
  };
  let controller: ReviewModerationController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ReviewModerationController(
      moderation as unknown as ReviewModerationService,
      offboarding as unknown as ReviewStaffOffboardingService
    );
  });

  it("delegates staff listing and suspension only through the independent review service", async () => {
    offboarding.listStaff.mockResolvedValue({ items: [] });
    offboarding.suspend.mockResolvedValue({ staff: { status: "suspended" } });
    const dto = { handoffMode: "unassign" as const, reason: "安全离职交接" };

    const query = { page: 2, pageSize: 25 };
    await controller.reviewStaffOffboarding(lead, query);
    await controller.suspendReviewStaff(lead, "22222222-2222-4222-8222-222222222222", dto);

    expect(offboarding.listStaff).toHaveBeenCalledWith(lead, query);
    expect(offboarding.suspend).toHaveBeenCalledWith(
      lead,
      "22222222-2222-4222-8222-222222222222",
      dto
    );
  });

  it("passes the bounded active-reviewer search query through unchanged", async () => {
    moderation.listActiveReviewers.mockResolvedValue({ items: [], pagination: { total: 0 } });
    const query = {
      status: "active" as const,
      role: "reviewer" as const,
      keyword: "王",
      page: 3,
      pageSize: 20
    };

    await controller.activeReviewers(lead, query);

    expect(moderation.listActiveReviewers).toHaveBeenCalledWith(lead, query);
  });

  it("keeps the controller behind review JWT guards and both operations lead-only", () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, ReviewModerationController) as unknown[];
    expect(guards).toEqual(expect.arrayContaining([ReviewJwtAuthGuard, ReviewRolesGuard]));
    expect(Reflect.getMetadata(
      REVIEW_ROLES_KEY,
      ReviewModerationController.prototype.reviewStaffOffboarding
    )).toEqual(["lead"]);
    expect(Reflect.getMetadata(
      REVIEW_ROLES_KEY,
      ReviewModerationController.prototype.suspendReviewStaff
    )).toEqual(["lead"]);
  });
});
