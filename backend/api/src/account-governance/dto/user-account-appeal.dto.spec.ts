import "reflect-metadata";

import { validate } from "class-validator";

import { UpdateAccountStatusDto } from "../../admin/dto/update-account-status.dto";
import {
  AssignUserAccountAppealDto,
  CreateUserAccountAppealDto,
  ListUserAccountAppealsDto,
  ResolveUserAccountAppealDto
} from "./user-account-appeal.dto";

describe("consumer account-action and appeal DTOs", () => {
  it("requires controlled reason and evidence references for every new restriction or ban", async () => {
    const missing = Object.assign(new UpdateAccountStatusDto(), {
      status: "restricted",
      reasonCode: "POLICY_BOUNDARY",
      reason: "多次违反平台安全边界，账号暂时受限。"
    });
    const malformed = Object.assign(new UpdateAccountStatusDto(), {
      status: "banned",
      reasonCode: "COMMERCIAL_ABUSE",
      reason: "核验到持续性商业滥用行为，账号现已封禁。",
      sourceType: "freeFormSource",
      sourceReference: "raw evidence with spaces",
      evidenceReference: "https://vault.invalid/item?id=secret"
    });
    const valid = Object.assign(new UpdateAccountStatusDto(), {
      status: "restricted",
      reasonCode: "POLICY_BOUNDARY",
      reason: "多次违反平台安全边界，账号暂时受限。",
      sourceType: "moderationCase",
      sourceReference: "case/moderation-100",
      evidenceReference: "evidence-vault/item-100"
    });
    const restoration = Object.assign(new UpdateAccountStatusDto(), {
      status: "active",
      reason: "独立复核完成后恢复账号状态。"
    });
    const referencedRestoration = Object.assign(new UpdateAccountStatusDto(), {
      status: "active",
      reason: "独立复核完成后恢复账号状态。",
      sourceType: "userAccountAction",
      sourceReference: "action-100"
    });

    expect((await validate(missing)).map((error) => error.property)).toEqual(expect.arrayContaining([
      "sourceType",
      "sourceReference",
      "evidenceReference"
    ]));
    expect((await validate(malformed)).map((error) => error.property)).toEqual(expect.arrayContaining([
      "sourceType",
      "sourceReference",
      "evidenceReference"
    ]));
    await expect(validate(valid)).resolves.toEqual([]);
    await expect(validate(restoration)).resolves.toEqual([]);
    await expect(validate(referencedRestoration)).resolves.toEqual([]);
  });

  it("bounds user statements and rejects obvious operational secrets", async () => {
    const valid = Object.assign(new CreateUserAccountAppealDto(), {
      statement: "我认为该处置依据不完整，请重新核验全部事实。",
      evidenceAssetIds: ["11111111-1111-4111-8111-111111111111"]
    });
    const sensitive = Object.assign(new CreateUserAccountAppealDto(), {
      statement: "请核验，银行卡 4111 1111 1111 1111 是我的凭据。"
    });
    const arbitraryReferences = Object.assign(new CreateUserAccountAppealDto(), {
      statement: "我认为该处置依据不完整，请重新核验全部事实。",
      evidenceAssetIds: ["https://external.invalid/evidence"]
    });

    await expect(validate(valid)).resolves.toEqual([]);
    expect((await validate(sensitive))[0]?.constraints).toEqual(expect.objectContaining({
      isSafeOperationalText: expect.any(String)
    }));
    expect((await validate(arbitraryReferences)).some((error) =>
      error.property === "evidenceAssetIds"
    )).toBe(true);
  });

  it("allows only bounded queue filters, UUID assignments, and terminal decisions", async () => {
    const query = Object.assign(new ListUserAccountAppealsDto(), {
      status: "pending",
      page: 1,
      pageSize: 101
    });
    const assignment = Object.assign(new AssignUserAccountAppealDto(), {
      assignedToUserId: "not-a-uuid"
    });
    const resolution = Object.assign(new ResolveUserAccountAppealDto(), {
      status: "pending",
      resolution: "复核仍在进行中，不能作为终态提交。"
    });

    expect((await validate(query)).some((error) => error.property === "pageSize")).toBe(true);
    expect((await validate(assignment)).some((error) => error.property === "assignedToUserId")).toBe(true);
    expect((await validate(resolution)).some((error) => error.property === "status")).toBe(true);
  });
});
