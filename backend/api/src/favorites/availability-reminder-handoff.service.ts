import { HttpStatus, Injectable } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";

type CandidatePreflight = {
  id: string;
  preflightDecision: "pending" | "eligible" | "skipped";
  preflightedAt: Date | null;
};

type ReminderHandoff = {
  id: string;
  candidateId: string;
  createdAt: Date;
};

export type AvailabilityReminderHandoffResult = {
  handoffId: string;
  candidateId: string;
  created: boolean;
  createdAt: string;
};

/**
 * Creates the inert, private bridge between a final eligible preflight result
 * and a future delivery stage. It deliberately does not queue work, consume a
 * grant, create a notification, or contact a provider. The future consumer
 * must perform its own final live checks before it can attempt delivery.
 */
@Injectable()
export class AvailabilityReminderHandoffService {
  constructor(private readonly prisma: PrismaService) {}

  async createForEligibleCandidate(candidateId: string): Promise<AvailabilityReminderHandoffResult> {
    const normalizedCandidateId = candidateId.trim();
    if (!normalizedCandidateId) this.throwCandidateNotFound();

    return this.prisma.$transaction(async (transaction) => {
      const db = transaction as any;

      // All supported handoff calls share this candidate-row lock. It makes
      // the eligibility read and one-to-one create serial, while the database
      // unique key remains the final guard against an out-of-band race.
      await this.lockCandidate(db, normalizedCandidateId);
      const candidate = await db.availabilityReminderCandidate.findUnique({
        where: { id: normalizedCandidateId },
        select: { id: true, preflightDecision: true, preflightedAt: true }
      }) as CandidatePreflight | null;
      if (!candidate) this.throwCandidateNotFound();
      if (candidate.preflightDecision !== "eligible" || !candidate.preflightedAt) {
        this.throwCandidateNotEligible();
      }

      const existing = await db.availabilityReminderHandoff.findUnique({
        where: { candidateId: candidate.id },
        select: { id: true, candidateId: true, createdAt: true }
      }) as ReminderHandoff | null;
      if (existing) return this.toResult(existing, false);

      try {
        const handoff = await db.availabilityReminderHandoff.create({
          data: { candidateId: candidate.id },
          select: { id: true, candidateId: true, createdAt: true }
        }) as ReminderHandoff;
        return this.toResult(handoff, true);
      } catch (error) {
        if (!this.isUniqueConstraintError(error)) throw error;

        // Keep the external result idempotent even if an administrative or
        // recovery process created the same one-to-one row without this lock.
        const racedHandoff = await db.availabilityReminderHandoff.findUnique({
          where: { candidateId: candidate.id },
          select: { id: true, candidateId: true, createdAt: true }
        }) as ReminderHandoff | null;
        if (!racedHandoff) throw error;
        return this.toResult(racedHandoff, false);
      }
    });
  }

  private toResult(handoff: ReminderHandoff, created: boolean): AvailabilityReminderHandoffResult {
    return {
      handoffId: handoff.id,
      candidateId: handoff.candidateId,
      created,
      createdAt: handoff.createdAt.toISOString()
    };
  }

  private async lockCandidate(db: any, candidateId: string) {
    if (typeof db.$queryRaw !== "function") return;
    await db.$queryRaw`SELECT "id" FROM "AvailabilityReminderCandidate" WHERE "id" = ${candidateId} FOR UPDATE`;
  }

  private isUniqueConstraintError(error: unknown) {
    return typeof error === "object"
      && error !== null
      && "code" in error
      && (error as { code?: unknown }).code === "P2002";
  }

  private throwCandidateNotFound(): never {
    throw new AppException(
      "AVAILABILITY_REMINDER_CANDIDATE_NOT_FOUND",
      "Availability reminder candidate not found",
      HttpStatus.NOT_FOUND
    );
  }

  private throwCandidateNotEligible(): never {
    throw new AppException(
      "AVAILABILITY_REMINDER_CANDIDATE_NOT_ELIGIBLE",
      "Availability reminder candidate has not passed preflight",
      HttpStatus.CONFLICT
    );
  }
}
