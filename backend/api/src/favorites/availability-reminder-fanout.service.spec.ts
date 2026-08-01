import { AvailabilityReminderFanoutService } from "./availability-reminder-fanout.service";

const NOW = new Date("2026-08-01T08:00:00.000Z");

function createHarness(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    AVAILABILITY_REMINDER_PREPARATION_ENABLED: true,
    AVAILABILITY_REMINDER_FANOUT_BATCH_SIZE: 2,
    AVAILABILITY_REMINDER_FANOUT_BATCHES_PER_RUN: 1,
    AVAILABILITY_REMINDER_FANOUT_LEASE_SECONDS: 60,
    AVAILABILITY_REMINDER_FANOUT_MAX_FAILURES: 3,
    AVAILABILITY_REMINDER_FANOUT_RETRY_BASE_SECONDS: 10,
    ...overrides
  };
  const state: any = {
    id: "job-1",
    companionId: "companion-1",
    companion: { ownerUserId: "companion-owner-1" },
    availabilityWindowId: "window-1",
    availabilityWindowUpdatedAt: new Date("2026-08-01T07:55:00.000Z"),
    audienceCutoffAt: new Date("2026-08-01T08:00:00.000Z"),
    status: "pending",
    cursorUserId: null,
    cursorFavoriteId: null,
    scannedCount: 0,
    candidateCreatedCount: 0,
    failureCount: 0,
    nextAttemptAt: new Date("2026-08-01T07:55:00.000Z"),
    leaseToken: null,
    leaseExpiresAt: null,
    lastErrorCode: null,
    completedAt: null,
    failedAt: null
  };
  const rawSql: string[] = [];
  const job = {
    count: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(async () => ({ ...state })),
    update: jest.fn(async ({ data }: any) => {
      for (const [key, value] of Object.entries(data)) {
        if (value && typeof value === "object" && "increment" in value) {
          state[key] += (value as { increment: number }).increment;
        } else {
          state[key] = value;
        }
      }
      return { ...state };
    })
  };
  const db: any = {
    availabilityReminderFanoutJob: job,
    companionAvailabilityWindow: {
      findFirst: jest.fn(async () => ({ id: "window-1" }))
    },
    companionFavorite: { findMany: jest.fn() },
    availabilityReminderCandidate: {
      createMany: jest.fn(async ({ data }: any) => ({ count: data.length }))
    },
    auditLog: { create: jest.fn(async () => ({})) },
    $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      rawSql.push(sql);
      if (!sql.includes('"status", "failureCount"')) return [];
      if (["pending", "retryScheduled", "processing"].includes(state.status)) {
        return [{ id: state.id, status: state.status, failureCount: state.failureCount }];
      }
      return [];
    })
  };
  const prisma: any = {
    ...db,
    $transaction: jest.fn(async (callback: (transaction: any) => unknown) => callback(db))
  };
  const config: any = { get: jest.fn((key: string) => values[key]) };
  const audit: any = { record: jest.fn(async () => ({})) };
  const service = new AvailabilityReminderFanoutService(prisma, config, audit);
  return { service, state, db, prisma, audit, rawSql };
}

describe("AvailabilityReminderFanoutService", () => {
  it("walks the complete cutoff audience with a stable user/favorite keyset and atomic idempotent batches", async () => {
    const { service, state, db, rawSql } = createHarness();
    db.companionFavorite.findMany.mockImplementation(async ({ where }: any) => where.OR ? [
      { id: "favorite-3", userId: "user-3" }
    ] : [
      { id: "favorite-1", userId: "user-1" },
      { id: "favorite-2", userId: "user-2" },
      { id: "favorite-3", userId: "user-3" }
    ]);

    await expect(service.fanOutDue(NOW)).resolves.toMatchObject({
      batches: 1,
      favoritesScanned: 2,
      candidatesCreated: 2,
      completed: 0
    });
    expect(state).toMatchObject({
      status: "pending",
      cursorUserId: "user-2",
      cursorFavoriteId: "favorite-2",
      scannedCount: 2,
      candidateCreatedCount: 2
    });
    expect(db.companionFavorite.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        companionId: "companion-1",
        createdAt: { lte: new Date("2026-08-01T08:00:00.000Z") }
      }),
      orderBy: [{ userId: "asc" }, { id: "asc" }],
      take: 3
    }));
    expect(db.availabilityReminderCandidate.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ favoriteId: "favorite-1", availabilityWindowId: "window-1" }),
        expect.objectContaining({ favoriteId: "favorite-2", availabilityWindowId: "window-1" })
      ],
      skipDuplicates: true
    });
    expect(rawSql.some((sql) => sql.includes("FOR UPDATE SKIP LOCKED"))).toBe(true);

    await expect(service.fanOutDue(NOW)).resolves.toMatchObject({
      batches: 1,
      favoritesScanned: 1,
      candidatesCreated: 1,
      completed: 1
    });
    expect(state).toMatchObject({
      status: "completed",
      scannedCount: 3,
      candidateCreatedCount: 3,
      completedAt: NOW
    });
    expect(db.companionFavorite.findMany.mock.calls[1][0].where.OR).toEqual([
      { userId: { gt: "user-2" } },
      { userId: "user-2", id: { gt: "favorite-2" } }
    ]);
  });

  it("does not advance either cursor when candidate creation fails and schedules exponential retry", async () => {
    const { service, state, db } = createHarness();
    db.companionFavorite.findMany.mockResolvedValue([
      { id: "favorite-1", userId: "user-1" },
      { id: "favorite-2", userId: "user-2" },
      { id: "favorite-3", userId: "user-3" }
    ]);
    db.availabilityReminderCandidate.createMany.mockRejectedValue(Object.assign(new Error("db"), { code: "P2034" }));

    await expect(service.fanOutDue(NOW)).resolves.toMatchObject({ retryScheduled: 1, batches: 0 });
    expect(state).toMatchObject({
      status: "retryScheduled",
      cursorUserId: null,
      cursorFavoriteId: null,
      scannedCount: 0,
      candidateCreatedCount: 0,
      failureCount: 1,
      nextAttemptAt: new Date("2026-08-01T08:00:10.000Z"),
      lastErrorCode: "FANOUT_P2034"
    });
  });

  it("recovers an expired lease with backoff without replaying a batch immediately", async () => {
    const { service, state, db } = createHarness();
    Object.assign(state, {
      status: "processing",
      leaseToken: "expired-lease",
      leaseExpiresAt: new Date("2026-08-01T07:59:00.000Z")
    });

    await expect(service.fanOutDue(NOW)).resolves.toMatchObject({
      claimed: 0,
      recoveredExpiredLeases: 1,
      retryScheduled: 1
    });
    expect(state).toMatchObject({
      status: "retryScheduled",
      failureCount: 1,
      leaseToken: null,
      leaseExpiresAt: null,
      lastErrorCode: "FANOUT_LEASE_EXPIRED",
      nextAttemptAt: new Date("2026-08-01T08:00:10.000Z")
    });
    expect(db.companionFavorite.findMany).not.toHaveBeenCalled();
  });

  it("moves repeated batch failures to a visible terminal failure", async () => {
    const { service, state, db } = createHarness();
    state.failureCount = 2;
    db.companionFavorite.findMany.mockResolvedValue([{ id: "favorite-1", userId: "user-1" }]);
    db.availabilityReminderCandidate.createMany.mockRejectedValue(new Error("db unavailable"));

    await expect(service.fanOutDue(NOW)).resolves.toMatchObject({ failed: 1, retryScheduled: 0 });
    expect(state).toMatchObject({
      status: "failed",
      failureCount: 3,
      failedAt: NOW,
      leaseToken: null,
      leaseExpiresAt: null
    });
  });

  it("finishes an obsolete window version without scanning any recipient", async () => {
    const { service, state, db } = createHarness();
    db.companionAvailabilityWindow.findFirst.mockResolvedValue(null);

    await expect(service.fanOutDue(NOW)).resolves.toMatchObject({ completed: 1, favoritesScanned: 0 });
    expect(state.status).toBe("completed");
    expect(db.companionFavorite.findMany).not.toHaveBeenCalled();
    expect(db.availabilityReminderCandidate.createMany).not.toHaveBeenCalled();
  });

  it("never reports unfinished fanout as clear and exposes exact counts plus a bounded failure sample", async () => {
    const { service, db } = createHarness({ AVAILABILITY_REMINDER_PREPARATION_ENABLED: true });
    db.availabilityReminderFanoutJob.count
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(21);
    db.availabilityReminderFanoutJob.findFirst.mockResolvedValue({
      createdAt: new Date("2026-08-01T06:00:00.000Z")
    });
    db.availabilityReminderFanoutJob.findMany.mockResolvedValue(Array.from({ length: 20 }, (_, index) => ({
      id: `job-${index}`,
      companionId: "companion-1",
      availabilityWindowId: "window-1",
      failureCount: 3,
      lastErrorCode: "FANOUT_P2034",
      failedAt: NOW
    })));

    await expect(service.operationalReadiness(NOW)).resolves.toMatchObject({
      status: "attentionRequired",
      backlog: {
        total: 4,
        due: 3,
        processing: 1,
        retryScheduled: 2,
        expiredLeases: 0,
        failed: 21,
        oldestCreatedAt: "2026-08-01T06:00:00.000Z"
      },
      failedJobSampleLimit: 20,
      failedJobSampleTruncated: true
    });
  });

  it("reports active nonempty backlog as processing and disabled-runner backlog as attention required", async () => {
    const active = createHarness({ AVAILABILITY_REMINDER_PREPARATION_ENABLED: true });
    active.db.availabilityReminderFanoutJob.count
      .mockResolvedValueOnce(1).mockResolvedValueOnce(1).mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    active.db.availabilityReminderFanoutJob.findFirst.mockResolvedValue({ createdAt: NOW });
    active.db.availabilityReminderFanoutJob.findMany.mockResolvedValue([]);
    await expect(active.service.operationalReadiness(NOW)).resolves.toMatchObject({ status: "processing" });

    const disabled = createHarness({ AVAILABILITY_REMINDER_PREPARATION_ENABLED: false });
    disabled.db.availabilityReminderFanoutJob.count
      .mockResolvedValueOnce(1).mockResolvedValueOnce(1).mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    disabled.db.availabilityReminderFanoutJob.findFirst.mockResolvedValue({ createdAt: NOW });
    disabled.db.availabilityReminderFanoutJob.findMany.mockResolvedValue([]);
    await expect(disabled.service.operationalReadiness(NOW)).resolves.toMatchObject({
      status: "attentionRequired",
      runner: { enabled: false }
    });
  });

  it("allows an audited operator retry only from terminal failure", async () => {
    const { service, state, audit } = createHarness();
    Object.assign(state, { status: "failed", failureCount: 3, failedAt: NOW });

    await expect(service.retryFailedJob("operator-1", "job-1", NOW)).resolves.toEqual({
      id: "job-1",
      status: "retryScheduled",
      nextAttemptAt: NOW.toISOString()
    });
    expect(state).toMatchObject({
      status: "retryScheduled",
      failureCount: 0,
      failedAt: null,
      nextAttemptAt: NOW
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "operator-1",
      subjectUserIds: ["companion-owner-1"],
      action: "availability_reminder.fanout_retry_scheduled",
      resourceId: "job-1"
    }), expect.anything());
  });
});
