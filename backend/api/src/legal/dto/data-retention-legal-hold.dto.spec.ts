import "reflect-metadata";

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import {
  ApproveDataRetentionLegalHoldActionDto,
  ListDataRetentionLegalHoldHistoryDto,
  ListDataRetentionLegalHoldRecordsDto,
  RejectDataRetentionLegalHoldActionDto,
  RequestDataRetentionLegalHoldActionDto
} from "./data-retention-legal-hold.dto";

describe("data-retention legal-hold DTOs", () => {
  it("accepts controlled request and independent-decision references", async () => {
    const request = plainToInstance(RequestDataRetentionLegalHoldActionDto, {
      reasonCode: "LITIGATION_PRESERVATION",
      authorityReference: "authority:case-2026-001",
      clientRequestId: "request-00000001"
    });
    const approval = plainToInstance(ApproveDataRetentionLegalHoldActionDto, {
      decisionReference: "decision:approval-2026-001"
    });
    const rejection = plainToInstance(RejectDataRetentionLegalHoldActionDto, {
      decisionReference: "decision:rejection-2026-001",
      decisionReasonCode: "REQUEST_EVIDENCE_INVALID"
    });

    await expect(validate(request)).resolves.toHaveLength(0);
    await expect(validate(approval)).resolves.toHaveLength(0);
    await expect(validate(rejection)).resolves.toHaveLength(0);
  });

  it("rejects free text and malformed or undersized controlled identifiers", async () => {
    const request = plainToInstance(RequestDataRetentionLegalHoldActionDto, {
      reasonCode: "court order from Alice",
      authorityReference: "x",
      clientRequestId: "short",
      freeText: "person and case details must not enter the ledger"
    });
    const errors = await validate(request, {
      whitelist: true,
      forbidNonWhitelisted: true
    });

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining([
        "reasonCode",
        "authorityReference",
        "clientRequestId",
        "freeText"
      ])
    );
  });

  it("transforms bounded pagination and rejects unknown queue filters", async () => {
    const records = plainToInstance(ListDataRetentionLegalHoldRecordsDto, {
      category: "support_disputes_safety",
      holdState: "releasePending",
      expiryState: "partiallyErased",
      page: "3",
      pageSize: "25"
    });
    const invalidHistory = plainToInstance(ListDataRetentionLegalHoldHistoryDto, {
      action: "extend",
      status: "cancelled",
      page: "0",
      pageSize: "101"
    });

    await expect(validate(records)).resolves.toHaveLength(0);
    expect(records).toMatchObject({ page: 3, pageSize: 25 });
    const errors = await validate(invalidHistory);
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(["action", "status", "page", "pageSize"])
    );
  });
});
