import { randomUUID } from "node:crypto";

import { HttpStatus, Injectable } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import {
  AvailabilityReminderPreflightService,
  AvailabilityReminderSkipReason
} from "./availability-reminder-preflight.service";

export const AVAILABILITY_REMINDER_SEND_LEASE_MS = 5 * 60 * 1_000;

type AttemptOutcomeReason = AvailabilityReminderSkipReason
  | "handoffUnavailable"
  | "preflightUnavailable"
  | "sendLeaseExpired"
  | "providerSkipped"
  | "providerPreSendFailed"
  | "providerRejected"
  | "providerUnknown";

type ReminderAttemptStatus = "reserved" | "readyToSend" | "sending" | "sent" | "skipped" | "failedBeforeSend" | "rejected" | "uncertain";

type ReminderAttempt = {
  id: string;
  handoffId: string;
  subscriptionGrantId: string;
  status: ReminderAttemptStatus;
  outcomeReason: AttemptOutcomeReason | null;
  authorizationConsumedAt: Date | null;
  sendLeaseToken: string | null;
  sendLeaseExpiresAt: Date | null;
};

type ReminderHandoff = {
  id: string;
  candidateId: string;
};

export type AvailabilityReminderAttemptConsumptionResult = {
  attemptId: string;
  decision: "authorized" | "inFlight" | "skipped" | "recoveryRequired" | "notReady";
  reason: AttemptOutcomeReason | null;
  /**
   * Returned only on the first successful in-memory handoff to a future
   * provider stage. It is never exposed through an HTTP response or log.
   */
  sendLeaseToken: string | null;
  sendLeaseExpiresAt: string | null;
};

/**
 * The irreversible boundary immediately before a future provider attempt.
 *
 * This service consumes an already-reserved, exact grant and issues a short
 * private lease, but intentionally has no provider, notification, message,
 * queue, runner, or worker dependency. A lost lease becomes `uncertain` and
 * is never automatically re-authorized: consumption alone is not evidence a
 * remote delivery was sent.
 */
@Injectable()
export class AvailabilityReminderAttemptConsumptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly preflight: AvailabilityReminderPreflightService
  ) {}

  async acquireFinalSendAuthorization(
    attemptId: string,
    now = new Date()
  ): Promise<AvailabilityReminderAttemptConsumptionResult> {
    const normalizedAttemptId = attemptId.trim();
    if (!normalizedAttemptId) this.throwAttemptNotFound();

    const evaluatedAt = new Date(now.getTime());
    return this.prisma.$transaction(async (transaction) => {
      const db = transaction as any;
      // Global order for the irreversible path is attempt → handoff →
      // candidate → favorite → grant → availability window. The shared
      // recheck acquires every lock after handoff on this same transaction.
      await this.lockAttempt(db, normalizedAttemptId);
      const attempt = await this.findAttempt(db, normalizedAttemptId);
      if (!attempt) this.throwAttemptNotFound();

      if (attempt.status === "readyToSend" || attempt.status === "sending") {
        return this.resolveActiveLease(db, attempt, evaluatedAt);
      }
      if (attempt.status === "skipped") return this.skipped(attempt);
      if (attempt.status === "uncertain") return this.recoveryRequired(attempt);
      if (attempt.status !== "reserved") this.throwStateConflict();

      await this.lockHandoff(db, attempt.handoffId);
      const handoff = await db.availabilityReminderHandoff.findUnique({
        where: { id: attempt.handoffId },
        select: { id: true, candidateId: true }
      }) as ReminderHandoff | null;
      if (!handoff) return this.markSkipped(db, attempt, "handoffUnavailable");

      let live: Awaited<ReturnType<AvailabilityReminderPreflightService["recheckEligibleCandidateWithinTransaction"]>>;
      try {
        live = await this.preflight.recheckEligibleCandidateWithinTransaction(db, handoff.candidateId, evaluatedAt);
      } catch (error) {
        const reason = this.preflightFailureReason(error);
        if (reason) return this.markSkipped(db, attempt, reason);
        throw error;
      }

      if (live.decision === "skipped") return this.markSkipped(db, attempt, live.reason!);
      // The shared check holds the currently-bound grant lock. A changed
      // preference must never let this attempt consume a different grant.
      if (live.preparation!.subscriptionGrantId !== attempt.subscriptionGrantId) {
        return this.markSkipped(db, attempt, "authorizationUnavailable");
      }

      // The relation and status predicate make the grant-to-attempt binding
      // explicit. `consumedByDeliveryId` is deliberately untouched because no
      // NotificationDelivery exists and no provider call occurs in this stage.
      const consumed = await db.weChatSubscriptionGrant.updateMany({
        where: {
          id: attempt.subscriptionGrantId,
          consumedAt: null,
          availabilityReminderAttempt: {
            is: { id: attempt.id, handoffId: attempt.handoffId, status: "reserved" }
          }
        },
        data: { consumedAt: evaluatedAt }
      });
      if (consumed.count !== 1) return this.markSkipped(db, attempt, "authorizationUnavailable");

      const sendLeaseToken = randomUUID();
      const sendLeaseExpiresAt = new Date(evaluatedAt.getTime() + AVAILABILITY_REMINDER_SEND_LEASE_MS);
      const advanced = await db.availabilityReminderAttempt.updateMany({
        where: { id: attempt.id, status: "reserved" },
        data: {
          status: "readyToSend",
          outcomeReason: null,
          authorizationConsumedAt: evaluatedAt,
          sendLeaseToken,
          sendLeaseExpiresAt
        }
      });
      if (advanced.count !== 1) this.throwStateConflict();

      return {
        attemptId: attempt.id,
        decision: "authorized",
        reason: null,
        sendLeaseToken,
        sendLeaseExpiresAt: sendLeaseExpiresAt.toISOString()
      };
    });
  }

  /**
   * Safe, caller-triggered recovery only. There is no scan or worker here:
   * callers may quarantine an expired lease, but can never turn it back into
   * a fresh send authorization or release the already-consumed grant.
   */
  async recoverExpiredSendLease(
    attemptId: string,
    now = new Date()
  ): Promise<AvailabilityReminderAttemptConsumptionResult> {
    const normalizedAttemptId = attemptId.trim();
    if (!normalizedAttemptId) this.throwAttemptNotFound();

    const evaluatedAt = new Date(now.getTime());
    return this.prisma.$transaction(async (transaction) => {
      const db = transaction as any;
      await this.lockAttempt(db, normalizedAttemptId);
      const attempt = await this.findAttempt(db, normalizedAttemptId);
      if (!attempt) this.throwAttemptNotFound();

      if (attempt.status === "readyToSend" || attempt.status === "sending") {
        return this.resolveActiveLease(db, attempt, evaluatedAt);
      }
      if (attempt.status === "uncertain") return this.recoveryRequired(attempt);
      if (attempt.status === "skipped") return this.skipped(attempt);
      return {
        attemptId: attempt.id,
        decision: "notReady",
        reason: null,
        sendLeaseToken: null,
        sendLeaseExpiresAt: null
      };
    });
  }

  private async resolveActiveLease(
    db: any,
    attempt: ReminderAttempt,
    now: Date
  ): Promise<AvailabilityReminderAttemptConsumptionResult> {
    if (
      attempt.authorizationConsumedAt
      && attempt.sendLeaseToken
      && attempt.sendLeaseExpiresAt
      && attempt.sendLeaseExpiresAt.getTime() > now.getTime()
    ) {
      // Do not replay a lease token after a client timeout. The holder either
      // finishes inside its original process, or recovery later quarantines it.
      return {
        attemptId: attempt.id,
        decision: "inFlight",
        reason: null,
        sendLeaseToken: null,
        sendLeaseExpiresAt: attempt.sendLeaseExpiresAt.toISOString()
      };
    }

    const quarantined = await db.availabilityReminderAttempt.updateMany({
      where: { id: attempt.id, status: attempt.status },
      data: { status: "uncertain", outcomeReason: "sendLeaseExpired" }
    });
    if (quarantined.count !== 1) this.throwStateConflict();

    return {
      attemptId: attempt.id,
      decision: "recoveryRequired",
      reason: "sendLeaseExpired",
      sendLeaseToken: null,
      sendLeaseExpiresAt: attempt.sendLeaseExpiresAt?.toISOString() ?? null
    };
  }

  private async markSkipped(
    db: any,
    attempt: ReminderAttempt,
    reason: Exclude<AttemptOutcomeReason, "sendLeaseExpired">
  ): Promise<AvailabilityReminderAttemptConsumptionResult> {
    const skipped = await db.availabilityReminderAttempt.updateMany({
      where: { id: attempt.id, status: "reserved" },
      data: { status: "skipped", outcomeReason: reason }
    });
    if (skipped.count !== 1) this.throwStateConflict();

    return {
      attemptId: attempt.id,
      decision: "skipped",
      reason,
      sendLeaseToken: null,
      sendLeaseExpiresAt: null
    };
  }

  private skipped(attempt: ReminderAttempt): AvailabilityReminderAttemptConsumptionResult {
    return {
      attemptId: attempt.id,
      decision: "skipped",
      reason: attempt.outcomeReason ?? "authorizationUnavailable",
      sendLeaseToken: null,
      sendLeaseExpiresAt: null
    };
  }

  private recoveryRequired(attempt: ReminderAttempt): AvailabilityReminderAttemptConsumptionResult {
    return {
      attemptId: attempt.id,
      decision: "recoveryRequired",
      reason: attempt.outcomeReason ?? "sendLeaseExpired",
      sendLeaseToken: null,
      sendLeaseExpiresAt: attempt.sendLeaseExpiresAt?.toISOString() ?? null
    };
  }

  private async findAttempt(db: any, attemptId: string): Promise<ReminderAttempt | null> {
    return db.availabilityReminderAttempt.findUnique({
      where: { id: attemptId },
      select: {
        id: true,
        handoffId: true,
        subscriptionGrantId: true,
        status: true,
        outcomeReason: true,
        authorizationConsumedAt: true,
        sendLeaseToken: true,
        sendLeaseExpiresAt: true
      }
    }) as Promise<ReminderAttempt | null>;
  }

  private preflightFailureReason(error: unknown): Exclude<AttemptOutcomeReason, "sendLeaseExpired"> | null {
    if (this.hasCode(error, "AVAILABILITY_REMINDER_CANDIDATE_NOT_FOUND")) return "handoffUnavailable";
    if (this.hasCode(error, "AVAILABILITY_REMINDER_CANDIDATE_NOT_ELIGIBLE")) return "preflightUnavailable";
    return null;
  }

  private async lockAttempt(db: any, attemptId: string) {
    if (typeof db.$queryRaw !== "function") return;
    await db.$queryRaw`SELECT "id" FROM "AvailabilityReminderAttempt" WHERE "id" = ${attemptId} FOR UPDATE`;
  }

  private async lockHandoff(db: any, handoffId: string) {
    if (typeof db.$queryRaw !== "function") return;
    await db.$queryRaw`SELECT "id" FROM "AvailabilityReminderHandoff" WHERE "id" = ${handoffId} FOR UPDATE`;
  }

  private hasCode(error: unknown, code: string) {
    return typeof error === "object"
      && error !== null
      && "code" in error
      && (error as { code?: unknown }).code === code;
  }

  private throwAttemptNotFound(): never {
    throw new AppException(
      "AVAILABILITY_REMINDER_ATTEMPT_NOT_FOUND",
      "Availability reminder attempt not found",
      HttpStatus.NOT_FOUND
    );
  }

  private throwStateConflict(): never {
    throw new AppException(
      "AVAILABILITY_REMINDER_ATTEMPT_STATE_CONFLICT",
      "Availability reminder attempt state changed before it could be finalized",
      HttpStatus.CONFLICT
    );
  }
}
