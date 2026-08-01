import "reflect-metadata";

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import {
  CreateWeChatReconciliationRunsDto,
  ListWeChatReconciliationIssuesDto,
  ListWeChatReconciliationRunsDto,
  ReviewWeChatReconciliationResolutionDto,
  SubmitWeChatReconciliationResolutionDto
} from "./wechat-daily-reconciliation.dto";

describe("WeChat daily reconciliation DTOs", () => {
  it("normalizes bounded pagination and accepts only documented run filters", async () => {
    const dto = plainToInstance(ListWeChatReconciliationRunsDto, {
      page: "2",
      pageSize: "100",
      status: "failed",
      billDate: "2026-07-31"
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto).toEqual(expect.objectContaining({ page: 2, pageSize: 100 }));
    expect(await validate(plainToInstance(ListWeChatReconciliationRunsDto, {
      pageSize: "101",
      status: "complete",
      billDate: "31-07-2026"
    }))).not.toHaveLength(0);
  });

  it("rejects impossible filter vocabulary and non-v4 run references", async () => {
    expect(await validate(plainToInstance(ListWeChatReconciliationIssuesDto, {
      status: "closed",
      kind: "freeFormKind",
      runId: "run-1"
    }))).not.toHaveLength(0);
  });

  it.each([
    "localPaymentSuccessProviderNotPaid",
    "providerRefundedLocalUnsettled",
    "providerFundBusinessTypeUnreviewed",
    "localPaymentMissingProviderFundBill"
  ])("accepts the implemented issue kind %s", async (kind) => {
    expect(await validate(plainToInstance(ListWeChatReconciliationIssuesDto, { kind }))).toHaveLength(0);
  });

  it("requires a dated run request and immutable proposal evidence", async () => {
    expect(await validate(plainToInstance(CreateWeChatReconciliationRunsDto, {
      billDate: "2026-07-31"
    }))).toHaveLength(0);

    const valid = plainToInstance(SubmitWeChatReconciliationResolutionDto, {
      outcome: "acceptedException",
      resolutionCode: "APPROVED_PROVIDER_EXCEPTION",
      note: "Provider exception evidence was captured and verified.",
      evidenceReference: "vault/reconciliation/2026-07-31",
      evidenceDigestSha256: "a".repeat(64)
    });
    expect(await validate(valid)).toHaveLength(0);

    const unsafe = plainToInstance(SubmitWeChatReconciliationResolutionDto, {
      outcome: "acceptedException",
      resolutionCode: "free form",
      note: "身份证号 110101199001011234",
      evidenceReference: "short",
      evidenceDigestSha256: "not-a-sha256"
    });
    expect(await validate(unsafe)).not.toHaveLength(0);
  });

  it("allows only explicit independent review decisions with safe notes", async () => {
    expect(await validate(plainToInstance(ReviewWeChatReconciliationResolutionDto, {
      decision: "approve",
      note: "Evidence digest and provider reference were independently verified."
    }))).toHaveLength(0);

    expect(await validate(plainToInstance(ReviewWeChatReconciliationResolutionDto, {
      decision: "override",
      note: "身份证号 110101199001011234"
    }))).not.toHaveLength(0);
  });
});
