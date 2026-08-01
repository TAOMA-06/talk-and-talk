import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { ListOrderTimelineDto } from "./list-order-timeline.dto";

describe("ListOrderTimelineDto", () => {
  it("transforms bounded pagination values", async () => {
    const dto = plainToInstance(ListOrderTimelineDto, { page: "2", pageSize: "50" });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto).toMatchObject({ page: 2, pageSize: 50 });
  });

  it.each([
    { page: "0", pageSize: "20" },
    { page: "1", pageSize: "101" }
  ])("rejects invalid pagination %#", async (input) => {
    const errors = await validate(plainToInstance(ListOrderTimelineDto, input));

    expect(errors.length).toBeGreaterThan(0);
  });
});
