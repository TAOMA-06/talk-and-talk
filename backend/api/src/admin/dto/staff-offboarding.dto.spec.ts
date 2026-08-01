import "reflect-metadata";

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import {
  ListEligibleStaffSuccessorsDto,
  ListStaffCredentialsDto,
  SuspendStaffCredentialDto
} from "./staff-offboarding.dto";

describe("SuspendStaffCredentialDto", () => {
  it("accepts a controlled reason, successor, operation id and confirmation", async () => {
    const value = plainToInstance(SuspendStaffCredentialDto, {
      reason: "Employment ended; revoke commercial access and hand off open work.",
      replacementUserId: "33333333-3333-4333-8333-333333333333",
      operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      confirmationCode: "222222"
    });

    await expect(validate(value)).resolves.toHaveLength(0);
  });

  it("rejects sensitive operational text and malformed confirmation evidence", async () => {
    const value = plainToInstance(SuspendStaffCredentialDto, {
      reason: "password=SuperSecret123! must be removed",
      replacementUserId: "not-a-user-id",
      operationId: "reused-operation",
      confirmationCode: "wrong-code"
    });

    const errors = await validate(value);
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining([
      "reason",
      "replacementUserId",
      "operationId",
      "confirmationCode"
    ]));
  });
});

describe("commercial staff list DTOs", () => {
  it("accepts strict directory and successor-search pagination", async () => {
    const directory = plainToInstance(ListStaffCredentialsDto, {
      keyword: "客服",
      status: "active",
      role: "support",
      page: "2",
      pageSize: "25"
    });
    const successors = plainToInstance(ListEligibleStaffSuccessorsDto, {
      keyword: "security",
      excludeUserId: "22222222-2222-4222-8222-222222222222",
      page: "3",
      pageSize: "50"
    });

    await expect(validate(directory)).resolves.toHaveLength(0);
    await expect(validate(successors)).resolves.toHaveLength(0);
    expect(directory).toMatchObject({ page: 2, pageSize: 25 });
    expect(successors).toMatchObject({ page: 3, pageSize: 50 });
  });

  it("rejects unbounded or unknown directory filters", async () => {
    const directory = plainToInstance(ListStaffCredentialsDto, {
      keyword: "   ",
      status: "deleted",
      role: "owner",
      page: "0",
      pageSize: "101"
    });

    const errors = await validate(directory);
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining([
      "keyword",
      "status",
      "role",
      "page",
      "pageSize"
    ]));
  });
});
