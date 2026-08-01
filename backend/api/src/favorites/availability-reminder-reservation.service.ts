import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { PrismaService } from "../database/prisma.service";
import { AvailabilityReminderAttemptService } from "./availability-reminder-attempt.service";

const DEFAULT_BATCH_SIZE = 20;
const MAX_BATCH_SIZE = 100;
const WORK_LEASE_MS = 2 * 60_000;
const MAX_FAILURES = 8;
const MAX_RETRY_DELAY_MS = 5 * 60_000;
const PIPELINE_BACKLOG_SLA_MS = 5 * 60_000;

export type AvailabilityReminderReservationRunResult = {
  scanned: number;
  reserved: number;
  alreadyProcessed: number;
  skipped: number;
  disappeared: number;
  retryScheduled: number;
  failed: number;
  leaseLost: number;
};

type ReservationClaim = { id: string; reservationFailureCount: number; leaseToken: string };

/**
 * Bounded production bridge between an inert handoff and the durable attempt
 * consumed by the delivery runner. The attempt service owns the handoff lock,
 * live recheck, grant binding, and processed marker in one transaction. This
 * coordinator only selects stable private ids and aggregates non-identifying
 * operational counts.
 */
@Injectable()
export class AvailabilityReminderReservationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attempts: AvailabilityReminderAttemptService,
    private readonly config: ConfigService
  ) {}

  async reservePending(
    limit = DEFAULT_BATCH_SIZE,
    now = new Date()
  ): Promise<AvailabilityReminderReservationRunResult> {
    const result: AvailabilityReminderReservationRunResult = {
      scanned: 0,
      reserved: 0,
      alreadyProcessed: 0,
      skipped: 0,
      disappeared: 0,
      retryScheduled: 0,
      failed: 0,
      leaseLost: 0
    };

    for (let index = 0; index < this.normalizeLimit(limit); index += 1) {
      const claim = await this.claimNext(now);
      if (!claim) break;
      result.scanned += 1;
      try {
        const reservation = await this.attempts.reserve(claim.id, now);
        if (reservation.decision === "skipped") {
          result.skipped += 1;
        } else if (reservation.created) {
          result.reserved += 1;
        } else {
          result.alreadyProcessed += 1;
        }
        if (!await this.releaseClaim(claim)) result.leaseLost += 1;
      } catch (error) {
        if (this.hasCode(error, "AVAILABILITY_REMINDER_HANDOFF_NOT_FOUND")) {
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

  private async claimNext(now: Date): Promise<ReservationClaim | null> {
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + WORK_LEASE_MS);
    const rows = await this.prisma.$queryRaw<Array<{ id: string; reservationFailureCount: number }>>`
      WITH due AS (
        SELECT handoff."id"
        FROM "AvailabilityReminderHandoff" handoff
        WHERE handoff."reservationProcessedAt" IS NULL
          AND handoff."reservationFailedAt" IS NULL
          AND handoff."reservationNextAttemptAt" <= ${now}
          AND (
            handoff."reservationLeaseToken" IS NULL
            OR handoff."reservationLeaseExpiresAt" IS NULL
            OR handoff."reservationLeaseExpiresAt" <= ${now}
          )
        ORDER BY handoff."createdAt" ASC, handoff."id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "AvailabilityReminderHandoff" handoff
      SET "reservationLeaseToken" = ${leaseToken},
          "reservationLeaseExpiresAt" = ${leaseExpiresAt}
      FROM due
      WHERE handoff."id" = due."id"
      RETURNING handoff."id", handoff."reservationFailureCount"
    `;
    return rows[0] ? { ...rows[0], leaseToken } : null;
  }

  private async releaseClaim(claim: ReservationClaim) {
    const released = await this.prisma.availabilityReminderHandoff.updateMany({
      where: { id: claim.id, reservationLeaseToken: claim.leaseToken },
      data: {
        reservationLeaseToken: null,
        reservationLeaseExpiresAt: null,
        reservationLastErrorCode: null
      }
    } as any);
    return released.count === 1;
  }

  private async failClaim(claim: ReservationClaim, error: unknown, now: Date) {
    const failureCount = claim.reservationFailureCount + 1;
    const terminal = failureCount >= MAX_FAILURES;
    const failed = await this.prisma.availabilityReminderHandoff.updateMany({
      where: { id: claim.id, reservationLeaseToken: claim.leaseToken },
      data: {
        reservationLeaseToken: null,
        reservationLeaseExpiresAt: null,
        reservationFailureCount: failureCount,
        reservationNextAttemptAt: new Date(now.getTime() + this.retryDelayMs(failureCount)),
        reservationLastErrorCode: this.errorCode(error),
        reservationFailedAt: terminal ? now : null
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

  async operationalReadiness(now = new Date()) {
    const pendingCandidateWhere = {
      handoff: null,
      preflightDecision: { in: ["pending", "eligible"] },
      preparationFailedAt: null
    };
    const dueCandidateWhere = {
      ...pendingCandidateWhere,
      preparationNextAttemptAt: { lte: now },
      OR: [
        { preparationLeaseToken: null },
        { preparationLeaseExpiresAt: null },
        { preparationLeaseExpiresAt: { lte: now } }
      ]
    };
    const expiredPreparationLeaseWhere = {
      ...pendingCandidateWhere,
      preparationLeaseToken: { not: null },
      OR: [
        { preparationLeaseExpiresAt: null },
        { preparationLeaseExpiresAt: { lte: now } }
      ]
    };
    const pendingWhere = { reservationProcessedAt: null, reservationFailedAt: null };
    const dueReservationWhere = {
      ...pendingWhere,
      reservationNextAttemptAt: { lte: now },
      OR: [
        { reservationLeaseToken: null },
        { reservationLeaseExpiresAt: null },
        { reservationLeaseExpiresAt: { lte: now } }
      ]
    };
    const expiredReservationLeaseWhere = {
      ...pendingWhere,
      reservationLeaseToken: { not: null },
      OR: [
        { reservationLeaseExpiresAt: null },
        { reservationLeaseExpiresAt: { lte: now } }
      ]
    };
    const skippedWhere = {
      reservationProcessedAt: { not: null },
      reservationOutcomeReason: { not: null },
      attempt: null
    };
    const reservedAttemptWhere = { status: "reserved", deliveryFailedAt: null };
    const activeAttemptWhere = {
      status: { in: ["readyToSend", "sending"] },
      deliveryFailedAt: null
    };
    const expiredAttemptWhere = {
      ...activeAttemptWhere,
      OR: [{ sendLeaseExpiresAt: null }, { sendLeaseExpiresAt: { lte: now } }]
    };
    const dueAttemptWhere = {
      deliveryFailedAt: null,
      deliveryNextAttemptAt: { lte: now },
      AND: [
        {
          OR: [
            { status: "reserved" },
            {
              status: { in: ["readyToSend", "sending"] },
              OR: [{ sendLeaseExpiresAt: null }, { sendLeaseExpiresAt: { lte: now } }]
            }
          ]
        },
        {
          OR: [
            { deliveryClaimToken: null },
            { deliveryClaimExpiresAt: null },
            { deliveryClaimExpiresAt: { lte: now } }
          ]
        }
      ]
    };
    const expiredDeliveryClaimWhere = {
      deliveryFailedAt: null,
      deliveryClaimToken: { not: null },
      OR: [
        { deliveryClaimExpiresAt: null },
        { deliveryClaimExpiresAt: { lte: now } }
      ]
    };
    const [
      pendingCandidates,
      dueCandidates,
      expiredPreparationLeases,
      pending,
      dueReservations,
      expiredReservationLeases,
      pendingWithAttempt,
      skipped,
      reservedAttempts,
      activeAttempts,
      dueAttempts,
      expiredAttemptLeases,
      expiredDeliveryClaimLeases,
      failedPreparation,
      failedReservation,
      failedDelivery,
      failedBeforeSend,
      rejected,
      uncertain,
      resolvedFailedBeforeSend,
      resolvedRejected,
      resolvedUncertain,
      oldestCandidate,
      oldestHandoff,
      oldestAttempt
    ] = await Promise.all([
      this.prisma.availabilityReminderCandidate.count({ where: pendingCandidateWhere } as any),
      this.prisma.availabilityReminderCandidate.count({ where: dueCandidateWhere } as any),
      this.prisma.availabilityReminderCandidate.count({ where: expiredPreparationLeaseWhere } as any),
      this.prisma.availabilityReminderHandoff.count({ where: pendingWhere } as any),
      this.prisma.availabilityReminderHandoff.count({ where: dueReservationWhere } as any),
      this.prisma.availabilityReminderHandoff.count({ where: expiredReservationLeaseWhere } as any),
      this.prisma.availabilityReminderHandoff.count({
        where: { ...pendingWhere, attempt: { isNot: null } }
      } as any),
      this.prisma.availabilityReminderHandoff.count({ where: skippedWhere } as any),
      this.prisma.availabilityReminderAttempt.count({ where: reservedAttemptWhere } as any),
      this.prisma.availabilityReminderAttempt.count({ where: activeAttemptWhere } as any),
      this.prisma.availabilityReminderAttempt.count({ where: dueAttemptWhere } as any),
      this.prisma.availabilityReminderAttempt.count({ where: expiredAttemptWhere } as any),
      this.prisma.availabilityReminderAttempt.count({ where: expiredDeliveryClaimWhere } as any),
      this.prisma.availabilityReminderCandidate.count({ where: { preparationFailedAt: { not: null } } } as any),
      this.prisma.availabilityReminderHandoff.count({ where: { reservationFailedAt: { not: null } } } as any),
      this.prisma.availabilityReminderAttempt.count({ where: { deliveryFailedAt: { not: null } } } as any),
      this.prisma.availabilityReminderAttempt.count({
        where: { status: "failedBeforeSend", operationalResolvedAt: null }
      } as any),
      this.prisma.availabilityReminderAttempt.count({
        where: { status: "rejected", operationalResolvedAt: null }
      } as any),
      this.prisma.availabilityReminderAttempt.count({
        where: { status: "uncertain", operationalResolvedAt: null }
      } as any),
      this.prisma.availabilityReminderAttempt.count({
        where: { status: "failedBeforeSend", operationalResolvedAt: { not: null } }
      } as any),
      this.prisma.availabilityReminderAttempt.count({
        where: { status: "rejected", operationalResolvedAt: { not: null } }
      } as any),
      this.prisma.availabilityReminderAttempt.count({
        where: { status: "uncertain", operationalResolvedAt: { not: null } }
      } as any),
      this.prisma.availabilityReminderCandidate.findFirst({
        where: dueCandidateWhere,
        select: { createdAt: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      } as any),
      this.prisma.availabilityReminderHandoff.findFirst({
        where: dueReservationWhere,
        select: { createdAt: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      } as any),
      this.prisma.availabilityReminderAttempt.findFirst({
        where: dueAttemptWhere,
        select: { createdAt: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      } as any)
    ]);
    const preparationRunnerEnabled = this.config.get<boolean>("AVAILABILITY_REMINDER_PREPARATION_ENABLED") === true;
    const deliveryRunnerEnabled = this.config.get<boolean>("AVAILABILITY_REMINDER_DELIVERY_ENABLED") === true
      && this.config.get<boolean>("WECHAT_SUBSCRIBE_MESSAGES_ENABLED") === true;
    const preparationBacklog = pendingCandidates + pending;
    const preparationDueBacklog = dueCandidates + dueReservations;
    const deliveryBacklog = reservedAttempts + activeAttempts;
    const deliveryDueBacklog = dueAttempts;
    const stageFailures = failedPreparation + failedReservation + failedDelivery;
    const resolvedTerminalAttempts = resolvedFailedBeforeSend + resolvedRejected + resolvedUncertain;
    const unresolvedTerminalAttempts = failedBeforeSend + rejected + uncertain;
    const oldestCreatedAt = [oldestCandidate, oldestHandoff, oldestAttempt]
      .map((row) => row?.createdAt as Date | undefined)
      .filter((value): value is Date => Boolean(value))
      .sort((left, right) => left.getTime() - right.getTime())[0];
    const oldestBacklogAgeSeconds = oldestCreatedAt
      ? Math.max(0, Math.floor((now.getTime() - oldestCreatedAt.getTime()) / 1_000))
      : null;
    const backlogSlaBreached = oldestBacklogAgeSeconds !== null
      && oldestBacklogAgeSeconds * 1_000 > PIPELINE_BACKLOG_SLA_MS;
    const preparationRunnerDisabledWithDueBacklog = preparationDueBacklog > 0
      && !preparationRunnerEnabled;
    const deliveryRunnerDisabledWithDueBacklog = deliveryDueBacklog > 0
      && !deliveryRunnerEnabled;
    const attentionRequired = stageFailures > 0
      || unresolvedTerminalAttempts > 0
      || expiredPreparationLeases > 0
      || expiredReservationLeases > 0
      || expiredDeliveryClaimLeases > 0
      || expiredAttemptLeases > 0
      || backlogSlaBreached
      || preparationRunnerDisabledWithDueBacklog
      || deliveryRunnerDisabledWithDueBacklog;
    return {
      status: attentionRequired
        ? "attentionRequired"
        : preparationBacklog + deliveryBacklog > 0 ? "processing" : "clear",
      preparationRunnerEnabled,
      deliveryRunnerEnabled,
      pendingCandidates,
      dueCandidates,
      expiredPreparationLeases,
      pending,
      dueReservations,
      expiredReservationLeases,
      pendingWithAttempt,
      skipped,
      reservedAttempts,
      activeAttempts,
      dueAttempts,
      expiredAttemptLeases,
      expiredDeliveryClaimLeases,
      failedPreparation,
      failedReservation,
      failedDelivery,
      failedBeforeSend,
      rejected,
      uncertain,
      terminalAttempts: {
        total: resolvedTerminalAttempts + unresolvedTerminalAttempts,
        resolved: resolvedTerminalAttempts,
        unresolved: unresolvedTerminalAttempts,
        byStatus: {
          failedBeforeSend: {
            total: failedBeforeSend + resolvedFailedBeforeSend,
            resolved: resolvedFailedBeforeSend,
            unresolved: failedBeforeSend
          },
          rejected: {
            total: rejected + resolvedRejected,
            resolved: resolvedRejected,
            unresolved: rejected
          },
          uncertain: {
            total: uncertain + resolvedUncertain,
            resolved: resolvedUncertain,
            unresolved: uncertain
          }
        }
      },
      oldestCreatedAt: oldestCreatedAt?.toISOString() ?? null,
      oldestBacklogAgeSeconds,
      backlogSlaSeconds: PIPELINE_BACKLOG_SLA_MS / 1_000,
      backlogSlaBreached,
      preparationRunnerDisabledWithDueBacklog,
      deliveryRunnerDisabledWithDueBacklog,
      checkedAt: now.toISOString()
    };
  }

  private normalizeLimit(value: number) {
    if (!Number.isFinite(value)) return DEFAULT_BATCH_SIZE;
    return Math.min(MAX_BATCH_SIZE, Math.max(1, Math.floor(value)));
  }

  private hasCode(error: unknown, code: string) {
    return typeof error === "object"
      && error !== null
      && "code" in error
      && (error as { code?: unknown }).code === code;
  }
}
