import "reflect-metadata";

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { ListServiceOfferingsDto } from "./list-service-offerings.dto";

describe("ListServiceOfferingsDto", () => {
  it("normalizes bounded service-catalog pagination", async () => {
    const dto = plainToInstance(ListServiceOfferingsDto, { page: "2", pageSize: "50" });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto).toEqual(expect.objectContaining({ page: 2, pageSize: 50 }));
  });

  it("rejects service-catalog pages above the per-companion catalog limit", async () => {
    const dto = plainToInstance(ListServiceOfferingsDto, { pageSize: "51" });
    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });
});
