import { validate } from "class-validator";

import { SuspendReviewStaffDto } from "./suspend-review-staff.dto";

describe("SuspendReviewStaffDto", () => {
  it("requires an explicit reassign or unassign mode and a safe reason", async () => {
    const dto = Object.assign(new SuspendReviewStaffDto(), {
      handoffMode: "unassign",
      reason: "完成审核人员安全离职交接"
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it("requires a UUID successor for reassignment", async () => {
    const dto = Object.assign(new SuspendReviewStaffDto(), {
      handoffMode: "reassign",
      reason: "案件交给另一名审核员"
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === "replacementReviewerId")).toBe(true);
  });

  it("rejects raw sensitive credentials in the offboarding reason", async () => {
    const dto = Object.assign(new SuspendReviewStaffDto(), {
      handoffMode: "unassign",
      reason: "密码: SecretPassword123!"
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === "reason")).toBe(true);
  });
});
