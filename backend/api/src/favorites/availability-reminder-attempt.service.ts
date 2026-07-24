import { HttpStatus, Injectable } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import {
  AvailabilityReminderPreflightService,
  AvailabilityReminderSkipReason
} from "./availability-reminder-preflight.service";

type AttemptSkipReason = AvailabilityReminderSkipReason
  | "handoffUnavailable"
  | "preflightUnavailable"
  | "sendLeaseExpired"
  | "providerSkipped"
  | "providerPreSendFailed"
  | "providerRejected"
  | "providerUnknown";

type ReminderHandoff = {
  id: string;
  candidateId: string;
};

type ReminderAttempt = {
  id: string;
  handoffId: string;
  status: "reserved" | "readyToSend" | "sending" | "sent" | "skipped" | "failedBeforeSend" | "rejected" | "uncertain";
  outcomeReason: AttemptSkipReason | null;
  createdAt: Date;
};

export type AvailabilityReminderAttemptReservationResult = {
  handoffId: string;
  decision: "reserved" | "readyToSend" | "inFlight" | "sent" | "skipped" | "failedBeforeSend" | "rejected" | "recoveryRequired";
  reason: AttemptSkipReason | null;
  attemptId: string | null;
  created: boolean;
  reservedAt: string | null;
};

/**
 * Creates one durable, private authorization reservation for a handoff. The
 * reservation binds a specific unconsumed grant by foreign key but does not
 * consume it or update WeChatSubscriptionGrant in any way. It has no provider,
 * notification, message, queue, or worker dependency.
 */
@Injectable()
export class AvailabilityReminderAttemptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly preflight: AvailabilityReminderPreflightService
  ) {}

  async reserve(handoffId: string, now = new Date()): Promise<AvailabilityReminderAttemptReservationResult> {
    const normalizedHandoffId = handoffId.trim();
    if (!normalizedHandoffId) this.throwHandoffNotFound();

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const db = transaction as any;
        // Keep a single global lock order: handoff → candidate → favorite →
        // grant → availability window. The shared recheck method owns every
        // lock after the handoff and returns no persisted delivery state.
        await this.lockHandoff(db, normalizedHandoffId);
        const handoff = await db.availabilityReminderHandoff.findUnique({
          where: { id: normalizedHandoffId },
          select: { id: true, candidateId: true }
        }) as ReminderHandoff | null;
        if (!handoff) this.throwHandoffNotFound();

        const existing = await db.availabilityReminderAttempt.findUnique({
          where: { handoffId: handoff.id },
          select: { id: true, handoffId: true, status: true, outcomeReason: true, createdAt: true }
        }) as ReminderAttempt | null;
        if (existing) return this.existingResult(existing);

        const live = await this.preflight.recheckEligibleCandidateWithinTransaction(db, handoff.candidateId, now);
        if (live.decision === "skipped") return this.skipped(handoff.id, live.reason!);

        try {
          const attempt = await db.availabilityReminderAttempt.create({
            data: {
              handoffId: handoff.id,
              subscriptionGrantId: live.preparation!.subscriptionGrantId
            },
            select: { id: true, handoffId: true, status: true, createdAt: true }
          }) as ReminderAttempt;
          return this.reserved(attempt, true);
        } catch (error) {
          if (!this.isUniqueConstraintError(error)) throw error;

          // Handoff locking covers supported callers; this fallback makes an
          // out-of-band concurrent handoff write idempotent as well. If the
          // unique conflict belongs to the grant, do not disclose the other
          // handoff and treat this authorization as unavailable.
          const racedAttempt = await db.availabilityReminderAttempt.findUnique({
            where: { handoffId: handoff.id },
            select: { id: true, handoffId: true, status: true, outcomeReason: true, createdAt: true }
          }) as ReminderAttempt | null;
          return racedAttempt
            ? this.existingResult(racedAttempt)
            : this.skipped(handoff.id, "authorizationUnavailable");
        }
      });
    } catch (error) {
      if (this.hasCode(error, "AVAILABILITY_REMINDER_CANDIDATE_NOT_FOUND")) {
        return this.skipped(normalizedHandoffId, "handoffUnavailable");
      }
      if (this.hasCode(error, "AVAILABILITY_REMINDER_CANDIDATE_NOT_ELIGIBLE")) {
        return this.skipped(normalizedHandoffId, "preflightUnavailable");
      }
      throw error;
    }
  }

  private reserved(attempt: ReminderAttempt, created: boolean): AvailabilityReminderAttemptReservationResult {
    return {
      handoffId: attempt.handoffId,
      decision: "reserved",
      reason: null,
      attemptId: attempt.id,
      created,
      reservedAt: attempt.createdAt.toISOString()
    };
  }

  private existingResult(attempt: ReminderAttempt): AvailabilityReminderAttemptReservationResult {
    if (attempt.status === "reserved") return this.reserved(attempt, false);
    if (attempt.status === "readyToSend") {
      return {
        handoffId: attempt.handoffId,
        decision: "readyToSend",
        reason: null,
        attemptId: attempt.id,
        created: false,
        reservedAt: attempt.createdAt.toISOString()
      };
    }
    if (attempt.status === "sending") {
      return {
        handoffId: attempt.handoffId,
        decision: "inFlight",
        reason: null,
        attemptId: attempt.id,
        created: false,
        reservedAt: attempt.createdAt.toISOString()
      };
    }
    if (attempt.status === "sent") {
      return {
        handoffId: attempt.handoffId,
        decision: "sent",
        reason: null,
        attemptId: attempt.id,
        created: false,
        reservedAt: attempt.createdAt.toISOString()
      };
    }
    if (attempt.status === "failedBeforeSend") {
      return {
        handoffId: attempt.handoffId,
        decision: "failedBeforeSend",
        reason: attempt.outcomeReason ?? "providerPreSendFailed",
        attemptId: attempt.id,
        created: false,
        reservedAt: attempt.createdAt.toISOString()
      };
    }
    if (attempt.status === "rejected") {
      return {
        handoffId: attempt.handoffId,
        decision: "rejected",
        reason: attempt.outcomeReason ?? "providerRejected",
        attemptId: attempt.id,
        created: false,
        reservedAt: attempt.createdAt.toISOString()
      };
    }
    if (attempt.status === "uncertain") {
      return {
        handoffId: attempt.handoffId,
        decision: "recoveryRequired",
        reason: attempt.outcomeReason ?? "sendLeaseExpired",
        attemptId: attempt.id,
        created: false,
        reservedAt: attempt.createdAt.toISOString()
      };
    }
    return this.skipped(attempt.handoffId, attempt.outcomeReason ?? "authorizationUnavailable");
  }

  private skipped(handoffId: string, reason: AttemptSkipReason): AvailabilityReminderAttemptReservationResult {
    return {
      handoffId,
      decision: "skipped",
      reason,
      attemptId: null,
      created: false,
      reservedAt: null
    };
  }

  private async lockHandoff(db: any, handoffId: string) {
    if (typeof db.$queryRaw !== "function") return;
    await db.$queryRaw`SELECT "id" FROM "AvailabilityReminderHandoff" WHERE "id" = ${handoffId} FOR UPDATE`;
  }

  private isUniqueConstraintError(error: unknown) {
    return typeof error === "object"
      && error !== null
      && "code" in error
      && (error as { code?: unknown }).code === "P2002";
  }

  private hasCode(error: unknown, code: string) {
    return typeof error === "object"
      && error !== null
      && "code" in error
      && (error as { code?: unknown }).code === code;
  }

  private throwHandoffNotFound(): never {
    throw new AppException(
      "AVAILABILITY_REMINDER_HANDOFF_NOT_FOUND",
      "Availability reminder handoff not found",
      HttpStatus.NOT_FOUND
    );
  }
}
