import "reflect-metadata";

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { ExportReviewLabelsDto } from "./export-review-labels.dto";

describe("ExportReviewLabelsDto", () => {
  it("accepts a bounded fixed-snapshot continuation", async () => {
    const dto = plainToInstance(ExportReviewLabelsDto, {
      limit: "500",
      cursor: "opaque-cursor",
      snapshotAt: "2026-08-01T00:00:00.000Z"
    });
    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.limit).toBe(500);
  });

  it("rejects an export page large enough to recreate the former unbounded response", async () => {
    const dto = plainToInstance(ExportReviewLabelsDto, { limit: "501" });
    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });
});
