import "reflect-metadata";

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import {
  ListAccountDeletionRequestsDto,
  ListAccountDeletionSettlementOrdersDto
} from "./account-deletion.dto";

describe("ListAccountDeletionRequestsDto", () => {
  it("normalizes page values and accepts active deletion filters", async () => {
    const dto = plainToInstance(ListAccountDeletionRequestsDto, {
      page: "2",
      pageSize: "100",
      status: "processing"
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto).toEqual(expect.objectContaining({ page: 2, pageSize: 100, status: "processing" }));
  });

  it("rejects page sizes above the operational cap", async () => {
    const dto = plainToInstance(ListAccountDeletionRequestsDto, { pageSize: "101" });
    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });
});

describe("ListAccountDeletionSettlementOrdersDto", () => {
  it("normalizes bounded settlement-order pagination", async () => {
    const dto = plainToInstance(ListAccountDeletionSettlementOrdersDto, {
      page: "3",
      pageSize: "25"
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto).toEqual(expect.objectContaining({ page: 3, pageSize: 25 }));
  });

  it("rejects settlement-order page sizes above the operational cap", async () => {
    const dto = plainToInstance(ListAccountDeletionSettlementOrdersDto, { pageSize: "101" });
    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });
});
