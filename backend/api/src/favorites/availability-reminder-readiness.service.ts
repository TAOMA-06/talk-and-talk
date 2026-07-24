import { HttpStatus, Injectable } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import {
  AvailabilityReminderPreflightService,
  AvailabilityReminderSkipReason
} from "./availability-reminder-preflight.service";

type ReadinessSkipReason = AvailabilityReminderSkipReason | "handoffUnavailable" | "preflightUnavailable";

type ReminderHandoffReference = {
  id: string;
  candidateId: string;
};

export type AvailabilityReminderReadinessResult = {
  handoffId: string;
  decision: "ready" | "skipped";
  reason: ReadinessSkipReason | null;
  preparation: null | {
    candidateId: string;
    favoriteId: string;
    userId: string;
    subscriptionGrantId: string;
    companionId: string;
    availabilityWindowId: string;
  };
};

/**
 * Converts an inert handoff into a fresh in-memory readiness result. It does
 * not persist this result, reserve/consume its grant, create a message, or
 * contact a provider. The future send implementation must repeat the live
 * check and consume the exact grant inside its own atomic boundary.
 */
@Injectable()
export class AvailabilityReminderReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly preflight: AvailabilityReminderPreflightService
  ) {}

  async prepare(handoffId: string, now = new Date()): Promise<AvailabilityReminderReadinessResult> {
    const normalizedHandoffId = handoffId.trim();
    if (!normalizedHandoffId) this.throwHandoffNotFound();

    const handoff = await this.prisma.$transaction(async (transaction) => {
      const db = transaction as any;
      await this.lockHandoff(db, normalizedHandoffId);
      const current = await db.availabilityReminderHandoff.findUnique({
        where: { id: normalizedHandoffId },
        select: { id: true, candidateId: true }
      }) as ReminderHandoffReference | null;
      if (!current) this.throwHandoffNotFound();
      return current;
    });

    try {
      const live = await this.preflight.recheckEligibleCandidate(handoff.candidateId, now);
      if (live.decision === "skipped") {
        return {
          handoffId: handoff.id,
          decision: "skipped",
          reason: live.reason,
          preparation: null
        };
      }

      return {
        handoffId: handoff.id,
        decision: "ready",
        reason: null,
        preparation: {
          candidateId: live.candidateId,
          favoriteId: live.preparation!.favoriteId,
          userId: live.preparation!.userId,
          subscriptionGrantId: live.preparation!.subscriptionGrantId,
          companionId: live.preparation!.companionId,
          availabilityWindowId: live.preparation!.availabilityWindowId
        }
      };
    } catch (error) {
      if (this.hasCode(error, "AVAILABILITY_REMINDER_CANDIDATE_NOT_FOUND")) {
        return this.skipped(handoff.id, "handoffUnavailable");
      }
      if (this.hasCode(error, "AVAILABILITY_REMINDER_CANDIDATE_NOT_ELIGIBLE")) {
        return this.skipped(handoff.id, "preflightUnavailable");
      }
      throw error;
    }
  }

  private skipped(handoffId: string, reason: ReadinessSkipReason): AvailabilityReminderReadinessResult {
    return { handoffId, decision: "skipped", reason, preparation: null };
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

  private throwHandoffNotFound(): never {
    throw new AppException(
      "AVAILABILITY_REMINDER_HANDOFF_NOT_FOUND",
      "Availability reminder handoff not found",
      HttpStatus.NOT_FOUND
    );
  }
}
