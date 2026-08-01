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
});
