import { createHash } from "node:crypto";

import { DataRetentionWorker } from "./data-retention.worker";

function legacyRecord(
  category: string,
  phase: string,
  overrides: Record<string, unknown> = {}
) {
  const deletionRequestId = `deletion-${category}`;
  return {
    id: `legacy-retention-${createHash("md5")
      .update(`${deletionRequestId}:${category}`)
      .digest("hex")}`,
    deletionRequestId,
    userId: `user-${category}`,
    category,
    disposition: "pendingErasure",
    policyVersion: "2026.2-technical-baseline",
    policyApprovalStatus: "approved",
    policyApprovalReference: "legal:retention-2026",
    recordCount: 0,
    expiryAttemptCount: 0,
    expiryErasedRecordCount: 0,
    expiryPhase: phase,
    details: { legacyBackfill: true },
    ...overrides
  };
}

function createWorker(options: {
  config?: Record<string, unknown>;
  topLevelRaw?: jest.Mock;
  tx?: Record<string, any>;
} = {}) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $queryRawUnsafe: jest.fn(async (sql: string) => (
      sql.includes("SELECT EXISTS")
        ? [{ exists: false }]
        : [{ count: 0, cursor: null }]
    )),
    $executeRaw: jest.fn().mockResolvedValue(0),
    accountDataRetentionRecord: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0)
    },
    accountDeletionRequest: {
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 0 })
    },
    ...options.tx
  } as any;
  const topLevelRaw = options.topLevelRaw ?? jest.fn().mockResolvedValue([]);
  const prisma = {
    $queryRaw: topLevelRaw,
    $transaction: jest.fn(async (callback: (db: any) => Promise<unknown>) => callback(tx)),
    accountDataRetentionRecord: {
      aggregate: jest.fn().mockResolvedValue({ _min: { expiryNextAttemptAt: null } })
    }
  } as any;
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => {
      if (Object.prototype.hasOwnProperty.call(options.config ?? {}, key)) {
        return options.config?.[key];
      }
      if (key === "NODE_ENV") return "test";
      if (key === "LEGAL_PRIVACY_RETENTION_DAYS") return 365;
      return fallback;
    })
  } as any;
  const audit = { record: jest.fn().mockResolvedValue({}) } as any;
  return {
    worker: new DataRetentionWorker(prisma, config, audit),
    prisma,
    config,
    audit,
    tx,
    topLevelRaw
  };
}

describe("DataRetentionWorker bounded scale controls", () => {
  it("cleans only expired tombstones for the exact completed deletion request in a bounded phase", async () => {
    const { worker, tx } = createWorker();
    tx.$queryRawUnsafe.mockImplementation(async (sql: string) => (
      sql.includes("SELECT EXISTS")
        ? [{ exists: false }]
        : [{ count: 2, cursor: "(4,2)" }]
    ));

    await expect((worker as any).processRetainedPhaseBatch(
      tx,
      "auth_identity_tombstone",
      "deletion-exact",
      "user-exact",
      null
    )).resolves.toEqual({
      affectedCount: 2,
      hasMore: false,
      cursor: "(4,2)"
    });

    const sql = tx.$queryRawUnsafe.mock.calls
      .map(([statement]: [string]) => statement)
      .join("\n");
    expect(sql).toContain('DELETE FROM "AuthIdentityTombstone"');
    expect(sql).toContain('target."deletionRequestId" = $1');
    expect(sql).toContain('target."expiresAt" <= CURRENT_TIMESTAMP');
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(tx.$queryRawUnsafe.mock.calls[0][1]).toBe("deletion-exact");
    expect(tx.$queryRawUnsafe.mock.calls[0][2]).toBe(250);
  });

  it("cleans low-risk rows in independent bounded SKIP LOCKED transactions", async () => {
    const { worker, prisma, tx, audit } = createWorker();
    let mutation = 0;
    tx.$queryRawUnsafe.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT EXISTS")) return [{ exists: false }];
      mutation += 1;
      return [{ count: mutation, cursor: `(0,${mutation})` }];
    });

    await expect(worker.runOnce()).resolves.toEqual(expect.objectContaining({
      skipped: false,
      deletedNotificationDeliveries: 1,
      deletedNotifications: 2,
      deletedSubscriptionGrants: 3,
      deletedRefreshTokens: 4,
      selectedAccountRetentionRecords: 0
    }));

    const mutationSql = tx.$queryRawUnsafe.mock.calls
      .map(([sql]: [string]) => sql)
      .filter((sql: string) => sql.includes("DELETE FROM"));
    expect(mutationSql).toHaveLength(4);
    for (const sql of mutationSql) {
      expect(sql).toContain("FOR UPDATE SKIP LOCKED");
      expect(sql).toContain("LIMIT");
    }
    // Four source batches and one tiny audit transaction; source tables are
    // never grouped into the former all-table cleanup transaction.
    expect(prisma.$transaction).toHaveBeenCalledTimes(5);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "privacy.retention_low_risk_cleanup_completed",
      metadata: expect.objectContaining({ boundedBatchSize: 250 })
    }), tx);
  });

  it("claims due ledger rows atomically and disjointly across replicas", async () => {
    const topLevelRaw = jest.fn().mockResolvedValue([
      { id: "ledger-1", leaseToken: "lease-1" }
    ]);
    const { worker } = createWorker({ topLevelRaw });

    await expect((worker as any).claimDueRetentionRecords(100)).resolves.toEqual([
      { id: "ledger-1", leaseToken: "lease-1" }
    ]);
    const sql = Array.from(topLevelRaw.mock.calls[0][0] as string[]).join("?");
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain('UPDATE "AccountDataRetentionRecord"');
    expect(sql).toContain('"expiryLeaseToken"');
    expect(sql).toContain('"expiryLeaseExpiresAt"');
  });

  it("gates deletion-audit expiry on the forward-only controlled-v3 subject backfill", async () => {
    const topLevelRaw = jest.fn().mockResolvedValue([{
      processed: 17,
      referencesTouched: 5,
      completed: true
    }]);
    const { worker } = createWorker({ topLevelRaw });

    await expect((worker as any).advanceAuditSubjectReferenceBackfill(
      Date.now() + 5_000
    )).resolves.toEqual({
      processed: 17,
      completed: true,
      continuationRequired: false
    });
    const sql = Array.from(topLevelRaw.mock.calls[0][0] as string[]).join("?");
    expect(sql).toContain('backfill_audit_subject_references_v3');
    expect(sql).not.toContain('backfill_audit_subject_references_v2');
  });

  it("commits one legacy-erasure batch and persists the same phase for crash-safe resume", async () => {
    const record = legacyRecord("identity_authentication_profile", "refresh_token");
    const { worker, tx } = createWorker();
    tx.accountDataRetentionRecord.findUnique
      .mockResolvedValueOnce({ userId: record.userId })
      .mockResolvedValueOnce(record);
    tx.accountDeletionRequest.findUnique.mockResolvedValue({
      userId: record.userId,
      status: "completed"
    });
    tx.$queryRaw.mockImplementation(async (parts: TemplateStringsArray) => {
      const sql = Array.from(parts).join("?");
      if (sql.includes('FROM "AccountDataRetentionRecord"')) return [{ id: record.id }];
      return [];
    });
    tx.$queryRawUnsafe.mockImplementation(async (sql: string) => (
      sql.includes("SELECT EXISTS")
        ? [{ exists: true }]
        : [{ count: 250, cursor: "(8,4)" }]
    ));

    await expect((worker as any).processClaimedRetentionRecord({
      id: record.id,
      leaseToken: "lease-a"
    })).resolves.toEqual({
      category: "identity_authentication_profile",
      completed: false,
      progressed: true
    });
    expect(tx.accountDataRetentionRecord.update).toHaveBeenCalledWith({
      where: { id: record.id },
      data: expect.objectContaining({
        expiryPhase: "refresh_token",
        expiryCursor: "refresh_token:(8,4)",
        expiryErasedRecordCount: 250,
        expiryLeaseToken: null,
        expiryLeaseExpiresAt: null
      })
    });
  });

  it("advances only after the current table postcondition is empty", async () => {
    const record = legacyRecord("identity_authentication_profile", "refresh_token", {
      expiryErasedRecordCount: 250
    });
    const { worker, tx } = createWorker();
    tx.accountDataRetentionRecord.findUnique
      .mockResolvedValueOnce({ userId: record.userId })
      .mockResolvedValueOnce(record);
    tx.accountDeletionRequest.findUnique.mockResolvedValue({
      userId: record.userId,
      status: "completed"
    });
    tx.$queryRaw.mockImplementation(async (parts: TemplateStringsArray) => (
      Array.from(parts).join("?").includes('FROM "AccountDataRetentionRecord"')
        ? [{ id: record.id }]
        : []
    ));

    await (worker as any).processClaimedRetentionRecord({ id: record.id, leaseToken: "lease-b" });

    expect(tx.accountDataRetentionRecord.update).toHaveBeenCalledWith({
      where: { id: record.id },
      data: expect.objectContaining({
        expiryPhase: "verification_code",
        expiryErasedRecordCount: 250,
        expiryLeaseToken: null
      })
    });
  });

  it("records deleted only after final category postconditions pass", async () => {
    const record = legacyRecord("identity_authentication_profile", "retention_verify", {
      expiryErasedRecordCount: 875
    });
    const delegates = Object.fromEntries([
      "refreshToken",
      "authIdentity",
      "staffCredential",
      "userProfile",
      "customerAdultEligibility"
    ].map((name) => [name, { count: jest.fn().mockResolvedValue(0) }]));
    const { worker, tx, audit } = createWorker({ tx: delegates });
    tx.accountDataRetentionRecord.findUnique
      .mockResolvedValueOnce({ userId: record.userId })
      .mockResolvedValueOnce(record);
    tx.accountDeletionRequest.findUnique.mockResolvedValue({
      userId: record.userId,
      status: "completed"
    });
    tx.$queryRaw.mockImplementation(async (parts: TemplateStringsArray) => (
      Array.from(parts).join("?").includes('FROM "AccountDataRetentionRecord"')
        ? [{ id: record.id }]
        : []
    ));

    await expect((worker as any).processClaimedRetentionRecord({
      id: record.id,
      leaseToken: "lease-c"
    })).resolves.toEqual({
      category: "identity_authentication_profile",
      completed: true,
      progressed: false
    });
    expect(tx.accountDataRetentionRecord.update).toHaveBeenCalledWith({
      where: { id: record.id },
      data: expect.objectContaining({
        disposition: "deleted",
        expiryPhase: "completed",
        expiryProcessedAt: expect.any(Date),
        expiryLeaseToken: null,
        expiryLeaseExpiresAt: null
      })
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "privacy.retention_category_deleted",
      metadata: expect.objectContaining({ observedErasedRecordCount: 875 })
    }), tx);
  });

  it("keeps legal provenance immutable while approvals claim one disjoint batch", async () => {
    const { worker, tx, audit } = createWorker({
      config: {
        ACCOUNT_DELETION_RETENTION_POLICY_APPROVED: true,
        ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE: "legal:retention-2026"
      }
    });
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: "pending-1" }, { id: "pending-2" }]);

    await expect((worker as any).approvePendingRetentionPolicies()).resolves.toEqual({
      selectedRetentionPolicyApprovals: 2,
      approvedRetentionPolicyRecords: 2,
      continuationRequired: false
    });
    const sql = Array.from(tx.$queryRaw.mock.calls[0][0] as string[]).join("?");
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain("pendingLegalApproval");
    expect(audit.record).toHaveBeenCalledTimes(2);
  });

  it("failure retry is lease-owned, monotonic and releases the claim", async () => {
    const record = legacyRecord("identity_authentication_profile", "auth_identity", {
      expiryAttemptCount: 2
    });
    const { worker, tx } = createWorker();
    tx.$queryRaw.mockResolvedValue([{ id: record.id }]);
    tx.accountDataRetentionRecord.findUnique.mockResolvedValue(record);

    await expect((worker as any).recordExpiryFailure(
      record.id,
      "owned-lease",
      new Error("Identity deletion postcondition failed")
    )).resolves.toEqual(expect.objectContaining({
      category: "identity_authentication_profile",
      errorCode: "retention_identity_deletion_postcondition_failed"
    }));
    const lockSql = Array.from(tx.$queryRaw.mock.calls[0][0] as string[]).join("?");
    expect(lockSql).toContain('"expiryLeaseToken"');
    expect(tx.accountDataRetentionRecord.update).toHaveBeenCalledWith({
      where: { id: record.id },
      data: expect.objectContaining({
        expiryAttemptCount: 3,
        expiryNextAttemptAt: expect.any(Date),
        expiryLeaseToken: null,
        expiryLeaseExpiresAt: null
      })
    });
  });

  it("preserves the canonical User-before-ledger lock order", async () => {
    const record = legacyRecord("identity_authentication_profile", "refresh_token");
    const { worker, tx } = createWorker();
    tx.accountDataRetentionRecord.findUnique
      .mockResolvedValueOnce({ userId: record.userId })
      .mockResolvedValueOnce(record);
    tx.accountDeletionRequest.findUnique.mockResolvedValue({
      userId: record.userId,
      status: "completed"
    });
    tx.$queryRaw.mockImplementation(async (parts: TemplateStringsArray) => (
      Array.from(parts).join("?").includes('FROM "AccountDataRetentionRecord"')
        ? [{ id: record.id }]
        : []
    ));

    await (worker as any).processClaimedRetentionRecord({ id: record.id, leaseToken: "lease-order" });

    const sql = tx.$queryRaw.mock.calls.map(([parts]: [TemplateStringsArray]) =>
      Array.from(parts).join("?")
    );
    expect(sql.findIndex((value: string) => value.includes('FROM "User"'))).toBeLessThan(
      sql.findIndex((value: string) => value.includes('FROM "AccountDataRetentionRecord"'))
    );
  });

  it("implements every declared safety graph phase without an unsupported fallback", async () => {
    const phases = [
      "media_storage_schedule",
      "media_storage_wait",
      "controlled_evidence_attachment",
      "media_asset_delete",
      "order_support_fact",
      "support_ticket",
      "payment_dispute_attachment",
      "payment_dispute_notification",
      "payment_dispute_negotiation_event",
      "payment_dispute_reply",
      "payment_dispute",
      "payment_dispute_order",
      "attendance_statement",
      "attendance_dispute",
      "order_reschedule_request",
      "order_timeline_event",
      "order_experience_feedback",
      "voice_attendance_event",
      "voice_session",
      "moderation_evidence",
      "moderation_action_log",
      "moderation_appeal",
      "chat_restriction",
      "moderation_case",
      "crisis_intervention",
      "companion_incident",
      "message",
      "conversation",
      "companion_detach"
    ];
    for (const phase of phases) {
      const { worker, tx } = createWorker();
      await expect((worker as any).processRetainedPhaseBatch(
        tx,
        phase,
        "deletion-safety",
        "user-safety",
        "companion-safety"
      )).resolves.toEqual(expect.objectContaining({
        affectedCount: expect.any(Number),
        hasMore: expect.any(Boolean)
      }));
    }
  });

  it("schedules only purpose-scoped safety media in a bounded batch and never deletes storage first", async () => {
    const { worker, tx } = createWorker();
    tx.$queryRawUnsafe.mockImplementation(async (sql: string) => (
      sql.includes("SELECT EXISTS")
        ? [{ exists: false }]
        : [{ count: 1, cursor: "(media,1)" }]
    ));

    await expect((worker as any).processRetainedPhaseBatch(
      tx,
      "media_storage_schedule",
      "deletion-safety",
      "user-safety",
      "companion-safety"
    )).resolves.toEqual({
      affectedCount: 1,
      hasMore: false,
      cursor: "(media,1)"
    });

    const statements = tx.$queryRawUnsafe.mock.calls.map(([sql]: [string]) => sql);
    expect(statements[0]).toContain('UPDATE "MediaAsset"');
    expect(statements[0]).toContain("'chatMessage'");
    expect(statements[0]).toContain("'orderSupportFact'");
    expect(statements[0]).toContain("'attendanceDisputeStatement'");
    expect(statements[0]).toContain("'companionIncidentReport'");
    expect(statements[0]).not.toContain("'userAccountAppeal'");
    expect(statements[0]).toContain('"storageDeletedAt" IS NULL');
    expect(statements[0]).toContain('"expiresAt" = CURRENT_TIMESTAMP');
    expect(statements.join("\n")).not.toContain('DELETE FROM "MediaAsset"');
    expect(tx.$queryRawUnsafe.mock.calls[0].at(-1)).toBe(250);
  });

  it("waits for storageDeletedAt and persists a future retry without deleting any media row", async () => {
    const { worker, tx } = createWorker();
    tx.$queryRawUnsafe.mockResolvedValue([{ exists: true }]);

    const result = await (worker as any).processRetainedPhaseBatch(
      tx,
      "media_storage_wait",
      "deletion-safety",
      "user-safety",
      null
    );
    expect(result).toEqual({
      affectedCount: 0,
      hasMore: true,
      cursor: null,
      nextAttemptAt: expect.any(Date)
    });
    const sql = tx.$queryRawUnsafe.mock.calls.map(([statement]: [string]) => statement).join("\n");
    expect(sql).toContain('"storageDeletedAt" IS NULL');
    expect(sql).not.toContain('DELETE FROM "MediaAsset"');
  });

  it("keeps a legacy controlled-attachment phase parked until object storage confirms deletion", async () => {
    const { worker, tx } = createWorker();
    let existsQuery = 0;
    tx.$queryRawUnsafe.mockImplementation(async (sql: string) => {
      if (!sql.includes("SELECT EXISTS")) return [{ count: 0, cursor: null }];
      existsQuery += 1;
      return [{ exists: existsQuery >= 2 }];
    });

    await expect((worker as any).processRetainedPhaseBatch(
      tx,
      "controlled_evidence_attachment",
      "deletion-safety",
      "user-safety",
      "companion-safety"
    )).resolves.toEqual(expect.objectContaining({
      affectedCount: 0,
      hasMore: true,
      nextAttemptAt: expect.any(Date)
    }));
    const sql = tx.$queryRawUnsafe.mock.calls.map(([statement]: [string]) => statement).join("\n");
    expect(sql).not.toContain('DELETE FROM "ControlledCaseEvidenceAttachment"');
    expect(sql).not.toContain('DELETE FROM "MediaAsset"');
  });

  it("isolates account-appeal evidence from the safety graph and gives it the same storage confirmation fence", async () => {
    const { worker, tx } = createWorker();
    tx.$queryRawUnsafe.mockImplementation(async (sql: string) => (
      sql.includes("SELECT EXISTS")
        ? [{ exists: false }]
        : [{ count: 1, cursor: "(governance,1)" }]
    ));

    await expect((worker as any).processRetainedPhaseBatch(
      tx,
      "governance_media_storage_schedule",
      "deletion-governance",
      "user-governance",
      "companion-governance"
    )).resolves.toEqual({
      affectedCount: 1,
      hasMore: false,
      cursor: "(governance,1)"
    });
    const sql = tx.$queryRawUnsafe.mock.calls.map(([statement]: [string]) => statement).join("\n");
    expect(sql).toContain("'userAccountAppeal'");
    expect(sql).toContain("'companionAccountAppeal'");
    expect(sql).toContain('"userAccountActionId"');
    expect(sql).toContain('"companionAccountActionId"');
    expect(sql).not.toContain("'chatMessage'");
    expect(sql).not.toContain("'orderSupportFact'");
    expect(sql).not.toContain('DELETE FROM "MediaAsset"');
  });

  it("rechecks governance media before an old user-appeal phase can cascade its attachments", async () => {
    const { worker, tx } = createWorker();
    let existsQuery = 0;
    tx.$queryRawUnsafe.mockImplementation(async (sql: string) => {
      if (!sql.includes("SELECT EXISTS")) return [{ count: 0, cursor: null }];
      existsQuery += 1;
      return [{ exists: existsQuery >= 2 }];
    });

    await expect((worker as any).processRetainedPhaseBatch(
      tx,
      "user_account_appeal",
      "deletion-governance",
      "user-governance",
      null
    )).resolves.toEqual(expect.objectContaining({
      affectedCount: 0,
      hasMore: true,
      nextAttemptAt: expect.any(Date)
    }));
    const sql = tx.$queryRawUnsafe.mock.calls.map(([statement]: [string]) => statement).join("\n");
    expect(sql).not.toContain('DELETE FROM "UserAccountAppeal"');
    expect(sql).not.toContain('DELETE FROM "ControlledCaseEvidenceAttachment"');
  });

  it("expires audit subjects from normalized references while preserving another subject on the same log", async () => {
    const { worker, tx } = createWorker();
    tx.$queryRawUnsafe.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT reference."id", reference."auditLogId"')) {
        return [{
          id: "reference-target",
          auditLogId: "audit-shared",
          actorId: "user-other",
          action: "attendance.case_created",
          resourceId: "resource-other",
          metadata: {
            openedByUserId: "user-target",
            counterpartyUserId: "user-other",
            operationalCode: "keep-me"
          }
        }];
      }
      if (sql.includes('UPDATE "AuditLog" AS log')) return [{ id: "audit-shared" }];
      if (sql.includes('DELETE FROM "AuditSubjectReference"')) return [{ count: 1 }];
      if (sql.includes("SELECT EXISTS")) return [{ exists: false }];
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect((worker as any).processRetainedPhaseBatch(
      tx,
      "audit_subject_reference",
      "deletion-audit",
      "user-target",
      null
    )).resolves.toEqual({
      affectedCount: 1,
      hasMore: false,
      cursor: "reference-target"
    });

    const updateCall = tx.$queryRawUnsafe.mock.calls.find(
      ([sql]: [string]) => sql.includes('UPDATE "AuditLog" AS log')
    );
    const patches = JSON.parse(updateCall[1]);
    expect(patches).toEqual([{
      id: "audit-shared",
      actorId: "user-other",
      resourceId: "resource-other",
      metadata: {
        counterpartyUserId: "user-other",
        operationalCode: "keep-me",
        retentionExpired: true
      }
    }]);
    const deleteSql = tx.$queryRawUnsafe.mock.calls.find(
      ([sql]: [string]) => sql.includes('DELETE FROM "AuditSubjectReference"')
    )[0];
    expect(deleteSql).toContain('reference."subjectUserId" = $2');
  });

  it("requires every normalized audit subject edge to be gone before final audit expiry", async () => {
    const delegates = {
      authIdentityTombstone: { count: jest.fn().mockResolvedValue(0) },
      accountDeletionRequest: { count: jest.fn().mockResolvedValue(0) },
      accountDeletionRatingRefreshJob: { count: jest.fn().mockResolvedValue(0) },
      auditSubjectReference: { count: jest.fn().mockResolvedValue(1) }
    };
    const { worker, tx } = createWorker({ tx: delegates });
    tx.$queryRaw.mockResolvedValue([{ count: 0 }]);

    await expect((worker as any).verifyRetainedCategory(
      tx,
      "deletion-audit",
      "user-target",
      "deletion_audit_evidence",
      null
    )).rejects.toThrow("Deletion-audit retention postcondition failed");
    expect(delegates.auditSubjectReference.count).toHaveBeenCalledWith({
      where: { subjectUserId: "user-target" }
    });
  });
});
