import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import {
  CreateCompanionAccountActionDto,
  ListCompanionLifecycleAdminDto
} from "./companion-lifecycle.dto";

describe("CreateCompanionAccountActionDto", () => {
  const validInput = {
    companionId: "c1",
    kind: "warning" as const,
    reasonCode: "quality-warning",
    message: "服务质量复核发现需要改进的事项，请按要求完成整改。"
  };

  it("accepts existing opaque companion identifiers instead of requiring UUIDs", async () => {
    const dto = Object.assign(new CreateCompanionAccountActionDto(), validInput);

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it("rejects control characters in companion identifiers", async () => {
    const dto = Object.assign(new CreateCompanionAccountActionDto(), {
      ...validInput,
      companionId: "c1\nforged"
    });

    const errors = await validate(dto);

    expect(errors.map((error) => error.property)).toContain("companionId");
  });
});

describe("ListCompanionLifecycleAdminDto", () => {
  it("transforms and accepts bounded appeal pagination", async () => {
    const dto = plainToInstance(ListCompanionLifecycleAdminDto, {
      appealStatus: "pending",
      page: "2",
      pageSize: "50"
    });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto).toMatchObject({ page: 2, pageSize: 50 });
  });

  it("rejects invalid page numbers and oversized pages", async () => {
    const dto = plainToInstance(ListCompanionLifecycleAdminDto, {
      page: "0",
      pageSize: "101"
    });

    const errors = await validate(dto);

    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining([
      "page",
      "pageSize"
    ]));
  });
});
