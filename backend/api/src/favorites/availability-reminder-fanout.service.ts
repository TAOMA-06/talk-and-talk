import { randomUUID } from "node:crypto";

import { HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AuditService } from "../common/audit/audit.service";
import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { publicFavoriteCompanionWhere } from "./favorite-companion-eligibility";

const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_BATCHES_PER_RUN = 20;
const DEFAULT_LEASE_SECONDS = 120;
const DEFAULT_MAX_FAILURES = 8;
const DEFAULT_RETRY_BASE_SECONDS = 30;
const FAILED_SAMPLE_LIMIT = 20;
const MAX_RETRY_SECONDS = 60 * 60;
const FANOUT_BACKLOG_SLA_MS = 5 * 60_000;

type FanoutStatus = "pending" | "processing" | "retryScheduled" | "completed" | "failed";

type DueJob = {
  id: string;
  status: FanoutStatus;
  failureCount: number;
};

type ClaimedJob = {
  kind: "claimed";
  id: string;
  leaseToken: string;
};

type RecoveredJob = { kind: "recovered"; id: string } | { kind: "failed"; id: string };

type ClaimResult = ClaimedJob | RecoveredJob | null;

type FanoutSettings = {
  batchSize: number;
  batchesPerRun: number;
  leaseSeconds: number;
  maxFailures: number;
  retryBaseSeconds: number;
};

export type AvailabilityReminderFanoutRunResult = {
  claimed: number;
  batches: number;
  favoritesScanned: number;
  candidatesCreated: number;
  completed: number;
  recoveredExpiredLeases: number;
  retryScheduled: number;
  failed: number;
  leaseLost: number;
};

/**
 * Expands durable window-version jobs into candidates in keyset pages. Claiming
 * uses PostgreSQL row locks with SKIP LOCKED, while each claimed batch commits
 * its cursor and candidates atomically. A crash therefore replays at most one
 * idempotent batch after its lease expires; it never loses a page or implies a
 * provider delivery.
 */
@Injectable()
export class AvailabilityReminderFanoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService
  ) {}

  async fanOutDue(now = new Date()): Promise<AvailabilityReminderFanoutRunResult> {
    const settings = this.settings();
    const result = this.emptyResult();

    for (let index = 0; index < settings.batchesPerRun; index += 1) {
      const claim = await this.claimNext(now, settings);
      if (!claim) break;
      if (claim.kind === "recovered") {
        result.recoveredExpiredLeases += 1;
        result.retryScheduled += 1;
        continue;
      }
      if (claim.kind === "failed") {
        result.recoveredExpiredLeases += 1;
        result.failed += 1;
        continue;
      }

      result.claimed += 1;
      try {
        const batch = await this.processClaimedBatch(claim, settings.batchSize, now);
        if (batch.decision === "leaseLost") {
          result.leaseLost += 1;
          continue;
        }
        result.batches += 1;
        result.favoritesScanned += batch.favoritesScanned;
        result.candidatesCreated += batch.candidatesCreated;
        if (batch.decision === "completed") result.completed += 1;
      } catch (error) {
        const failure = await this.recordFailure(claim, error, now, settings);
        if (failure === "failed") result.failed += 1;
        else if (failure === "retryScheduled") result.retryScheduled += 1;
        else result.leaseLost += 1;
      }
    }

    return result;
  }

  async operationalReadiness(now = new Date()) {
    const settings = this.settings();
    const incompleteWhere = { status: { in: ["pending", "processing", "retryScheduled"] } };
    const dueWhere = {
      OR: [
        { status: { in: ["pending", "retryScheduled"] }, nextAttemptAt: { lte: now } },
        {
          status: "processing",
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }]
        }
      ]
    };
    const retryWhere = { status: "retryScheduled" };
    const failedWhere = { status: "failed" };
    const expiredWhere = {
      status: "processing",
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }]
    };
    const [backlog, due, processing, retryScheduled, expiredLeases, failed, oldest, failedSample] = await Promise.all([
      this.prisma.availabilityReminderFanoutJob.count({ where: incompleteWhere } as any),
      this.prisma.availabilityReminderFanoutJob.count({ where: dueWhere } as any),
      this.prisma.availabilityReminderFanoutJob.count({ where: { status: "processing" } } as any),
      this.prisma.availabilityReminderFanoutJob.count({ where: retryWhere } as any),
      this.prisma.availabilityReminderFanoutJob.count({ where: expiredWhere } as any),
      this.prisma.availabilityReminderFanoutJob.count({ where: failedWhere } as any),
      this.prisma.availabilityReminderFanoutJob.findFirst({
        where: dueWhere,
        select: { createdAt: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      } as any),
      this.prisma.availabilityReminderFanoutJob.findMany({
        where: failedWhere,
        select: {
          id: true,
          companionId: true,
          availabilityWindowId: true,
          failureCount: true,
          lastErrorCode: true,
          failedAt: true
        },
        orderBy: [{ failedAt: "asc" }, { id: "asc" }],
        take: FAILED_SAMPLE_LIMIT
      } as any)
    ]);

    const runnerEnabled = this.config.get<boolean>("AVAILABILITY_REMINDER_PREPARATION_ENABLED") === true;
    const oldestDueAgeSeconds = oldest?.createdAt
      ? Math.max(0, Math.floor((now.getTime() - oldest.createdAt.getTime()) / 1_000))
      : null;
    const backlogSlaBreached = oldestDueAgeSeconds !== null
      && oldestDueAgeSeconds * 1_000 > FANOUT_BACKLOG_SLA_MS;
    const runnerDisabledWithDueBacklog = due > 0 && !runnerEnabled;
    const attentionRequired = failed > 0
      || expiredLeases > 0
      || backlogSlaBreached
      || runnerDisabledWithDueBacklog;
    return {
      status: attentionRequired ? "attentionRequired" : backlog > 0 ? "processing" : "clear",
      checkedAt: now.toISOString(),
      runner: {
        enabled: runnerEnabled,
        batchSize: settings.batchSize,
        batchesPerRun: settings.batchesPerRun,
        leaseSeconds: settings.leaseSeconds,
        maxFailures: settings.maxFailures,
        retryBaseSeconds: settings.retryBaseSeconds
      },
      backlog: {
        total: backlog,
        due,
        processing,
        retryScheduled,
        expiredLeases,
        failed,
        oldestCreatedAt: oldest?.createdAt?.toISOString() ?? null,
        oldestDueAgeSeconds,
        backlogSlaSeconds: FANOUT_BACKLOG_SLA_MS / 1_000,
        backlogSlaBreached,
        runnerDisabledWithDueBacklog
      },
      failedJobSample: failedSample.map((job: any) => ({
        ...job,
        failedAt: job.failedAt?.toISOString() ?? null
      })),
      failedJobSampleLimit: FAILED_SAMPLE_LIMIT,
      failedJobSampleTruncated: failed > failedSample.length
    };
  }

  async retryFailedJob(actorId: string, jobId: string, now = new Date()) {
    const normalizedId = jobId.trim();
    if (!normalizedId) this.throwJobNotFound();

    return this.prisma.$transaction(async (transaction) => {
      const db = transaction as any;
      await this.lockJob(db, normalizedId);
      const job = await db.availabilityReminderFanoutJob.findUnique({
        where: { id: normalizedId },
        select: {
          id: true,
          status: true,
          failureCount: true,
          companion: { select: { ownerUserId: true } }
        }
      });
      if (!job) this.throwJobNotFound();
      if (job.status !== "failed") {
        throw new AppException(
          "AVAILABILITY_REMINDER_FANOUT_JOB_NOT_FAILED",
          "Only a failed availability reminder fanout job can be retried",
          HttpStatus.CONFLICT
        );
      }
      if (!job.companion?.ownerUserId) {
        throw new Error("Availability reminder fanout job is missing its companion owner");
      }

      const retried = await db.availabilityReminderFanoutJob.update({
        where: { id: job.id },
        data: {
          status: "retryScheduled",
          failureCount: 0,
          nextAttemptAt: now,
          lastErrorCode: null,
          failedAt: null,
          leaseToken: null,
          leaseExpiresAt: null
        },
        select: { id: true, status: true, nextAttemptAt: true }
      });
      await this.audit.record({
        actorId,
        subjectUserIds: [job.companion.ownerUserId],
        action: "availability_reminder.fanout_retry_scheduled",
        resourceType: "availabilityReminderFanoutJob",
        resourceId: job.id,
        metadata: { previousFailureCount: job.failureCount }
      }, db);
      return {
        id: retried.id,
        status: retried.status,
        nextAttemptAt: retried.nextAttemptAt.toISOString()
      };
    });
  }

  private async claimNext(now: Date, settings: FanoutSettings): Promise<ClaimResult> {
    return this.prisma.$transaction(async (transaction) => {
      const db = transaction as any;
      const rows = await db.$queryRaw<DueJob[]>`
        SELECT "id", "status", "failureCount"
        FROM "AvailabilityReminderFanoutJob"
        WHERE (
          "status" IN ('pending', 'retryScheduled')
          AND "nextAttemptAt" <= ${now}
        ) OR (
          "status" = 'processing'
          AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= ${now})
        )
        ORDER BY "nextAttemptAt" ASC, "updatedAt" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `;
      const job = rows[0];
      if (!job) return null;

      if (job.status === "processing") {
        const failureCount = job.failureCount + 1;
        const exhausted = failureCount >= settings.maxFailures;
        await db.availabilityReminderFanoutJob.update({
          where: { id: job.id },
          data: exhausted ? {
            status: "failed",
            failureCount,
            failedAt: now,
            lastErrorCode: "FANOUT_LEASE_EXPIRED",
            leaseToken: null,
            leaseExpiresAt: null
          } : {
            status: "retryScheduled",
            failureCount,
            nextAttemptAt: this.retryAt(now, failureCount, settings.retryBaseSeconds),
            lastErrorCode: "FANOUT_LEASE_EXPIRED",
            leaseToken: null,
            leaseExpiresAt: null
          }
        });
        return { kind: exhausted ? "failed" : "recovered", id: job.id };
      }

      const leaseToken = randomUUID();
      const leaseExpiresAt = new Date(now.getTime() + settings.leaseSeconds * 1_000);
      await db.availabilityReminderFanoutJob.update({
        where: { id: job.id },
        data: {
          status: "processing",
          leaseToken,
          leaseExpiresAt,
          failedAt: null,
          completedAt: null
        }
      });
      return { kind: "claimed", id: job.id, leaseToken };
    });
  }

  private async processClaimedBatch(claim: ClaimedJob, batchSize: number, now: Date) {
    return this.prisma.$transaction(async (transaction) => {
      const db = transaction as any;
      await this.lockJob(db, claim.id);
      const job = await db.availabilityReminderFanoutJob.findUnique({
        where: { id: claim.id },
        select: {
          id: true,
          companionId: true,
          availabilityWindowId: true,
          availabilityWindowUpdatedAt: true,
          audienceCutoffAt: true,
          status: true,
          cursorUserId: true,
          cursorFavoriteId: true,
          leaseToken: true,
          leaseExpiresAt: true
        }
      });
      if (!job || job.status !== "processing" || job.leaseToken !== claim.leaseToken) {
        return { decision: "leaseLost" as const, favoritesScanned: 0, candidatesCreated: 0 };
      }

      const window = await db.companionAvailabilityWindow.findFirst({
        where: {
          id: job.availabilityWindowId,
          companionId: job.companionId,
          updatedAt: job.availabilityWindowUpdatedAt,
          isActive: true,
          capacity: { gt: 0 },
          startsAt: { gt: now }
        },
        select: { id: true }
      });
      if (!window) {
        await this.completeJob(db, job.id, now, 0, 0);
        return { decision: "completed" as const, favoritesScanned: 0, candidatesCreated: 0 };
      }

      const favorites = await db.companionFavorite.findMany({
        where: {
          companionId: job.companionId,
          createdAt: { lte: job.audienceCutoffAt },
          ...(job.cursorUserId ? {
            OR: [
              { userId: { gt: job.cursorUserId } },
              { userId: job.cursorUserId, id: { gt: job.cursorFavoriteId } }
            ]
          } : {}),
          availabilityReminderEnabled: true,
          availabilityReminderGrantId: { not: null },
          companion: { is: publicFavoriteCompanionWhere() }
        },
        select: { id: true, userId: true },
        orderBy: [{ userId: "asc" }, { id: "asc" }],
        take: batchSize + 1
      });
      const batch = favorites.slice(0, batchSize) as Array<{ id: string; userId: string }>;
      const hasMore = favorites.length > batch.length;
      const created = batch.length > 0
        ? await db.availabilityReminderCandidate.createMany({
          data: batch.map((favorite) => ({
            favoriteId: favorite.id,
            companionId: job.companionId,
            availabilityWindowId: job.availabilityWindowId,
            availabilityWindowUpdatedAt: job.availabilityWindowUpdatedAt
          })),
          skipDuplicates: true
        })
        : { count: 0 };

      if (!hasMore) {
        await this.completeJob(db, job.id, now, batch.length, created.count);
        return {
          decision: "completed" as const,
          favoritesScanned: batch.length,
          candidatesCreated: created.count
        };
      }

      await db.availabilityReminderFanoutJob.update({
        where: { id: job.id },
        data: {
          status: "pending",
          cursorUserId: batch[batch.length - 1].userId,
          cursorFavoriteId: batch[batch.length - 1].id,
          scannedCount: { increment: batch.length },
          candidateCreatedCount: { increment: created.count },
          failureCount: 0,
          nextAttemptAt: now,
          leaseToken: null,
          leaseExpiresAt: null,
          lastErrorCode: null
        }
      });
      return {
        decision: "pending" as const,
        favoritesScanned: batch.length,
        candidatesCreated: created.count
      };
    });
  }

  private async completeJob(db: any, jobId: string, now: Date, scanned: number, created: number) {
    await db.availabilityReminderFanoutJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        scannedCount: { increment: scanned },
        candidateCreatedCount: { increment: created },
        failureCount: 0,
        completedAt: now,
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: null
      }
    });
  }

  private async recordFailure(
    claim: ClaimedJob,
    error: unknown,
    now: Date,
    settings: FanoutSettings
  ): Promise<"retryScheduled" | "failed" | "leaseLost"> {
    return this.prisma.$transaction(async (transaction) => {
      const db = transaction as any;
      await this.lockJob(db, claim.id);
      const job = await db.availabilityReminderFanoutJob.findUnique({
        where: { id: claim.id },
        select: { id: true, status: true, leaseToken: true, failureCount: true }
      });
      if (!job || job.status !== "processing" || job.leaseToken !== claim.leaseToken) return "leaseLost";

      const failureCount = job.failureCount + 1;
      const exhausted = failureCount >= settings.maxFailures;
      await db.availabilityReminderFanoutJob.update({
        where: { id: job.id },
        data: exhausted ? {
          status: "failed",
          failureCount,
          failedAt: now,
          lastErrorCode: this.errorCode(error),
          leaseToken: null,
          leaseExpiresAt: null
        } : {
          status: "retryScheduled",
          failureCount,
          nextAttemptAt: this.retryAt(now, failureCount, settings.retryBaseSeconds),
          lastErrorCode: this.errorCode(error),
          leaseToken: null,
          leaseExpiresAt: null
        }
      });
      return exhausted ? "failed" : "retryScheduled";
    });
  }

  private async lockJob(db: any, jobId: string) {
    if (typeof db.$queryRaw !== "function") return;
    await db.$queryRaw`SELECT "id" FROM "AvailabilityReminderFanoutJob" WHERE "id" = ${jobId} FOR UPDATE`;
  }

  private retryAt(now: Date, failureCount: number, baseSeconds: number) {
    const seconds = Math.min(MAX_RETRY_SECONDS, baseSeconds * (2 ** Math.max(0, failureCount - 1)));
    return new Date(now.getTime() + seconds * 1_000);
  }

  private errorCode(error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error) {
      const code = String((error as { code?: unknown }).code ?? "");
      if (/^[A-Za-z0-9_]{1,48}$/.test(code)) return `FANOUT_${code.toUpperCase()}`;
    }
    const name = error instanceof Error ? error.name : "UNKNOWN";
    const safeName = name.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 48).toUpperCase();
    return `FANOUT_${safeName || "UNKNOWN"}`;
  }

  private settings(): FanoutSettings {
    return {
      batchSize: this.bounded("AVAILABILITY_REMINDER_FANOUT_BATCH_SIZE", DEFAULT_BATCH_SIZE, 1, 1_000),
      batchesPerRun: this.bounded(
        "AVAILABILITY_REMINDER_FANOUT_BATCHES_PER_RUN",
        DEFAULT_BATCHES_PER_RUN,
        1,
        100
      ),
      leaseSeconds: this.bounded("AVAILABILITY_REMINDER_FANOUT_LEASE_SECONDS", DEFAULT_LEASE_SECONDS, 30, 900),
      maxFailures: this.bounded("AVAILABILITY_REMINDER_FANOUT_MAX_FAILURES", DEFAULT_MAX_FAILURES, 1, 50),
      retryBaseSeconds: this.bounded(
        "AVAILABILITY_REMINDER_FANOUT_RETRY_BASE_SECONDS",
        DEFAULT_RETRY_BASE_SECONDS,
        5,
        900
      )
    };
  }

  private bounded(key: string, fallback: number, minimum: number, maximum: number) {
    const value = this.config.get<number>(key) ?? fallback;
    if (!Number.isFinite(value)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.floor(value)));
  }

  private emptyResult(): AvailabilityReminderFanoutRunResult {
    return {
      claimed: 0,
      batches: 0,
      favoritesScanned: 0,
      candidatesCreated: 0,
      completed: 0,
      recoveredExpiredLeases: 0,
      retryScheduled: 0,
      failed: 0,
      leaseLost: 0
    };
  }

  private throwJobNotFound(): never {
    throw new AppException(
      "AVAILABILITY_REMINDER_FANOUT_JOB_NOT_FOUND",
      "Availability reminder fanout job not found",
      HttpStatus.NOT_FOUND
    );
  }
}
