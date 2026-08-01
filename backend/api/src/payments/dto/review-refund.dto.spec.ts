import "reflect-metadata";

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { ListRefundReviewQueueDto } from "./review-refund.dto";

describe("ListRefundReviewQueueDto", () => {
  it("normalizes bounded pagination and an actionable status filter", async () => {
    const dto = plainToInstance(ListRefundReviewQueueDto, {
      page: "3",
      pageSize: "100",
      status: "failed"
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto).toEqual(expect.objectContaining({ page: 3, pageSize: 100, status: "failed" }));
  });

  it("rejects an unbounded page size and terminal status", async () => {
    const oversized = plainToInstance(ListRefundReviewQueueDto, { pageSize: "101" });
    const terminal = plainToInstance(ListRefundReviewQueueDto, { status: "success" });

    await expect(validate(oversized)).resolves.not.toHaveLength(0);
    await expect(validate(terminal)).resolves.not.toHaveLength(0);
  });
});
