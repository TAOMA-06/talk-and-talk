import "reflect-metadata";

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { CreateRefundDto } from "./create-refund.dto";

describe("CreateRefundDto", () => {
  it("trims and accepts a bounded refund reason", async () => {
    const dto = plainToInstance(CreateRefundDto, { reason: "  服务与约定不符  " });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.reason).toBe("服务与约定不符");
  });

  it.each([
    {},
    { reason: "   " },
    { reason: "不" },
    { reason: "x".repeat(201) },
    { reason: "银行卡 4111 1111 1111 1111" }
  ])("rejects an absent, unsafe, or out-of-range refund reason %#", async (input) => {
    const errors = await validate(plainToInstance(CreateRefundDto, input));

    expect(errors.map((error) => error.property)).toContain("reason");
  });
});
