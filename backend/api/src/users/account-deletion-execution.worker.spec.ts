import { AccountDeletionExecutionWorker } from "./account-deletion-execution.worker";
import {
  ACCOUNT_DELETION_RETAINED_SNAPSHOT_BATCH_SIZE,
  ACCOUNT_DELETION_RETAINED_SNAPSHOT_REGISTRY,
  AccountDeletionRetainedSnapshotCategory
} from "./account-deletion-retained-snapshot.registry";

function queryText(input: any): string {
  if (Array.isArray(input)) return Array.from(input).join("?");
  if (Array.isArray(input?.strings)) return Array.from(input.strings).join("?");
  return String(input?.sql ?? input ?? "");
}

function createHarness() {
  const request = {
    id: "deletion-1",
    userId: "user-1",
    approvedById: "admin-2",
    approvedAt: new Date("2026-08-01T08:00:00.000Z"),
    companionIdSnapshot: "companion-1",
    executionPhase: "notification_delivery",
    executionDeletedCounts: {},
    executionProcessedCount: 0,
    executionFailureCount: 0
  };
  const tx = {
    $queryRaw: jest.fn(async (parts: TemplateStringsArray) => {
      const sql = Array.from(parts).join("?");
      if (sql.includes('FROM "AccountDeletionRequest"')) return [request];
      return [{ id: "locked" }];
    }),
    $queryRawUnsafe: jest.fn(async (sql: string) => (
      sql.includes("SELECT EXISTS")
        ? [{ exists: true }]
        : [{ count: 250, cursor: "(9,1)" }]
    )),
    $executeRaw: jest.fn().mockResolvedValue(0),
    companionProfile: {
      findUnique: jest.fn().mockResolvedValue({ id: "companion-1", ownerUserId: "user-1" })
    },
    accountDeletionRequest: {
      update: jest.fn().mockResolvedValue({})
    }
  } as any;
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(async (callback: (db: any) => Promise<unknown>) => callback(tx)),
    accountDeletionRequest: {
      findUnique: jest.fn().mockResolvedValue({
        userId: request.userId,
        companionIdSnapshot: request.companionIdSnapshot,
        executionPhase: request.executionPhase,
        executionLeaseToken: "lease-1"
      })
    }
  } as any;
  const config = {
    get: jest.fn((key: string) => key === "NODE_ENV" ? "test" : undefined)
  } as any;
  const audit = { record: jest.fn().mockResolvedValue({}) } as any;
  const users = { finalizeDeletionExecution: jest.fn().mockResolvedValue(true) } as any;
  const authTombstones = {
    assertWorkerCoverageTx: jest.fn().mockResolvedValue(undefined)
  } as any;
  return {
    request,
    tx,
    prisma,
    audit,
    users,
    authTombstones,
    worker: new AccountDeletionExecutionWorker(prisma, config, audit, users, authTombstones)
  };
}

function createRetainedHarness(
  category: AccountDeletionRetainedSnapshotCategory,
  phase: string,
  options: {
    activeSourceKey?: string;
    pages?: Array<Array<{ id: string; stableTime: Date }>>;
  } = {}
) {
  const approvedAt = new Date("2026-08-01T08:00:00.000Z");
  const completedAt = new Date("2026-08-01T08:01:00.000Z");
  const sources = ACCOUNT_DELETION_RETAINED_SNAPSHOT_REGISTRY.filter(
    (source) => source.category === category
  );
  const request = {
    id: "deletion-retained-1",
    userId: "user-1",
    approvedAt,
    companionIdSnapshot: "companion-1",
    executionRetainedCounts: {} as Record<string, number>
  };
  const progressRows = sources.map((source, index) => ({
    id: `progress-${source.sourceKey}`,
    category,
    sourceKey: source.sourceKey,
    highWaterAt: approvedAt,
    cursorCreatedAt: null as Date | null,
    cursorId: null as string | null,
    observedCount: index + 1,
    completedAt: completedAt as Date | null
  }));
  if (options.activeSourceKey) {
    const active = progressRows.find((row) => row.sourceKey === options.activeSourceKey)!;
    active.observedCount = 0;
    (active as { completedAt: Date | null }).completedAt = null;
  }
  const pages = [...(options.pages ?? [])];
  const pageQueries: any[] = [];
  const tx = {
    $executeRawUnsafe: jest.fn().mockResolvedValue(0),
    $queryRaw: jest.fn(async (input: any) => {
      const sql = queryText(input);
      if (!Array.isArray(input)) {
        pageQueries.push(input);
        return pages.shift() ?? [];
      }
      if (sql.includes('FROM "AccountDeletionRequest"')) return [request];
      if (sql.includes('FROM "AccountDeletionRetentionSnapshotProgress"')) return progressRows;
      return [{ id: "locked" }];
    }),
    companionProfile: {
      findUnique: jest.fn().mockResolvedValue({ id: "companion-1", ownerUserId: "user-1" })
    },
    accountDeletionRetentionSnapshotProgress: {
      createMany: jest.fn().mockResolvedValue({ count: sources.length }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = progressRows.find((candidate) => candidate.id === where.id)!;
        Object.assign(row, data);
        return row;
      })
    },
    accountDeletionRequest: {
      update: jest.fn().mockResolvedValue({})
    }
  } as any;
  const prisma = {
    $transaction: jest.fn(async (callback: (db: any) => Promise<unknown>) => callback(tx))
  } as any;
  const audit = { record: jest.fn().mockResolvedValue({}) } as any;
  const config = { get: jest.fn().mockReturnValue("test") } as any;
  const users = { finalizeDeletionExecution: jest.fn() } as any;
  const authTombstones = { assertWorkerCoverageTx: jest.fn() } as any;
  return {
    approvedAt,
    sources,
    progressRows,
    request,
    tx,
    prisma,
    audit,
    pageQueries,
    worker: new AccountDeletionExecutionWorker(prisma, config, audit, users, authTombstones),
    execution: { id: request.id, leaseToken: "lease-retained-1" },
    phase
  };
}

describe("AccountDeletionExecutionWorker bounded ownership controls", () => {
  it("claims one stable lease at a time with SKIP LOCKED", async () => {
    const { worker, prisma } = createHarness();
    prisma.$queryRaw.mockResolvedValue([{ id: "deletion-1", leaseToken: "lease-1" }]);

    await expect((worker as any).claimExecutions(1)).resolves.toEqual([
      { id: "deletion-1", leaseToken: "lease-1" }
    ]);
    const sql = Array.from(prisma.$queryRaw.mock.calls[0][0] as string[]).join("?");
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain('UPDATE "AccountDeletionRequest"');
    expect(sql).toContain('"executionLeaseToken"');
  });

  it("locks User then request then profile and resumes the same bounded phase", async () => {
    const { worker, tx, prisma } = createHarness();

    await expect((worker as any).processClaimedExecution({
      id: "deletion-1",
      leaseToken: "lease-1"
    })).resolves.toEqual({ processed: true, completed: false });

    const lockSql = tx.$queryRaw.mock.calls.map(([parts]: [TemplateStringsArray]) =>
      Array.from(parts).join("?")
    );
    expect(lockSql[0]).toContain('FROM "User"');
    expect(lockSql[1]).toContain('FROM "AccountDeletionRequest"');
    expect(lockSql[2]).toContain('FROM "CompanionProfile"');
    expect(tx.$queryRawUnsafe).toHaveBeenCalledTimes(2);
    expect(tx.accountDeletionRequest.update).toHaveBeenCalledWith({
      where: { id: "deletion-1" },
      data: expect.objectContaining({
        executionStatus: "queued",
        executionPhase: "notification_delivery",
        executionProcessedCount: 250,
        executionLeaseToken: null,
        executionLeaseExpiresAt: null
      })
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 5_000 });
  });

  it("refuses to mutate any companion-scoped state after ownership changes", async () => {
    const { worker, tx } = createHarness();
    tx.companionProfile.findUnique.mockResolvedValue({
      id: "companion-1",
      ownerUserId: "new-owner"
    });

    await expect((worker as any).processClaimedExecution({
      id: "deletion-1",
      leaseToken: "lease-1"
    })).rejects.toThrow("companion ownership changed");
    expect(tx.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(tx.accountDeletionRequest.update).not.toHaveBeenCalled();
  });

  it("recomputes HMAC tombstone coverage before erasing the clear authentication identity", async () => {
    const { worker, request, authTombstones, tx } = createHarness();
    request.executionPhase = "auth_identity";

    await expect((worker as any).processClaimedExecution({
      id: "deletion-1",
      leaseToken: "lease-1"
    })).resolves.toEqual({ processed: true, completed: false });

    expect(authTombstones.assertWorkerCoverageTx).toHaveBeenCalledWith(
      tx,
      "deletion-1",
      "user-1"
    );
    expect(authTombstones.assertWorkerCoverageTx.mock.invocationCallOrder[0])
      .toBeLessThan(tx.$queryRawUnsafe.mock.invocationCallOrder[0]);
  });

  it("stops refilling claims at the wall-clock budget instead of hoarding leases", async () => {
    const { worker } = createHarness();
    const claim = jest.spyOn(worker as any, "claimExecutions")
      .mockResolvedValue([{ id: "deletion-1", leaseToken: "lease-1" }]);
    jest.spyOn(worker as any, "processClaimedExecution")
      .mockResolvedValue({ processed: true, completed: false });
    const clock = jest.spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(4_001);

    await expect(worker.runOnce()).resolves.toEqual(expect.objectContaining({
      claimed: 1,
      processedBatches: 1,
      continuationScheduled: true
    }));
    expect(claim).toHaveBeenCalledTimes(1);
    clock.mockRestore();
  });

  it("keeps terminal provider finalization lease-owned", async () => {
    const { worker, prisma, users } = createHarness();
    prisma.accountDeletionRequest.findUnique.mockResolvedValue({
      userId: "user-1",
      companionIdSnapshot: "companion-1",
      executionPhase: "final_verification",
      executionLeaseToken: "lease-final"
    });

    await expect((worker as any).processClaimedExecution({
      id: "deletion-1",
      leaseToken: "lease-final"
    })).resolves.toEqual({ processed: true, completed: true });
    expect(users.finalizeDeletionExecution).toHaveBeenCalledWith("deletion-1", "lease-final");
  });
});

describe("AccountDeletionExecutionWorker retained snapshot registry", () => {
  it("commits at most 250 rows for one source and keeps that source resumable", async () => {
    const firstPage = Array.from(
      { length: ACCOUNT_DELETION_RETAINED_SNAPSHOT_BATCH_SIZE },
      (_, index) => ({
        id: `order-${String(index).padStart(4, "0")}`,
        stableTime: new Date(Date.UTC(2026, 7, 1, 7, 0, 0, index))
      })
    );
    const harness = createRetainedHarness(
      "transactions_tax_invoices",
      "retained_transactions_snapshot",
      { activeSourceKey: "orders", pages: [firstPage] }
    );

    await (harness.worker as any).snapshotRetainedCategory(
      harness.execution,
      harness.phase,
      harness.request.userId,
      harness.request.companionIdSnapshot
    );

    expect(harness.tx.$executeRawUnsafe.mock.calls.map(([sql]: [string]) => sql)).toEqual([
      "SET LOCAL statement_timeout = '3000ms'",
      "SET LOCAL lock_timeout = '500ms'"
    ]);
    expect(harness.tx.accountDeletionRetentionSnapshotProgress.createMany)
      .toHaveBeenCalledWith(expect.objectContaining({
        data: expect.arrayContaining([expect.objectContaining({
          category: "transactions_tax_invoices",
          sourceKey: "orders",
          highWaterAt: harness.approvedAt
        })]),
        skipDuplicates: true
      }));
    expect(harness.tx.accountDeletionRetentionSnapshotProgress.update).toHaveBeenCalledWith({
      where: { id: "progress-orders" },
      data: {
        cursorCreatedAt: firstPage.at(-1)!.stableTime,
        cursorId: firstPage.at(-1)!.id,
        observedCount: 250,
        completedAt: null
      }
    });
    expect(harness.tx.accountDeletionRequest.update).toHaveBeenCalledWith({
      where: { id: harness.request.id },
      data: expect.objectContaining({
        executionStatus: "queued",
        executionPhase: "retained_transactions_snapshot",
        executionLeaseToken: null,
        executionLeaseExpiresAt: null
      })
    });
    expect(queryText(harness.pageQueries[0])).toContain("LIMIT");
    expect(queryText(harness.pageQueries[0])).not.toContain("SKIP LOCKED");
    expect(harness.tx.$queryRaw.mock.calls.map(([query]: [any]) => queryText(query)).join("\n"))
      .not.toContain("SKIP LOCKED");
  });

  it("resumes from the persisted tuple after a crash and aggregates only after EOF", async () => {
    const firstPage = Array.from(
      { length: ACCOUNT_DELETION_RETAINED_SNAPSHOT_BATCH_SIZE },
      (_, index) => ({
        id: `order-${String(index).padStart(4, "0")}`,
        stableTime: new Date(Date.UTC(2026, 7, 1, 7, 0, 0, index))
      })
    );
    const secondPage = [250, 251, 252].map((index) => ({
      id: `order-${String(index).padStart(4, "0")}`,
      stableTime: new Date(Date.UTC(2026, 7, 1, 7, 0, 0, index))
    }));
    const harness = createRetainedHarness(
      "transactions_tax_invoices",
      "retained_transactions_snapshot",
      { activeSourceKey: "orders", pages: [firstPage, secondPage] }
    );
    const run = () => (harness.worker as any).snapshotRetainedCategory(
      harness.execution,
      harness.phase,
      harness.request.userId,
      harness.request.companionIdSnapshot
    );

    await run();
    const persistedAfterFirstCommit = harness.progressRows.find(
      (row) => row.sourceKey === "orders"
    )!;
    expect(persistedAfterFirstCommit).toEqual(expect.objectContaining({
      observedCount: 250,
      cursorCreatedAt: firstPage.at(-1)!.stableTime,
      cursorId: firstPage.at(-1)!.id,
      completedAt: null
    }));

    // A new worker process has no in-memory cursor; the second transaction can
    // only resume from the durable progress row updated above.
    await run();

    const secondQueryValues = harness.pageQueries[1]?.values ?? [];
    expect(secondQueryValues).toContain(firstPage.at(-1)!.stableTime);
    expect(secondQueryValues).toContain(firstPage.at(-1)!.id);
    expect(persistedAfterFirstCommit).toEqual(expect.objectContaining({
      observedCount: 253,
      cursorCreatedAt: secondPage.at(-1)!.stableTime,
      cursorId: secondPage.at(-1)!.id,
      completedAt: expect.any(Date)
    }));
    expect(harness.tx.accountDeletionRequest.update).toHaveBeenLastCalledWith({
      where: { id: harness.request.id },
      data: expect.objectContaining({
        executionPhase: "retained_safety_snapshot",
        executionRetainedCounts: {
          transactions_tax_invoices: harness.progressRows.reduce(
            (sum, row) => sum + row.observedCount,
            0
          )
        }
      })
    });
    expect(harness.audit.record).toHaveBeenCalledWith(expect.objectContaining({
      subjectUserIds: ["user-1"],
      action: "account.deletion_retention_snapshot_recorded",
      metadata: expect.objectContaining({
        category: "transactions_tax_invoices",
        sourceCount: 17
      })
    }), harness.tx);
  });

  it.each([
    ["transactions_tax_invoices", "retained_transactions_snapshot", "retained_safety_snapshot", 17],
    ["support_disputes_safety", "retained_safety_snapshot", "retained_governance_snapshot", 27],
    ["consent_rights_account_governance", "retained_governance_snapshot", "final_verification", 12]
  ] as const)(
    "aggregates completed %s progress and advances its phase",
    async (category, phase, expectedNextPhase, sourceCount) => {
      const harness = createRetainedHarness(category, phase);

      await (harness.worker as any).snapshotRetainedCategory(
        harness.execution,
        phase,
        harness.request.userId,
        harness.request.companionIdSnapshot
      );

      expect(harness.pageQueries).toHaveLength(0);
      expect(harness.tx.accountDeletionRequest.update).toHaveBeenCalledWith({
        where: { id: harness.request.id },
        data: expect.objectContaining({
          executionPhase: expectedNextPhase,
          executionRetainedCounts: {
            [category]: harness.progressRows.reduce((sum, row) => sum + row.observedCount, 0)
          }
        })
      });
      expect(harness.audit.record).toHaveBeenCalledWith(expect.objectContaining({
        subjectUserIds: ["user-1"],
        action: "account.deletion_retention_snapshot_recorded",
        metadata: expect.objectContaining({ category, sourceCount })
      }), harness.tx);
    }
  );

  it("fails closed when the durable progress registry is missing a source", async () => {
    const harness = createRetainedHarness(
      "support_disputes_safety",
      "retained_safety_snapshot"
    );
    harness.progressRows.pop();

    await expect((harness.worker as any).snapshotRetainedCategory(
      harness.execution,
      harness.phase,
      harness.request.userId,
      harness.request.companionIdSnapshot
    )).rejects.toThrow("registry is incomplete");
    expect(harness.tx.accountDeletionRequest.update).not.toHaveBeenCalled();
  });

  it("rejects rows that do not strictly advance the stable tuple cursor", async () => {
    const cursorTime = new Date("2026-08-01T07:00:00.000Z");
    const harness = createRetainedHarness(
      "transactions_tax_invoices",
      "retained_transactions_snapshot",
      {
        activeSourceKey: "orders",
        pages: [[{ id: "order-0001", stableTime: cursorTime }]]
      }
    );
    Object.assign(harness.progressRows[0], {
      cursorCreatedAt: cursorTime,
      cursorId: "order-0001",
      observedCount: 1
    });

    await expect((harness.worker as any).snapshotRetainedCategory(
      harness.execution,
      harness.phase,
      harness.request.userId,
      harness.request.companionIdSnapshot
    )).rejects.toThrow("cursor did not advance");
    expect(harness.tx.accountDeletionRetentionSnapshotProgress.update).not.toHaveBeenCalled();
  });
});
