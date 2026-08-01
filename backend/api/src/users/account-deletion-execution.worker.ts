import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AuthIdentityTombstoneService } from "../auth/auth-identity-tombstone.service";
import { AuditService } from "../common/audit/audit.service";
import {
  eraseSubjectPhaseBatch,
  nextAccountDeletionPhase
} from "../common/privacy/bounded-erasure";
import {
  ACCOUNT_DELETION_RETENTION_CATEGORIES,
  retentionEndsAt
} from "../common/account-deletion-retention-policy";
import { PrismaService } from "../database/prisma.service";
import {
  ACCOUNT_DELETION_RETAINED_SNAPSHOT_BATCH_SIZE,
  ACCOUNT_DELETION_RETAINED_SNAPSHOT_REGISTRY,
  AccountDeletionRetainedSnapshotCategory,
  AccountDeletionRetainedSnapshotCursor,
  AccountDeletionRetainedSnapshotProgress,
  AccountDeletionRetainedSnapshotRow,
  validateAccountDeletionRetainedSnapshotProgress
} from "./account-deletion-retained-snapshot.registry";
import { UsersService } from "./users.service";

const EXECUTION_INTERVAL_MS = 2_000;
const EXECUTION_LEASE_MS = 30_000;
const EXECUTION_CLAIM_BATCH_SIZE = 1;
const EXECUTION_MAX_CLAIM_ROUNDS = 50;
const EXECUTION_RUN_BUDGET_MS = 4_000;
const EXECUTION_MAX_AUTOMATIC_FAILURES = 5;
const RETAINED_SNAPSHOT_STATEMENT_TIMEOUT_MS = 3_000;
const RETAINED_SNAPSHOT_LOCK_TIMEOUT_MS = 500;

const RETAINED_SNAPSHOT_PHASE_CATEGORIES: Record<
  string,
  AccountDeletionRetainedSnapshotCategory
> = {
  retained_transactions_snapshot: "transactions_tax_invoices",
  retained_safety_snapshot: "support_disputes_safety",
  retained_governance_snapshot: "consent_rights_account_governance"
};

type ClaimedExecution = {
  id: string;
  leaseToken: string;
};

@Injectable()
export class AccountDeletionExecutionWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccountDeletionExecutionWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private continuationTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly users: UsersService,
    private readonly authTombstones: AuthIdentityTombstoneService
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>("NODE_ENV") === "test") return;
    this.timer = setInterval(() => this.runOnceSafely(), EXECUTION_INTERVAL_MS);
    this.timer.unref?.();
    this.runOnceSafely();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.continuationTimer) clearTimeout(this.continuationTimer);
    this.timer = null;
    this.continuationTimer = null;
  }

  async runOnce(): Promise<{
    skipped: boolean;
    claimed: number;
    processedBatches: number;
    completed: number;
    failed: number;
    continuationScheduled: boolean;
  }> {
    if (this.running) {
      return {
        skipped: true,
        claimed: 0,
        processedBatches: 0,
        completed: 0,
        failed: 0,
        continuationScheduled: false
      };
    }
    this.running = true;
    const runStartedAt = Date.now();
    let claimedCount = 0;
    let processedBatches = 0;
    let completed = 0;
    let failed = 0;
    let hitRunLimit = false;
    try {
      for (let round = 0; round < EXECUTION_MAX_CLAIM_ROUNDS; round += 1) {
        if (Date.now() - runStartedAt >= EXECUTION_RUN_BUDGET_MS) {
          hitRunLimit = true;
          break;
        }
        const claimed = await this.claimExecutions(EXECUTION_CLAIM_BATCH_SIZE);
        if (!claimed.length) break;
        claimedCount += claimed.length;
        for (const execution of claimed) {
          try {
            const result = await this.processClaimedExecution(execution);
            if (result.processed) processedBatches += 1;
            if (result.completed) completed += 1;
          } catch (error) {
            failed += 1;
            await this.recordFailure(execution, error);
            this.logger.error(`Account deletion execution failed (${this.errorCode(error)})`);
          }
        }
        if (round === EXECUTION_MAX_CLAIM_ROUNDS - 1
          || Date.now() - runStartedAt >= EXECUTION_RUN_BUDGET_MS) {
          hitRunLimit = true;
        }
      }
      if (hitRunLimit) this.scheduleContinuation(250);
      return {
        skipped: false,
        claimed: claimedCount,
        processedBatches,
        completed,
        failed,
        continuationScheduled: hitRunLimit
      };
    } finally {
      this.running = false;
    }
  }

  private async claimExecutions(limit: number): Promise<ClaimedExecution[]> {
    return this.prisma.$queryRaw<Array<{ id: string; leaseToken: string }>>`
      WITH candidates AS MATERIALIZED (
        SELECT request."id"
        FROM "AccountDeletionRequest" AS request
        WHERE request."status" = 'processing'
          AND request."approvedById" IS NOT NULL
          AND request."approvedAt" IS NOT NULL
          AND request."retentionApprovalReference" IS NOT NULL
          AND (
            (
              request."executionStatus" IN ('queued', 'retryScheduled')
              AND (request."executionNextAttemptAt" IS NULL OR request."executionNextAttemptAt" <= CURRENT_TIMESTAMP)
            )
            OR (
              request."executionStatus" = 'processing'
              AND (
                request."executionLeaseExpiresAt" IS NULL
                OR request."executionLeaseExpiresAt" <= CURRENT_TIMESTAMP
              )
            )
          )
        ORDER BY
          COALESCE(request."executionNextAttemptAt", request."approvedAt"),
          request."createdAt",
          request."id"
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      ), leased AS (
        UPDATE "AccountDeletionRequest" AS request
        SET
          "executionStatus" = 'processing',
          "executionLeaseToken" = md5(random()::TEXT || clock_timestamp()::TEXT || request."id"),
          "executionLeaseExpiresAt" = CURRENT_TIMESTAMP + (${EXECUTION_LEASE_MS} * INTERVAL '1 millisecond'),
          "executionAttemptCount" = request."executionAttemptCount" + 1,
          "executionStartedAt" = COALESCE(request."executionStartedAt", CURRENT_TIMESTAMP),
          "updatedAt" = CURRENT_TIMESTAMP
        FROM candidates
        WHERE request."id" = candidates."id"
        RETURNING request."id", request."executionLeaseToken" AS "leaseToken"
      )
      SELECT "id", "leaseToken" FROM leased ORDER BY "id"
    `;
  }

  private async processClaimedExecution(
    execution: ClaimedExecution
  ): Promise<{ processed: boolean; completed: boolean }> {
    const state = await this.prisma.accountDeletionRequest.findUnique({
      where: { id: execution.id },
      select: {
        userId: true,
        companionIdSnapshot: true,
        executionPhase: true,
        executionLeaseToken: true
      }
    });
    if (!state || state.executionLeaseToken !== execution.leaseToken) {
      return { processed: false, completed: false };
    }
    if (state.executionPhase === "final_verification") {
      const finalized = await this.users.finalizeDeletionExecution(execution.id, execution.leaseToken);
      return { processed: finalized, completed: finalized };
    }
    if (state.executionPhase.startsWith("retained_")) {
      await this.snapshotRetainedCategory(
        execution,
        state.executionPhase,
        state.userId,
        state.companionIdSnapshot
      );
      return { processed: true, completed: false };
    }

    await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      // All account-deletion mutations use the canonical User -> request ->
      // CompanionProfile order. Revalidating the snapshot under the profile
      // lock prevents a stale worker from erasing a newly assigned owner's
      // listings, availability, reminder state, or public profile.
      await db.$queryRaw`
        SELECT "id" FROM "User" WHERE "id" = ${state.userId} FOR UPDATE
      `;
      const locked = await db.$queryRaw<Array<{
        id: string;
        userId: string;
        approvedById: string;
        approvedAt: Date;
        companionIdSnapshot: string | null;
        executionPhase: string;
        executionDeletedCounts: unknown;
        executionProcessedCount: number;
      }>>`
        SELECT
          "id", "userId", "approvedById", "approvedAt",
          "companionIdSnapshot", "executionPhase", "executionDeletedCounts",
          "executionProcessedCount"
        FROM "AccountDeletionRequest"
        WHERE "id" = ${execution.id}
          AND "status" = 'processing'
          AND "executionStatus" = 'processing'
          AND "executionLeaseToken" = ${execution.leaseToken}
        FOR UPDATE
      `;
      const request = locked[0];
      if (!request) return;
      if (request.companionIdSnapshot) {
        await db.$queryRaw`
          SELECT "id" FROM "CompanionProfile"
          WHERE "id" = ${request.companionIdSnapshot}
          FOR UPDATE
        `;
        const companion = await db.companionProfile.findUnique({
          where: { id: request.companionIdSnapshot },
          select: { id: true, ownerUserId: true }
        });
        if (!companion || companion.ownerUserId !== request.userId) {
          throw new Error("Account deletion companion ownership changed before erasure");
        }
      }
      const safetyPolicy = ACCOUNT_DELETION_RETENTION_CATEGORIES.find(
        (entry) => entry.code === "support_disputes_safety"
      )!;
      if (request.executionPhase === "auth_identity") {
        await this.authTombstones.assertWorkerCoverageTx(
          db,
          request.id,
          request.userId
        );
      }
      const batch = await eraseSubjectPhaseBatch(db, request.executionPhase, {
        deletionRequestId: request.id,
        userId: request.userId,
        companionId: request.companionIdSnapshot,
        approvalActorId: request.approvedById,
        mediaRetentionEndsAt: retentionEndsAt(request.approvedAt, safetyPolicy.retentionDays)
      });
      const counts = request.executionDeletedCounts
        && typeof request.executionDeletedCounts === "object"
        ? { ...(request.executionDeletedCounts as Record<string, unknown>) }
        : {};
      const previousCount = Number(counts[request.executionPhase] ?? 0);
      counts[request.executionPhase] = (
        Number.isSafeInteger(previousCount) && previousCount >= 0 ? previousCount : 0
      ) + batch.affectedCount;
      const nextPhase = batch.hasMore
        ? request.executionPhase
        : nextAccountDeletionPhase(request.executionPhase);
      if (!nextPhase) throw new Error("Account deletion execution reached an invalid terminal phase");
      await db.accountDeletionRequest.update({
        where: { id: request.id },
        data: {
          executionStatus: "queued",
          executionPhase: nextPhase,
          executionCursor: batch.cursor
            ? `${request.executionPhase}:${batch.cursor}`
            : `${request.executionPhase}:${request.executionProcessedCount + batch.affectedCount}`,
          executionNextAttemptAt: new Date(),
          executionLeaseToken: null,
          executionLeaseExpiresAt: null,
          executionProcessedCount: request.executionProcessedCount + batch.affectedCount,
          executionDeletedCounts: counts
        }
      });
      if (!batch.hasMore) {
        await this.audit.record({
          subjectUserIds: [request.userId],
          action: "account.deletion_execution_phase_completed",
          resourceType: "accountDeletionRequest",
          resourceId: request.id,
          metadata: {
            phase: request.executionPhase,
            nextPhase,
            phaseAffectedCount: Number(counts[request.executionPhase]),
            boundedBatchSize: 250
          }
        }, db);
      }
    }, { timeout: 5_000 });
    return { processed: true, completed: false };
  }

  private async snapshotRetainedCategory(
    execution: ClaimedExecution,
    phase: string,
    userId: string,
    companionIdSnapshot: string | null
  ): Promise<void> {
    const category = RETAINED_SNAPSHOT_PHASE_CATEGORIES[phase];
    if (!category) {
      throw new Error(`Unsupported account deletion retained snapshot phase: ${phase}`);
    }
    const sources = ACCOUNT_DELETION_RETAINED_SNAPSHOT_REGISTRY.filter(
      (source) => source.category === category
    );
    if (!sources.length) {
      throw new Error(`Account deletion retained snapshot registry is empty: ${category}`);
    }

    await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$executeRawUnsafe(
        `SET LOCAL statement_timeout = '${RETAINED_SNAPSHOT_STATEMENT_TIMEOUT_MS}ms'`
      );
      await db.$executeRawUnsafe(
        `SET LOCAL lock_timeout = '${RETAINED_SNAPSHOT_LOCK_TIMEOUT_MS}ms'`
      );
      await db.$queryRaw`
        SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE
      `;
      const locked = await db.$queryRaw<Array<{
        id: string;
        userId: string;
        companionIdSnapshot: string | null;
        approvedAt: Date;
        executionRetainedCounts: unknown;
      }>>`
        SELECT
          "id",
          "userId",
          "companionIdSnapshot",
          "approvedAt",
          "executionRetainedCounts"
        FROM "AccountDeletionRequest"
        WHERE "id" = ${execution.id}
          AND "status" = 'processing'
          AND "executionStatus" = 'processing'
          AND "executionPhase" = ${phase}
          AND "executionLeaseToken" = ${execution.leaseToken}
        FOR UPDATE
      `;
      const request = locked[0];
      if (!request) return;
      if (request.userId !== userId || request.companionIdSnapshot !== companionIdSnapshot) {
        throw new Error("Account deletion subject snapshot changed before retention capture");
      }
      if (!(request.approvedAt instanceof Date)
        || !Number.isFinite(request.approvedAt.getTime())) {
        throw new Error("Account deletion retained snapshot approval high-water is missing");
      }
      if (request.companionIdSnapshot) {
        await db.$queryRaw`
          SELECT "id" FROM "CompanionProfile"
          WHERE "id" = ${request.companionIdSnapshot}
          FOR UPDATE
        `;
        const companion = await db.companionProfile.findUnique({
          where: { id: request.companionIdSnapshot },
          select: { id: true, ownerUserId: true }
        });
        if (!companion || companion.ownerUserId !== request.userId) {
          throw new Error("Account deletion companion ownership changed before retention capture");
        }
      }

      await db.accountDeletionRetentionSnapshotProgress.createMany({
        data: sources.map((source) => ({
          deletionRequestId: request.id,
          category,
          sourceKey: source.sourceKey,
          highWaterAt: request.approvedAt
        })),
        skipDuplicates: true
      });
      const progressRows: AccountDeletionRetainedSnapshotProgress[] = await db.$queryRaw`
        SELECT
          "id",
          "category",
          "sourceKey",
          "highWaterAt",
          "cursorCreatedAt",
          "cursorId",
          "observedCount",
          "completedAt"
        FROM "AccountDeletionRetentionSnapshotProgress"
        WHERE "deletionRequestId" = ${request.id}
          AND "category" = ${category}
        ORDER BY "sourceKey"
        FOR UPDATE
      `;
      const progressBySource = validateAccountDeletionRetainedSnapshotProgress(
        progressRows,
        sources,
        request.approvedAt
      );
      const source = sources.find((candidate) => (
        progressBySource.get(candidate.sourceKey)?.completedAt === null
      ));

      let sourceCompleted = false;
      let sourceObservedCount = 0;
      let sourceCursor: AccountDeletionRetainedSnapshotCursor | null = null;
      let nextProgressRows: AccountDeletionRetainedSnapshotProgress[] = progressRows;
      if (source) {
        const progress = progressBySource.get(source.sourceKey)!;
        const cursor = progress.cursorCreatedAt && progress.cursorId
          ? { stableTime: progress.cursorCreatedAt, id: progress.cursorId }
          : null;
        const page = await source.readPage(
          db,
          { userId: request.userId, companionId: request.companionIdSnapshot },
          request.approvedAt,
          cursor
        );
        this.assertRetainedSnapshotPage(
          source.sourceKey,
          page,
          request.approvedAt,
          cursor
        );
        const last = page.at(-1) ?? cursor;
        sourceObservedCount = progress.observedCount + page.length;
        if (!Number.isSafeInteger(sourceObservedCount)) {
          throw new Error(`Account deletion retained snapshot count overflow: ${source.sourceKey}`);
        }
        sourceCompleted = page.length < ACCOUNT_DELETION_RETAINED_SNAPSHOT_BATCH_SIZE;
        const completedAt = sourceCompleted
          ? new Date(Math.max(Date.now(), request.approvedAt.getTime()))
          : null;
        await db.accountDeletionRetentionSnapshotProgress.update({
          where: { id: progress.id },
          data: {
            cursorCreatedAt: last?.stableTime ?? null,
            cursorId: last?.id ?? null,
            observedCount: sourceObservedCount,
            completedAt
          }
        });
        sourceCursor = last;
        nextProgressRows = progressRows.map((row) => row.id === progress.id
          ? {
              ...row,
              cursorCreatedAt: last?.stableTime ?? null,
              cursorId: last?.id ?? null,
              observedCount: sourceObservedCount,
              completedAt
            }
          : row);
      }

      const categoryCompleted = nextProgressRows.every((row) => row.completedAt !== null);
      let categoryCount: number | null = null;
      let nextPhase = phase;
      let retainedCounts: Record<string, unknown> | undefined;
      if (categoryCompleted) {
        categoryCount = nextProgressRows.reduce((sum, row) => sum + row.observedCount, 0);
        if (!Number.isSafeInteger(categoryCount)) {
          throw new Error(`Account deletion retained snapshot category count overflow: ${category}`);
        }
        retainedCounts = request.executionRetainedCounts
          && typeof request.executionRetainedCounts === "object"
          ? { ...(request.executionRetainedCounts as Record<string, unknown>) }
          : {};
        retainedCounts[category] = categoryCount;
        const resolvedNextPhase = nextAccountDeletionPhase(phase);
        if (!resolvedNextPhase) {
          throw new Error("Account deletion retained snapshot has no next phase");
        }
        nextPhase = resolvedNextPhase;
      }

      await db.accountDeletionRequest.update({
        where: { id: request.id },
        data: {
          executionStatus: "queued",
          executionPhase: nextPhase,
          executionCursor: categoryCompleted
            ? `${phase}:${category}:${categoryCount}:completed`
            : `${phase}:${source?.sourceKey ?? "registry"}:${sourceObservedCount}:${
              sourceCursor ? `${sourceCursor.stableTime.toISOString()}:${sourceCursor.id}` : "start"
            }`,
          executionNextAttemptAt: new Date(),
          executionLeaseToken: null,
          executionLeaseExpiresAt: null,
          ...(retainedCounts ? { executionRetainedCounts: retainedCounts } : {})
        }
      });
      if (source && sourceCompleted) {
        await this.audit.record({
          subjectUserIds: [request.userId],
          action: "account.deletion_retention_snapshot_source_completed",
          resourceType: "accountDeletionRequest",
          resourceId: request.id,
          metadata: {
            phase,
            category,
            sourceKey: source.sourceKey,
            stableTimeField: source.stableTimeField,
            recordCount: sourceObservedCount,
            highWaterAt: request.approvedAt.toISOString(),
            boundedBatchSize: ACCOUNT_DELETION_RETAINED_SNAPSHOT_BATCH_SIZE
          }
        }, db);
      }
      if (categoryCompleted) {
        await this.audit.record({
          subjectUserIds: [request.userId],
          action: "account.deletion_retention_snapshot_recorded",
          resourceType: "accountDeletionRequest",
          resourceId: request.id,
          metadata: {
            phase,
            category,
            recordCount: categoryCount,
            sourceCount: sources.length,
            highWaterAt: request.approvedAt.toISOString(),
            nextPhase
          }
        }, db);
      }
    }, { timeout: 5_000 });
  }

  private assertRetainedSnapshotPage(
    sourceKey: string,
    rows: AccountDeletionRetainedSnapshotRow[],
    highWaterAt: Date,
    cursor: AccountDeletionRetainedSnapshotCursor | null
  ): void {
    if (rows.length > ACCOUNT_DELETION_RETAINED_SNAPSHOT_BATCH_SIZE) {
      throw new Error(`Account deletion retained snapshot page exceeded bound: ${sourceKey}`);
    }
    let previous = cursor;
    for (const row of rows) {
      if (typeof row.id !== "string" || row.id.length === 0
        || !(row.stableTime instanceof Date)
        || !Number.isFinite(row.stableTime.getTime())
        || row.stableTime.getTime() > highWaterAt.getTime()) {
        throw new Error(`Account deletion retained snapshot row is invalid: ${sourceKey}`);
      }
      if (previous) {
        const timeOrder = row.stableTime.getTime() - previous.stableTime.getTime();
        if (timeOrder < 0 || (timeOrder === 0 && row.id.localeCompare(previous.id) <= 0)) {
          throw new Error(`Account deletion retained snapshot cursor did not advance: ${sourceKey}`);
        }
      }
      previous = row;
    }
  }

  private async recordFailure(execution: ClaimedExecution, error: unknown): Promise<void> {
    const errorCode = this.errorCode(error);
    await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const rows = await db.$queryRaw<Array<{
        id: string;
        userId: string;
        executionPhase: string;
        executionFailureCount: number;
      }>>`
        SELECT "id", "userId", "executionPhase", "executionFailureCount"
        FROM "AccountDeletionRequest"
        WHERE "id" = ${execution.id}
          AND "status" = 'processing'
          AND "executionStatus" = 'processing'
          AND "executionLeaseToken" = ${execution.leaseToken}
        FOR UPDATE
      `;
      const request = rows[0];
      if (!request) return;
      const failureCount = request.executionFailureCount + 1;
      const terminal = failureCount >= EXECUTION_MAX_AUTOMATIC_FAILURES;
      const retryDelayMs = Math.min(60 * 60_000, 5_000 * (2 ** Math.min(failureCount - 1, 9)));
      const nextAttemptAt = terminal ? null : new Date(Date.now() + retryDelayMs);
      await db.accountDeletionRequest.update({
        where: { id: request.id },
        data: {
          executionStatus: terminal ? "failed" : "retryScheduled",
          executionFailureCount: failureCount,
          executionNextAttemptAt: nextAttemptAt,
          executionLastErrorCode: errorCode,
          executionFailedAt: terminal ? new Date() : null,
          executionLeaseToken: null,
          executionLeaseExpiresAt: null
        }
      });
      await this.audit.record({
        subjectUserIds: [request.userId],
        action: terminal
          ? "account.deletion_execution_failed"
          : "account.deletion_execution_retry_scheduled",
        resourceType: "accountDeletionRequest",
        resourceId: request.id,
        metadata: {
          phase: request.executionPhase,
          failureCount,
          errorCode,
          terminal,
          nextAttemptAt: nextAttemptAt?.toISOString() ?? null
        }
      }, db);
    });
  }

  private errorCode(error: unknown): string {
    if (!(error instanceof Error)) return "account_deletion_unknown_error";
    const normalized = error.message
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase();
    return `account_deletion_${normalized || error.name.toLowerCase()}`.slice(0, 120);
  }

  private runOnceSafely(): void {
    void this.runOnce().catch((error) => {
      this.logger.error(`Account deletion runner failed (${this.errorCode(error)})`);
    });
  }

  private scheduleContinuation(delayMs: number): void {
    if (this.config.get<string>("NODE_ENV") === "test") return;
    if (this.continuationTimer) clearTimeout(this.continuationTimer);
    this.continuationTimer = setTimeout(() => {
      this.continuationTimer = null;
      this.runOnceSafely();
    }, delayMs);
    this.continuationTimer.unref?.();
  }
}
