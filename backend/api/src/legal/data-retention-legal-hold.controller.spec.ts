import "reflect-metadata";

import { RequestMethod } from "@nestjs/common";
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";

import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { DataRetentionLegalHoldController } from "./data-retention-legal-hold.controller";

describe("DataRetentionLegalHoldController", () => {
  const service = {
    policyStatus: jest.fn(),
    listRetentionRecords: jest.fn(),
    listLegalHoldHistory: jest.fn(),
    requestPlacement: jest.fn(),
    requestRelease: jest.fn(),
    approveAction: jest.fn(),
    rejectAction: jest.fn()
  } as any;
  const controller = new DataRetentionLegalHoldController(service);
  const actor = { id: "admin-1", role: "admin" } as any;

  beforeEach(() => jest.clearAllMocks());

  it("keeps the entire surface behind JWT and the admin role boundary", () => {
    expect(Reflect.getMetadata(PATH_METADATA, DataRetentionLegalHoldController)).toBe(
      "admin/data-retention"
    );
    expect(Reflect.getMetadata(ROLES_KEY, DataRetentionLegalHoldController)).toEqual([
      "admin"
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, DataRetentionLegalHoldController)).toEqual([
      JwtAuthGuard,
      RolesGuard
    ]);
  });

  it("publishes explicit queue, history, request and two-person decision routes", () => {
    const prototype = DataRetentionLegalHoldController.prototype;
    const expected = [
      [prototype.policyStatus, "legal-hold-policy", RequestMethod.GET],
      [prototype.listRecords, "records", RequestMethod.GET],
      [prototype.listHistory, "records/:retentionRecordId/legal-holds", RequestMethod.GET],
      [
        prototype.requestPlacement,
        "records/:retentionRecordId/legal-hold-placement-requests",
        RequestMethod.POST
      ],
      [prototype.requestRelease, "legal-holds/:legalHoldId/release-requests", RequestMethod.POST],
      [prototype.approve, "legal-hold-actions/:actionId/approvals", RequestMethod.POST],
      [prototype.reject, "legal-hold-actions/:actionId/rejections", RequestMethod.POST]
    ] as const;

    for (const [handler, path, method] of expected) {
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
    }
  });

  it("passes the authenticated administrator and opaque ids into every mutation", async () => {
    const request = {
      reasonCode: "LITIGATION_PRESERVATION",
      authorityReference: "authority:case-2026-001",
      clientRequestId: "request-00000001"
    };
    const approval = { decisionReference: "decision:approval-2026-001" };
    const rejection = {
      decisionReference: "decision:rejection-2026-001",
      decisionReasonCode: "REQUEST_EVIDENCE_INVALID"
    };

    await controller.requestPlacement(actor, "record-1", request);
    await controller.requestRelease(actor, "hold-1", request);
    await controller.approve(actor, "action-1", approval);
    await controller.reject(actor, "action-2", rejection);

    expect(service.requestPlacement).toHaveBeenCalledWith(actor, "record-1", request);
    expect(service.requestRelease).toHaveBeenCalledWith(actor, "hold-1", request);
    expect(service.approveAction).toHaveBeenCalledWith(actor, "action-1", approval);
    expect(service.rejectAction).toHaveBeenCalledWith(actor, "action-2", rejection);
  });
});
