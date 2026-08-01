import "reflect-metadata";

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import {
  ListActiveReviewStaffQueryDto,
  ListReviewStaffOffboardingQueryDto
} from "./list-review-staff.dto";

describe("review staff list DTOs", () => {
  it("transforms bounded pagination and accepts strict staff filters", async () => {
    const value = plainToInstance(ListReviewStaffOffboardingQueryDto, {
      keyword: "审核",
      status: "suspended",
      role: "reviewer",
      page: "3",
      pageSize: "25"
    });

    await expect(validate(value)).resolves.toHaveLength(0);
    expect(value).toMatchObject({ page: 3, pageSize: 25 });
  });

  it("rejects whitespace keywords, unknown filters, and oversized pages", async () => {
    const value = plainToInstance(ListReviewStaffOffboardingQueryDto, {
      keyword: "   ",
      status: "deleted",
      role: "admin",
      page: "0",
      pageSize: "101"
    });

    const errors = await validate(value);
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining([
      "keyword",
      "status",
      "role",
      "page",
      "pageSize"
    ]));
  });

  it("does not let the assignment endpoint request suspended identities", async () => {
    const value = plainToInstance(ListActiveReviewStaffQueryDto, {
      status: "suspended",
      page: "1",
      pageSize: "20"
    });

    const errors = await validate(value);
    expect(errors.map((error) => error.property)).toContain("status");
  });
});
