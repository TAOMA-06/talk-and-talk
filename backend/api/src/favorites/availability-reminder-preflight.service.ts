import { HttpStatus, Injectable } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { publicFavoriteCompanionWhere } from "./favorite-companion-eligibility";

const AVAILABILITY_REMINDER_TEMPLATE_KEY = "availabilityReminder";
const AVAILABILITY_REMINDER_MINIMUM_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const AVAILABILITY_STEP_MS = 30 * 60 * 1_000;
const MIN_BOOKING_LEAD_TIME_MS = 15 * 60 * 1_000;

export type AvailabilityReminderEligibilityDecision = "eligible" | "skipped";
export type AvailabilityReminderSkipReason = "favoriteUnavailable" | "authorizationUnavailable" | "availabilityUnavailable" | "rateLimited";

type PreflightDecision = AvailabilityReminderEligibilityDecision;
type PreflightSkipReason = AvailabilityReminderSkipReason;

type ReminderCandidate = {
  id: string;
  favoriteId: string;
  companionId: string;
  availabilityWindowId: string;
  availabilityWindowUpdatedAt: Date;
  preflightDecision: "pending" | PreflightDecision;
  preflightReason: PreflightSkipReason | null;
  preflightedAt: Date | null;
};

type ReminderFavorite = {
  id: string;
  userId: string;
  availabilityReminderGrantId: string | null;
  availabilityReminderLastDeliveredAt: Date | null;
};

type ReminderWindow = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
};

type AvailabilityReservation = {
  status: string;
  scheduledAt: Date;
  durationMinutes: number;
  companionConfirmedAt: Date | null;
  paymentReservationExpiresAt: Date | null;
};

export type AvailabilityReminderPreflightResult = {
  candidateId: string;
  decision: PreflightDecision;
  reason: PreflightSkipReason | null;
  decidedAt: string | null;
};

/**
 * Ephemeral, server-only result of a fresh live eligibility check. The
 * preparation ids are never persisted by this service and must only be used by
 * a later atomic final-consumption stage; this check itself does not consume a
 * one-time grant or attempt a provider send.
 */
export type AvailabilityReminderLiveEligibilityResult = {
  candidateId: string;
  decision: PreflightDecision;
  reason: PreflightSkipReason | null;
  preparation: null | {
    favoriteId: string;
    userId: string;
    subscriptionGrantId: string;
    companionId: string;
    availabilityWindowId: string;
  };
};

/**
 * Evaluates one previously-created reminder candidate at the last safe point
 * before a future delivery stage. This service never creates a notification,
 * reserves or consumes a grant, calls WeChat, or changes an order, schedule,
 * bookmark, recommendation, refund, or settlement.
 *
 * The persisted result is deliberately final for this candidate version. A
 * later availability change creates a new candidate instead of reviving an old
 * one whose live conditions have already failed.
 */
@Injectable()
export class AvailabilityReminderPreflightService {
  constructor(private readonly prisma: PrismaService) {}

  async evaluate(candidateId: string, now = new Date()): Promise<AvailabilityReminderPreflightResult> {
    const normalizedCandidateId = candidateId.trim();
    if (!normalizedCandidateId) this.throwCandidateNotFound();

    const evaluatedAt = new Date(now.getTime());
    return this.prisma.$transaction(async (transaction) => {
      const db = transaction as any;

      // Coordinate competing evaluators and a favorite/window deletion before
      // reading the candidate's current eligibility. The future delivery stage
      // must recheck again while it consumes the exact grant.
      await this.lockCandidate(db, normalizedCandidateId);
      const candidate = await db.availabilityReminderCandidate.findUnique({
        where: { id: normalizedCandidateId },
        select: {
          id: true,
          favoriteId: true,
          companionId: true,
          availabilityWindowId: true,
          availabilityWindowUpdatedAt: true,
          preflightDecision: true,
          preflightReason: true,
          preflightedAt: true
        }
      }) as ReminderCandidate | null;
      if (!candidate) this.throwCandidateNotFound();

      if (candidate.preflightDecision !== "pending") return this.toResult(candidate);

      const live = await this.checkCurrentEligibility(db, candidate, evaluatedAt);
      return this.persistDecision(db, candidate.id, live.decision, live.reason, evaluatedAt);
    });
  }

  /**
   * Re-evaluates a previously eligible candidate without changing its stored
   * preflight decision. This is deliberately a fresh transaction and a fresh
   * live read, not a replay of the old eligible result. A future provider-send
   * stage still has to make this check and consume the grant atomically.
   */
  async recheckEligibleCandidate(candidateId: string, now = new Date()): Promise<AvailabilityReminderLiveEligibilityResult> {
    const normalizedCandidateId = candidateId.trim();
    if (!normalizedCandidateId) this.throwCandidateNotFound();

    const evaluatedAt = new Date(now.getTime());
    return this.prisma.$transaction(async (transaction) => {
      return this.recheckEligibleCandidateWithinTransaction(transaction as any, normalizedCandidateId, evaluatedAt);
    });
  }

  /**
   * Transaction-scoped form used only by the inert attempt-reservation path.
   * The caller must already hold any preceding handoff lock, after which this
   * method takes the shared candidate → favorite → grant → window lock order.
   */
  async recheckEligibleCandidateWithinTransaction(
    db: any,
    candidateId: string,
    now = new Date()
  ): Promise<AvailabilityReminderLiveEligibilityResult> {
    const normalizedCandidateId = candidateId.trim();
    if (!normalizedCandidateId) this.throwCandidateNotFound();

    const evaluatedAt = new Date(now.getTime());
    await this.lockCandidate(db, normalizedCandidateId);
    const candidate = await db.availabilityReminderCandidate.findUnique({
      where: { id: normalizedCandidateId },
      select: {
        id: true,
        favoriteId: true,
        companionId: true,
        availabilityWindowId: true,
        availabilityWindowUpdatedAt: true,
        preflightDecision: true,
        preflightReason: true,
        preflightedAt: true
      }
    }) as ReminderCandidate | null;
    if (!candidate) this.throwCandidateNotFound();
    if (candidate.preflightDecision !== "eligible" || !candidate.preflightedAt) {
      this.throwCandidateNotEligible();
    }

    return this.checkCurrentEligibility(db, candidate, evaluatedAt);
  }

  private async checkCurrentEligibility(
    db: any,
    candidate: ReminderCandidate,
    evaluatedAt: Date
  ): Promise<AvailabilityReminderLiveEligibilityResult> {
    await this.lockFavorite(db, candidate.favoriteId);
    const favorite = await db.companionFavorite.findFirst({
      where: {
        id: candidate.favoriteId,
        companionId: candidate.companionId,
        availabilityReminderEnabled: true,
        availabilityReminderGrantId: { not: null },
        companion: { is: publicFavoriteCompanionWhere() }
      },
      select: {
        id: true,
        userId: true,
        availabilityReminderGrantId: true,
        availabilityReminderLastDeliveredAt: true
      }
    }) as ReminderFavorite | null;
    if (!favorite?.availabilityReminderGrantId) {
      return this.skippedLiveResult(candidate, "favoriteUnavailable");
    }

    // Holding the bound grant lock makes the live decision a truthful snapshot.
    // It remains unconsumed; only a separately-scoped final stage may consume
    // this exact grant immediately before a provider attempt.
    await this.lockSubscriptionGrant(db, favorite.availabilityReminderGrantId);
    const grant = await db.weChatSubscriptionGrant.findFirst({
      where: {
        id: favorite.availabilityReminderGrantId,
        userId: favorite.userId,
        templateKey: AVAILABILITY_REMINDER_TEMPLATE_KEY,
        consumedAt: null
      },
      select: { id: true }
    });
    if (!grant) {
      return this.skippedLiveResult(candidate, "authorizationUnavailable");
    }

    if (this.isRateLimited(favorite.availabilityReminderLastDeliveredAt, evaluatedAt)) {
      return this.skippedLiveResult(candidate, "rateLimited");
    }

    await this.lockAvailabilityWindow(db, candidate.availabilityWindowId);
    const availabilityWindow = await db.companionAvailabilityWindow.findFirst({
      where: {
        id: candidate.availabilityWindowId,
        companionId: candidate.companionId,
        updatedAt: candidate.availabilityWindowUpdatedAt,
        isActive: true,
        endsAt: { gt: new Date(evaluatedAt.getTime() + MIN_BOOKING_LEAD_TIME_MS) }
      },
      select: { id: true, startsAt: true, endsAt: true, capacity: true }
    }) as ReminderWindow | null;
    if (!availabilityWindow) {
      return this.skippedLiveResult(candidate, "availabilityUnavailable");
    }

    const offerings = await db.companionServiceOffering.findMany({
      where: { companionId: candidate.companionId, isActive: true },
      select: { durationMinutes: true }
    }) as Array<{ durationMinutes: number }>;
    if (!offerings.length) {
      return this.skippedLiveResult(candidate, "availabilityUnavailable");
    }

    // This intentionally selects only scheduling metadata, never a customer,
    // conversation, message, payment, refund, or settlement field.
    const reservations = await db.order.findMany({
      where: {
        companionId: candidate.companionId,
        scheduledAt: { lt: availabilityWindow.endsAt },
        status: { in: ["pending", "paying", "paid", "inService", "completed"] }
      },
      select: {
        status: true,
        scheduledAt: true,
        durationMinutes: true,
        companionConfirmedAt: true,
        paymentReservationExpiresAt: true
      }
    }) as AvailabilityReservation[];

    if (!this.hasRemainingBookableCapacity(availabilityWindow, offerings, reservations, evaluatedAt)) {
      return this.skippedLiveResult(candidate, "availabilityUnavailable");
    }

    return {
      candidateId: candidate.id,
      decision: "eligible",
      reason: null,
      preparation: {
        favoriteId: favorite.id,
        userId: favorite.userId,
        subscriptionGrantId: favorite.availabilityReminderGrantId,
        companionId: candidate.companionId,
        availabilityWindowId: candidate.availabilityWindowId
      }
    };
  }

  private skippedLiveResult(
    candidate: ReminderCandidate,
    reason: PreflightSkipReason
  ): AvailabilityReminderLiveEligibilityResult {
    return { candidateId: candidate.id, decision: "skipped", reason, preparation: null };
  }

  private async persistDecision(
    db: any,
    candidateId: string,
    decision: PreflightDecision,
    reason: PreflightSkipReason | null,
    evaluatedAt: Date
  ): Promise<AvailabilityReminderPreflightResult> {
    const persisted = await db.availabilityReminderCandidate.update({
      where: { id: candidateId },
      data: {
        preflightDecision: decision,
        preflightReason: reason,
        preflightedAt: evaluatedAt
      },
      select: {
        id: true,
        preflightDecision: true,
        preflightReason: true,
        preflightedAt: true
      }
    }) as Pick<ReminderCandidate, "id" | "preflightDecision" | "preflightReason" | "preflightedAt">;
    return this.toResult(persisted);
  }

  private hasRemainingBookableCapacity(
    window: ReminderWindow,
    offerings: Array<{ durationMinutes: number }>,
    reservations: AvailabilityReservation[],
    now: Date
  ) {
    const earliestStart = this.roundUpToAvailabilityStep(new Date(Math.max(
      window.startsAt.getTime(),
      now.getTime() + MIN_BOOKING_LEAD_TIME_MS
    )));
    const durations = [...new Set(offerings
      .map((offering) => offering.durationMinutes)
      .filter((duration) => Number.isInteger(duration) && duration >= 30 && duration <= 240 && duration % 30 === 0))]
      .sort((left, right) => left - right);

    for (const durationMinutes of durations) {
      const durationMs = durationMinutes * 60 * 1_000;
      let startsAt = earliestStart;
      while (startsAt.getTime() < window.endsAt.getTime()) {
        const endsAt = new Date(startsAt.getTime() + durationMs);
        if (endsAt.getTime() > window.endsAt.getTime()) break;
        const reservedCount = reservations.filter((order) => this.reservesAvailability(order, startsAt, endsAt, now)).length;
        if (window.capacity - reservedCount > 0) return true;
        startsAt = new Date(startsAt.getTime() + AVAILABILITY_STEP_MS);
      }
    }
    return false;
  }

  private roundUpToAvailabilityStep(value: Date) {
    return new Date(Math.ceil(value.getTime() / AVAILABILITY_STEP_MS) * AVAILABILITY_STEP_MS);
  }

  private reservesAvailability(order: AvailabilityReservation, candidateStart: Date, candidateEnd: Date, now: Date) {
    if (!this.orderReservesAvailability(order, now)) return false;
    const orderStart = order.scheduledAt.getTime();
    const orderEnd = orderStart + order.durationMinutes * 60 * 1_000;
    return orderStart < candidateEnd.getTime() && orderEnd > candidateStart.getTime();
  }

  private orderReservesAvailability(order: AvailabilityReservation, now: Date) {
    if (["paying", "paid", "inService", "completed"].includes(order.status)) return true;
    return order.status === "pending"
      && Boolean(order.companionConfirmedAt)
      && (!order.paymentReservationExpiresAt || order.paymentReservationExpiresAt.getTime() > now.getTime());
  }

  private isRateLimited(lastDeliveredAt: Date | null, now: Date) {
    if (!lastDeliveredAt) return false;
    return lastDeliveredAt.getTime() + AVAILABILITY_REMINDER_MINIMUM_INTERVAL_MS > now.getTime();
  }

  private toResult(candidate: Pick<ReminderCandidate, "id" | "preflightDecision" | "preflightReason" | "preflightedAt">): AvailabilityReminderPreflightResult {
    return {
      candidateId: candidate.id,
      decision: candidate.preflightDecision as PreflightDecision,
      reason: candidate.preflightReason ?? null,
      decidedAt: candidate.preflightedAt?.toISOString() ?? null
    };
  }

  private async lockCandidate(db: any, candidateId: string) {
    if (typeof db.$queryRaw !== "function") return;
    await db.$queryRaw`SELECT "id" FROM "AvailabilityReminderCandidate" WHERE "id" = ${candidateId} FOR UPDATE`;
  }

  private async lockFavorite(db: any, favoriteId: string) {
    if (typeof db.$queryRaw !== "function") return;
    await db.$queryRaw`SELECT "id" FROM "CompanionFavorite" WHERE "id" = ${favoriteId} FOR UPDATE`;
  }

  private async lockSubscriptionGrant(db: any, grantId: string) {
    if (typeof db.$queryRaw !== "function") return;
    await db.$queryRaw`SELECT "id" FROM "WeChatSubscriptionGrant" WHERE "id" = ${grantId} FOR UPDATE`;
  }

  private async lockAvailabilityWindow(db: any, availabilityWindowId: string) {
    if (typeof db.$queryRaw !== "function") return;
    await db.$queryRaw`SELECT "id" FROM "CompanionAvailabilityWindow" WHERE "id" = ${availabilityWindowId} FOR UPDATE`;
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
