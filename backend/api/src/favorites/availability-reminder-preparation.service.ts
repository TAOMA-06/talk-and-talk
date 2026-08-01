import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";

import { PrismaService } from "../database/prisma.service";
import { AvailabilityReminderHandoffService } from "./availability-reminder-handoff.service";
import { AvailabilityReminderPreflightService } from "./availability-reminder-preflight.service";

const DEFAULT_BATCH_SIZE = 20;
const MAX_BATCH_SIZE = 100;
const WORK_LEASE_MS = 2 * 60_000;
const MAX_FAILURES = 8;
const MAX_RETRY_DELAY_MS = 5 * 60_000;

export type AvailabilityReminderPreparationResult = {
  scanned: number;
  eligible: number;
  skipped: number;
  handedOff: number;
  alreadyHandedOff: number;
  disappeared: number;
  retryScheduled: number;
  failed: number;
  leaseLost: number;
};

type PreparationClaim = { id: string; preparationFailureCount: number; leaseToken: string };

/**
 * A bounded, server-internal preparation pass. It intentionally has no
 * lifecycle hook, timer, controller, queue producer, or provider dependency:
 * a future operational worker must opt in to call it. This service reads only
 * candidate ids, then delegates all live eligibility and handoff writes to the
 * narrowly scoped services that own those boundaries.
 */
@Injectable()
export class AvailabilityReminderPreparationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly preflight: AvailabilityReminderPreflightService,
    private readonly handoffs: AvailabilityReminderHandoffService
  ) {}

  async preparePending(limit = DEFAULT_BATCH_SIZE, now = new Date()): Promise<AvailabilityReminderPreparationResult> {
    const result: AvailabilityReminderPreparationResult = {
      scanned: 0,
      eligible: 0,
      skipped: 0,
      handedOff: 0,
      alreadyHandedOff: 0,
      disappeared: 0,
      retryScheduled: 0,
      failed: 0,
      leaseLost: 0
    };

    // Claim one item at a time so a long/poison row cannot monopolize a batch.
    // Each iteration refills from the due queue and SKIP LOCKED lets replicas
    // consume disjoint work without sharing an in-memory cursor.
    for (let index = 0; index < this.normalizeLimit(limit); index += 1) {
      const claim = await this.claimNext(now);
      if (!claim) break;
      result.scanned += 1;
      try {
        const decision = await this.preflight.evaluate(claim.id, now);
        if (decision.decision === "skipped") {
          result.skipped += 1;
          if (!await this.releaseClaim(claim)) result.leaseLost += 1;
          continue;
        }

        result.eligible += 1;
        const handoff = await this.handoffs.createForEligibleCandidate(claim.id);
        if (handoff.created) result.handedOff += 1;
        else result.alreadyHandedOff += 1;
        if (!await this.releaseClaim(claim)) result.leaseLost += 1;
      } catch (error) {
        // A bookmark removal or profile withdrawal can cascade-delete a row
        // after the bounded id scan. That is a safe no-op, not a retryable
        // customer-facing failure. All other errors remain visible to the
        // future caller rather than silently skipping a safety boundary.
        if (this.isCandidateNotFound(error)) {
          result.disappeared += 1;
          await this.releaseClaim(claim);
          continue;
        }
        const failed = await this.failClaim(claim, error, now);
        if (!failed.updated) result.leaseLost += 1;
        else if (failed.terminal) result.failed += 1;
        else result.retryScheduled += 1;
      }
    }

    return result;
  }

  private async claimNext(now: Date): Promise<PreparationClaim | null> {
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + WORK_LEASE_MS);
    const rows = await this.prisma.$queryRaw<Array<{ id: string; preparationFailureCount: number }>>`
      WITH due AS (
        SELECT candidate."id"
        FROM "AvailabilityReminderCandidate" candidate
        WHERE candidate."preflightDecision"::text IN ('pending', 'eligible')
          AND candidate."preparationFailedAt" IS NULL
          AND candidate."preparationNextAttemptAt" <= ${now}
          AND (
            candidate."preparationLeaseToken" IS NULL
            OR candidate."preparationLeaseExpiresAt" IS NULL
            OR candidate."preparationLeaseExpiresAt" <= ${now}
          )
          AND NOT EXISTS (
            SELECT 1 FROM "AvailabilityReminderHandoff" handoff
            WHERE handoff."candidateId" = candidate."id"
          )
        ORDER BY candidate."createdAt" ASC, candidate."id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "AvailabilityReminderCandidate" candidate
      SET "preparationLeaseToken" = ${leaseToken},
          "preparationLeaseExpiresAt" = ${leaseExpiresAt}
      FROM due
      WHERE candidate."id" = due."id"
      RETURNING candidate."id", candidate."preparationFailureCount"
    `;
    return rows[0] ? { ...rows[0], leaseToken } : null;
  }

  private async releaseClaim(claim: PreparationClaim) {
    const released = await this.prisma.availabilityReminderCandidate.updateMany({
      where: { id: claim.id, preparationLeaseToken: claim.leaseToken },
      data: {
        preparationLeaseToken: null,
        preparationLeaseExpiresAt: null,
        preparationLastErrorCode: null
      }
    } as any);
    return released.count === 1;
  }

  private async failClaim(claim: PreparationClaim, error: unknown, now: Date) {
    const failureCount = claim.preparationFailureCount + 1;
    const terminal = failureCount >= MAX_FAILURES;
    const failed = await this.prisma.availabilityReminderCandidate.updateMany({
      where: { id: claim.id, preparationLeaseToken: claim.leaseToken },
      data: {
        preparationLeaseToken: null,
        preparationLeaseExpiresAt: null,
        preparationFailureCount: failureCount,
        preparationNextAttemptAt: new Date(now.getTime() + this.retryDelayMs(failureCount)),
        preparationLastErrorCode: this.errorCode(error),
        preparationFailedAt: terminal ? now : null
      }
    } as any);
    return { updated: failed.count === 1, terminal };
  }

  private retryDelayMs(failureCount: number) {
    return Math.min(MAX_RETRY_DELAY_MS, 5_000 * 2 ** Math.max(0, failureCount - 1));
  }

  private errorCode(error: unknown) {
    const name = error instanceof Error ? error.name : "unknown_error";
    return name.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80) || "unknown_error";
  }

  private normalizeLimit(value: number) {
    if (!Number.isFinite(value)) return DEFAULT_BATCH_SIZE;
    return Math.min(MAX_BATCH_SIZE, Math.max(1, Math.floor(value)));
  }

  private isCandidateNotFound(error: unknown) {
    return typeof error === "object"
      && error !== null
      && "code" in error
      && (error as { code?: unknown }).code === "AVAILABILITY_REMINDER_CANDIDATE_NOT_FOUND";
  }
}
