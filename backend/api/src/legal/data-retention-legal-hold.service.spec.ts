import { ConfigService } from "@nestjs/config";

import { AuditService } from "../common/audit/audit.service";
import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { DataRetentionLegalHoldService } from "./data-retention-legal-hold.service";

const ADMIN_ONE = "11111111-1111-4111-8111-111111111111";
const ADMIN_TWO = "22222222-2222-4222-8222-222222222222";
const SUBJECT = "33333333-3333-4333-8333-333333333333";
const RECORD_ID = "44444444-4444-4444-8444-444444444444";
const HOLD_ID = "55555555-5555-4555-8555-555555555555";
const ACTION_ID = "66666666-6666-4666-8666-666666666666";

const actorOne = { id: ADMIN_ONE, role: "admin" };
const actorTwo = { id: ADMIN_TWO, role: "admin" };
const now = new Date("2026-08-01T12:00:00.000Z");

const policyValues: Record<string, unknown> = {
  ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_APPROVED: true,
  ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_VERSION: "2026.08-approved",
  ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_APPROVAL_REFERENCE: "legal:approval-2026-08",
  ACCOUNT_DATA_RETENTION_LEGAL_HOLD_REASON_CODES_JSON: JSON.stringify([
    {
      code: "LITIGATION_PRESERVATION",
      actions: ["placement"],
      categories: ["support_disputes_safety"]
    },
    {
      code: "AUTHORITY_RELEASE_CONFIRMED",
      actions: ["release"],
      categories: ["support_disputes_safety"]
    }
  ])
};

function delegate() {
  return {
    count: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn()
  };
}

function retentionRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: RECORD_ID,
    deletionRequestId: "77777777-7777-4777-8777-777777777777",
    userId: SUBJECT,
    category: "support_disputes_safety",
    disposition: "retainedRestricted",
    retentionEndsAt: new Date("2026-07-01T00:00:00.000Z"),
    expiryProcessedAt: null,
    expiryAttemptCount: 3,
    expiryNextAttemptAt: now,
    expiryLastErrorCode: null,
    expiryPhase: "moderation-evidence",
    expiryCursor: "cursor-17",
    expiryLeaseToken: "lease-before-hold",
    expiryLeaseExpiresAt: new Date("2026-08-01T12:05:00.000Z"),
    expiryErasedRecordCount: 17,
    processingRestrictedAt: new Date("2026-01-01T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: now,
    ...overrides
  };
}

function pendingAction(
  action: "placement" | "release" = "placement",
  overrides: Record<string, unknown> = {}
) {
  return {
    id: ACTION_ID,
    retentionRecordId: RECORD_ID,
    legalHoldId: action === "release" ? HOLD_ID : null,
    action,
    status: "pending",
    reasonCode:
      action === "placement" ? "LITIGATION_PRESERVATION" : "AUTHORITY_RELEASE_CONFIRMED",
    authorityReference: "authority:case-2026-001",
    policyVersion: "2026.08-approved",
    policyApprovalReference: "legal:approval-2026-08",
    requestedById: ADMIN_ONE,
    requestedAt: new Date("2026-08-01T10:00:00.000Z"),
    decidedById: null,
    decidedAt: null,
    decisionReference: null,
    decisionReasonCode: null,
    clientRequestId: "request-00000001",
    partialErasurePhase: "moderation-evidence",
    partialErasureCursor: "cursor-17",
    partialErasedRecordCount: 17,
    partialExpiryAttemptCount: 3,
    createdAt: new Date("2026-08-01T10:00:00.000Z"),
    updatedAt: new Date("2026-08-01T10:00:00.000Z"),
    ...overrides
  };
}

function activeHold(overrides: Record<string, unknown> = {}) {
  return {
    id: HOLD_ID,
    retentionRecordId: RECORD_ID,
    placementActionId: "88888888-8888-4888-8888-888888888888",
    placedById: ADMIN_TWO,
    placedAt: new Date("2026-07-01T00:00:00.000Z"),
    releaseActionId: null,
    releasedById: null,
    releasedAt: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides
  };
}

function createDatabase() {
  const db: any = {
    accountDataRetentionRecord: delegate(),
    accountDataRetentionLegalHold: delegate(),
    accountDataRetentionLegalHoldAction: delegate(),
    user: delegate(),
    auditLog: delegate(),
    $queryRaw: jest.fn().mockResolvedValue([{ id: ADMIN_ONE }, { id: SUBJECT }])
  };
  db.$transaction = jest.fn(async (callback: (tx: any) => Promise<unknown>) => callback(db));
  db.user.findUnique.mockResolvedValue({ role: "admin", accountStatus: "active" });
  db.accountDataRetentionRecord.findUnique.mockResolvedValue(retentionRecord());
  db.accountDataRetentionRecord.update.mockImplementation(async ({ data }: any) => ({
    ...retentionRecord(),
    ...data
  }));
  db.accountDataRetentionLegalHold.findFirst.mockResolvedValue(null);
  db.accountDataRetentionLegalHoldAction.findFirst.mockResolvedValue(null);
  db.accountDataRetentionLegalHoldAction.findUnique.mockResolvedValue(null);
  return db;
}

function createService(values: Record<string, unknown> = policyValues) {
  const db = createDatabase();
  const config = {
    get: jest.fn((key: string, fallback?: unknown) =>
      Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback
    )
  };
  const audit = { record: jest.fn().mockResolvedValue({}) };
  const service = new DataRetentionLegalHoldService(
    db as PrismaService,
    config as unknown as ConfigService,
    audit as unknown as AuditService
  );
  return { audit, config, db, service };
}

function placementDto() {
  return {
    reasonCode: "LITIGATION_PRESERVATION",
    authorityReference: "authority:case-2026-001",
    clientRequestId: "request-00000001"
  };
}

function rawSqlAt(db: any, index: number) {
  const query = db.$queryRaw.mock.calls[index][0];
  if (Array.isArray(query)) return query.join("?");
  if (Array.isArray(query?.strings)) return query.strings.join("?");
  return String(query);
}

describe("DataRetentionLegalHoldService", () => {
  it("rejects non-admin actors before reading legal-hold policy or record state", async () => {
    const { config, db, service } = createService();

    await expect(
      service.requestPlacement(
        { id: "support-operator", role: "support" },
        RECORD_ID,
        placementDto()
      )
    ).rejects.toMatchObject({
      code: "DATA_RETENTION_LEGAL_HOLD_ADMIN_REQUIRED",
      status: 403
    });
    expect(config.get).not.toHaveBeenCalled();
    expect(db.accountDataRetentionRecord.findUnique).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("fails closed before opening a mutation transaction when policy evidence is absent", async () => {
    const { db, service } = createService({
      ...policyValues,
      ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_APPROVED: false
    });

    await expect(service.requestPlacement(actorOne, RECORD_ID, placementDto())).rejects.toMatchObject({
      code: "DATA_RETENTION_LEGAL_HOLD_POLICY_BLOCKED",
      status: 503
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("places a provisional barrier after clearing a lease and snapshots partial erasure exactly", async () => {
    const { audit, db, service } = createService();
    const created = pendingAction();
    db.accountDataRetentionLegalHoldAction.create.mockResolvedValue(created);

    const result = await service.requestPlacement(actorOne, RECORD_ID, placementDto());

    expect(db.accountDataRetentionRecord.update).toHaveBeenCalledWith({
      where: { id: RECORD_ID },
      data: {
        expiryLeaseToken: null,
        expiryLeaseExpiresAt: null,
        expiryNextAttemptAt: null
      }
    });
    expect(db.accountDataRetentionLegalHoldAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "placement",
        status: "pending",
        partialErasurePhase: "moderation-evidence",
        partialErasureCursor: "cursor-17",
        partialErasedRecordCount: 17,
        partialExpiryAttemptCount: 3
      })
    });
    expect(db.accountDataRetentionRecord.update.mock.invocationCallOrder[0]).toBeLessThan(
      db.accountDataRetentionLegalHoldAction.create.mock.invocationCallOrder[0]
    );
    expect(rawSqlAt(db, 0)).toContain('FROM "User"');
    expect(rawSqlAt(db, 1)).toContain('FROM "CompanionProfile"');
    expect(rawSqlAt(db, 2)).toContain('FROM "AccountDataRetentionRecord"');
    expect(db.$queryRaw.mock.calls[0][0].values).toEqual([ADMIN_ONE, SUBJECT]);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "data_retention.legal_hold_placement_requested",
        subjectUserIds: [SUBJECT],
        metadata: expect.not.objectContaining({ subjectUserId: expect.anything() })
      }),
      db
    );
    expect(result).toMatchObject({
      action: {
        id: ACTION_ID,
        partialErasure: { erasedRecordCount: 17, attemptCount: 3 }
      },
      legalHold: null,
      wakeRetentionWorker: false
    });
  });

  it("rejects a new placement on an active hold without clearing expiry scheduling", async () => {
    const { db, service } = createService();
    db.accountDataRetentionLegalHold.findFirst.mockResolvedValue({ id: HOLD_ID });

    await expect(service.requestPlacement(actorOne, RECORD_ID, placementDto())).rejects.toMatchObject({
      code: "DATA_RETENTION_LEGAL_HOLD_ALREADY_ACTIVE",
      status: 409
    });
    expect(db.accountDataRetentionRecord.update).not.toHaveBeenCalled();
    expect(db.accountDataRetentionLegalHoldAction.create).not.toHaveBeenCalled();
  });

  it("only rejects terminal expiry, not records with already committed partial erasure", async () => {
    const { db, service } = createService();
    db.accountDataRetentionRecord.findUnique.mockResolvedValue(
      retentionRecord({ expiryProcessedAt: now })
    );

    await expect(service.requestPlacement(actorOne, RECORD_ID, placementDto())).rejects.toMatchObject({
      code: "DATA_RETENTION_RECORD_ALREADY_EXPIRED",
      status: 409
    });
  });

  it("forbids the requester from approving their own placement", async () => {
    const { db, service } = createService();
    const action = pendingAction();
    db.accountDataRetentionLegalHoldAction.findUnique
      .mockResolvedValueOnce({
        id: ACTION_ID,
        retentionRecordId: RECORD_ID,
        legalHoldId: null,
        action: "placement"
      })
      .mockResolvedValueOnce(action);

    await expect(
      service.approveAction(actorOne, ACTION_ID, {
        decisionReference: "approval:decision-2026-001"
      })
    ).rejects.toMatchObject({
      code: "DATA_RETENTION_LEGAL_HOLD_SECOND_REVIEW_REQUIRED",
      status: 403
    });
    expect(db.accountDataRetentionLegalHold.create).not.toHaveBeenCalled();
  });

  it("creates the hold before approving placement so deferred checks close atomically", async () => {
    const { audit, db, service } = createService();
    const action = pendingAction();
    const hold = activeHold({ placementActionId: ACTION_ID, placedById: ADMIN_TWO });
    const approved = pendingAction("placement", {
      status: "approved",
      decidedById: ADMIN_TWO,
      decidedAt: now,
      decisionReference: "approval:decision-2026-001"
    });
    db.accountDataRetentionLegalHoldAction.findUnique
      .mockResolvedValueOnce({
        id: ACTION_ID,
        retentionRecordId: RECORD_ID,
        legalHoldId: null,
        action: "placement"
      })
      .mockResolvedValueOnce(action);
    db.accountDataRetentionLegalHold.create.mockResolvedValue(hold);
    db.accountDataRetentionLegalHoldAction.update.mockResolvedValue(approved);

    const result = await service.approveAction(actorTwo, ACTION_ID, {
      decisionReference: "approval:decision-2026-001"
    });

    expect(db.accountDataRetentionLegalHold.create.mock.invocationCallOrder[0]).toBeLessThan(
      db.accountDataRetentionLegalHoldAction.update.mock.invocationCallOrder[0]
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "data_retention.legal_hold_placement_approved",
        subjectUserIds: [SUBJECT]
      }),
      db
    );
    expect(result).toMatchObject({ legalHold: { id: HOLD_ID, state: "active" } });
  });

  it("releases the hold before approving release and resumes already-due expiry", async () => {
    const { db, service } = createService();
    const action = pendingAction("release");
    const hold = activeHold();
    const released = activeHold({
      releaseActionId: ACTION_ID,
      releasedById: ADMIN_TWO,
      releasedAt: now
    });
    const approved = pendingAction("release", {
      status: "approved",
      decidedById: ADMIN_TWO,
      decidedAt: now,
      decisionReference: "approval:release-2026-001"
    });
    db.accountDataRetentionLegalHoldAction.findUnique
      .mockResolvedValueOnce({
        id: ACTION_ID,
        retentionRecordId: RECORD_ID,
        legalHoldId: HOLD_ID,
        action: "release"
      })
      .mockResolvedValueOnce(action);
    db.accountDataRetentionLegalHold.findUnique.mockResolvedValue(hold);
    db.accountDataRetentionLegalHold.update.mockResolvedValue(released);
    db.accountDataRetentionLegalHoldAction.update.mockResolvedValue(approved);

    const result = await service.approveAction(actorTwo, ACTION_ID, {
      decisionReference: "approval:release-2026-001"
    });

    expect(db.accountDataRetentionLegalHold.update.mock.invocationCallOrder[0]).toBeLessThan(
      db.accountDataRetentionLegalHoldAction.update.mock.invocationCallOrder[0]
    );
    expect(db.accountDataRetentionLegalHoldAction.update.mock.invocationCallOrder[0]).toBeLessThan(
      db.accountDataRetentionRecord.update.mock.invocationCallOrder[0]
    );
    expect(db.accountDataRetentionRecord.update).toHaveBeenCalledWith({
      where: { id: RECORD_ID },
      data: {
        expiryLeaseToken: null,
        expiryLeaseExpiresAt: null,
        expiryNextAttemptAt: expect.any(Date)
      }
    });
    expect(result.wakeRetentionWorker).toBe(true);
  });

  it("rejects placement before rescheduling due expiry, while a rejected release remains held", async () => {
    const placement = createService();
    const placementAction = pendingAction();
    const rejectedPlacement = pendingAction("placement", {
      status: "rejected",
      decidedById: ADMIN_TWO,
      decidedAt: now,
      decisionReference: "decision:reject-2026-001",
      decisionReasonCode: "REQUEST_EVIDENCE_INVALID"
    });
    placement.db.accountDataRetentionLegalHoldAction.findUnique
      .mockResolvedValueOnce({
        id: ACTION_ID,
        retentionRecordId: RECORD_ID,
        legalHoldId: null,
        action: "placement"
      })
      .mockResolvedValueOnce(placementAction);
    placement.db.accountDataRetentionLegalHoldAction.update.mockResolvedValue(rejectedPlacement);

    const placementResult = await placement.service.rejectAction(actorTwo, ACTION_ID, {
      decisionReference: "decision:reject-2026-001",
      decisionReasonCode: "REQUEST_EVIDENCE_INVALID"
    });

    expect(
      placement.db.accountDataRetentionLegalHoldAction.update.mock.invocationCallOrder[0]
    ).toBeLessThan(placement.db.accountDataRetentionRecord.update.mock.invocationCallOrder[0]);
    expect(placementResult.wakeRetentionWorker).toBe(true);

    const release = createService();
    const releaseAction = pendingAction("release");
    release.db.accountDataRetentionLegalHoldAction.findUnique
      .mockResolvedValueOnce({
        id: ACTION_ID,
        retentionRecordId: RECORD_ID,
        legalHoldId: HOLD_ID,
        action: "release"
      })
      .mockResolvedValueOnce(releaseAction);
    release.db.accountDataRetentionLegalHold.findUnique.mockResolvedValue(activeHold());
    release.db.accountDataRetentionLegalHoldAction.update.mockResolvedValue(
      pendingAction("release", {
        status: "rejected",
        decidedById: ADMIN_TWO,
        decidedAt: now,
        decisionReference: "decision:reject-2026-002",
        decisionReasonCode: "REQUEST_EVIDENCE_INVALID"
      })
    );

    const releaseResult = await release.service.rejectAction(actorTwo, ACTION_ID, {
      decisionReference: "decision:reject-2026-002",
      decisionReasonCode: "REQUEST_EVIDENCE_INVALID"
    });

    expect(release.db.accountDataRetentionRecord.update).not.toHaveBeenCalled();
    expect(releaseResult).toMatchObject({
      legalHold: { id: HOLD_ID, state: "active" },
      wakeRetentionWorker: false
    });
  });

  it("returns an existing request only when the client id payload is identical", async () => {
    const { db, service } = createService();
    db.accountDataRetentionLegalHoldAction.findUnique.mockResolvedValue(pendingAction());

    await expect(service.requestPlacement(actorOne, RECORD_ID, placementDto())).resolves.toMatchObject({
      action: { id: ACTION_ID }
    });
    await expect(
      service.requestPlacement(actorOne, RECORD_ID, {
        ...placementDto(),
        authorityReference: "authority:case-different"
      })
    ).rejects.toBeInstanceOf(AppException);
    expect(db.accountDataRetentionLegalHoldAction.create).not.toHaveBeenCalled();
  });

  it("pages more than one hundred place/release cycles without an unbounded hold query", async () => {
    const { db, service } = createService();
    const pageActions = Array.from({ length: 50 }, (_, index) => {
      const isPlacement = index % 2 === 0;
      return pendingAction(isPlacement ? "placement" : "release", {
        id: `action-page-3-${index}`,
        legalHoldId: isPlacement ? null : `hold-page-3-${index}`,
        status: "approved",
        decidedById: ADMIN_TWO,
        decidedAt: now,
        decisionReference: `decision:page-3-${index}`
      });
    });
    db.accountDataRetentionRecord.findUnique.mockResolvedValue(retentionRecord());
    db.accountDataRetentionLegalHoldAction.findMany.mockResolvedValue(pageActions);
    db.accountDataRetentionLegalHoldAction.count.mockResolvedValue(250);
    db.accountDataRetentionLegalHold.findMany.mockResolvedValue([]);

    const result = await service.listLegalHoldHistory(actorOne, RECORD_ID, {
      page: 3,
      pageSize: 50
    });

    expect(db.accountDataRetentionLegalHoldAction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 100, take: 50 })
    );
    expect(db.accountDataRetentionLegalHold.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ retentionRecordId: RECORD_ID, OR: expect.any(Array) }),
        take: 50
      })
    );
    expect(result).toMatchObject({
      holdsScope: "currentActionPage",
      pagination: { page: 3, pageSize: 50, total: 250, totalPages: 5 }
    });
  });
});
