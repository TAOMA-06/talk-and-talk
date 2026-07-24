import { HttpStatus, Injectable } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import {
  SubscribeMessageResult,
  WeChatSubscribeMessageProvider
} from "../notifications/wechat/wechat-subscribe-message.provider";
import { publicFavoriteCompanionWhere } from "./favorite-companion-eligibility";

const AVAILABILITY_REMINDER_TEMPLATE_KEY = "availabilityReminder";
const AVAILABILITY_REMINDER_TITLE = "你收藏的陪伴者有新的可约时段";
const AVAILABILITY_REMINDER_BODY = "打开小程序查看当前可预约时段。";

type AttemptStatus = "reserved" | "readyToSend" | "sending" | "sent" | "skipped" | "failedBeforeSend" | "rejected" | "uncertain";
type AttemptOutcomeReason =
  | "favoriteUnavailable"
  | "authorizationUnavailable"
  | "availabilityUnavailable"
  | "rateLimited"
  | "handoffUnavailable"
  | "preflightUnavailable"
  | "sendLeaseExpired"
  | "providerSkipped"
  | "providerPreSendFailed"
  | "providerRejected"
  | "providerUnknown";

type ReminderAttempt = {
  id: string;
  handoffId: string;
  subscriptionGrantId: string;
  status: AttemptStatus;
  outcomeReason: AttemptOutcomeReason | null;
  authorizationConsumedAt: Date | null;
  sendLeaseToken: string | null;
  sendLeaseExpiresAt: Date | null;
};

type SendClaim =
  | {
    kind: "claimed";
    attemptId: string;
    sendLeaseToken: string;
    userId: string;
    templateId: string;
  }
  | { kind: "result"; result: AvailabilityReminderAttemptDeliveryResult };

export type AvailabilityReminderAttemptDeliveryResult = {
  attemptId: string;
  decision: "sent" | "skipped" | "failedBeforeSend" | "rejected" | "uncertain" | "inFlight" | "notReady";
  reason: AttemptOutcomeReason | null;
};

/**
 * Performs one provider call only after the consumption service issued a
 * matching live lease. The external request is intentionally outside database
 * transactions. Once `sending` is written, a crash is always quarantined as
 * uncertain rather than retried automatically.
 */
@Injectable()
export class AvailabilityReminderAttemptDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: WeChatSubscribeMessageProvider
  ) {}

  async deliver(
    attemptId: string,
    sendLeaseToken: string,
    now = new Date()
  ): Promise<AvailabilityReminderAttemptDeliveryResult> {
    const normalizedAttemptId = attemptId.trim();
    if (!normalizedAttemptId) this.throwAttemptNotFound();
    const normalizedLeaseToken = sendLeaseToken.trim();
    const startedAt = new Date(now.getTime());
    const claim = await this.claimProviderAttempt(normalizedAttemptId, normalizedLeaseToken, startedAt);
    if (claim.kind === "result") return claim.result;

    let outcome: SubscribeMessageResult;
    try {
      outcome = await this.provider.send({
        userId: claim.userId,
        templateKey: AVAILABILITY_REMINDER_TEMPLATE_KEY,
        templateId: claim.templateId,
        title: AVAILABILITY_REMINDER_TITLE,
        body: AVAILABILITY_REMINDER_BODY,
        data: null
      });
    } catch (error) {
      // A thrown client error occurs after the remote boundary was entered.
      // It must be handled exactly like an uncertain provider result.
      outcome = {
        outcome: "failed",
        attempted: true,
        remoteState: "unknown",
        errorCode: "DELIVERY_UNKNOWN",
        message: error instanceof Error ? error.name : "unknown_error"
      };
    }

    return this.finalizeProviderOutcome(claim.attemptId, claim.sendLeaseToken, outcome, new Date());
  }

  private async claimProviderAttempt(
    attemptId: string,
    sendLeaseToken: string,
    now: Date
  ): Promise<SendClaim> {
    return this.prisma.$transaction(async (transaction) => {
      const db = transaction as any;
      // The provider boundary uses attempt → handoff → candidate → favorite →
      // grant. It rechecks that the customer has not since disarmed the exact
      // reminder before crossing the remote boundary.
      await this.lockAttempt(db, attemptId);
      const attempt = await this.findAttempt(db, attemptId);
      if (!attempt) this.throwAttemptNotFound();

      if (attempt.status === "sending") {
        return { kind: "result", result: await this.activeOrQuarantined(db, attempt, now) };
      }
      if (attempt.status !== "readyToSend") {
        return { kind: "result", result: this.toResult(attempt) };
      }
      if (!this.hasActiveLease(attempt, sendLeaseToken, now)) {
        return { kind: "result", result: await this.activeOrQuarantined(db, attempt, now) };
      }

      await this.lockHandoff(db, attempt.handoffId);
      const handoff = await db.availabilityReminderHandoff.findUnique({
        where: { id: attempt.handoffId },
        select: { candidateId: true }
      }) as { candidateId: string } | null;
      if (!handoff) {
        return { kind: "result", result: await this.finishSkippedWithoutProvider(db, attempt, now, "HANDOFF_UNAVAILABLE") };
      }

      await this.lockCandidate(db, handoff.candidateId);
      const candidate = await db.availabilityReminderCandidate.findUnique({
        where: { id: handoff.candidateId },
        select: { favoriteId: true }
      }) as { favoriteId: string } | null;
      if (!candidate) {
        return { kind: "result", result: await this.finishSkippedWithoutProvider(db, attempt, now, "CANDIDATE_UNAVAILABLE") };
      }

      await this.lockFavorite(db, candidate.favoriteId);
      const favorite = await db.companionFavorite.findFirst({
        where: {
          id: candidate.favoriteId,
          availabilityReminderEnabled: true,
          availabilityReminderGrantId: attempt.subscriptionGrantId,
          companion: { is: publicFavoriteCompanionWhere() }
        },
        select: { userId: true }
      }) as { userId: string } | null;
      if (!favorite) {
        return { kind: "result", result: await this.finishSkippedWithoutProvider(db, attempt, now, "REMINDER_DISARMED") };
      }

      await this.lockSubscriptionGrant(db, attempt.subscriptionGrantId);
      const grant = await db.weChatSubscriptionGrant.findFirst({
        where: {
          id: attempt.subscriptionGrantId,
          userId: favorite.userId,
          templateKey: AVAILABILITY_REMINDER_TEMPLATE_KEY,
          consumedAt: { not: null },
          consumedByDeliveryId: null,
          availabilityReminderAttempt: {
            is: { id: attempt.id, handoffId: attempt.handoffId, status: "readyToSend" }
          }
        },
        select: { id: true, userId: true, templateId: true }
      }) as { id: string; userId: string; templateId: string | null } | null;
      if (!grant || !grant.templateId?.trim()) {
        return {
          kind: "result",
          result: await this.finishWithoutProvider(db, attempt, now, "BOUND_GRANT_UNAVAILABLE")
        };
      }

      const claimed = await db.availabilityReminderAttempt.updateMany({
        where: { id: attempt.id, status: "readyToSend", sendLeaseToken },
        data: {
          status: "sending",
          providerAttemptStartedAt: now,
          providerResolvedAt: null,
          providerMessageId: null,
          providerErrorCode: null
        }
      });
      if (claimed.count !== 1) this.throwStateConflict();

      return {
        kind: "claimed",
        attemptId: attempt.id,
        sendLeaseToken,
        userId: grant.userId,
        templateId: grant.templateId.trim()
      };
    });
  }

  private async finalizeProviderOutcome(
    attemptId: string,
    sendLeaseToken: string,
    outcome: SubscribeMessageResult,
    resolvedAt: Date
  ): Promise<AvailabilityReminderAttemptDeliveryResult> {
    return this.prisma.$transaction(async (transaction) => {
      const db = transaction as any;
      await this.lockAttempt(db, attemptId);
      const attempt = await this.findAttempt(db, attemptId);
      if (!attempt) return { attemptId, decision: "uncertain", reason: "providerUnknown" };
      if (attempt.status !== "sending" || attempt.sendLeaseToken !== sendLeaseToken) {
        return this.toResult(attempt);
      }

      if (outcome.outcome === "sent" && outcome.remoteState === "accepted") {
        return this.finishSent(db, attempt, outcome, resolvedAt);
      }
      // Remote certainty wins over a provider's broad outcome label. This
      // makes an adapter regression unable to turn a possibly-sent request
      // into a harmless-looking skip.
      if (outcome.remoteState === "unknown") {
        return this.finishTerminal(db, attempt, {
          status: "uncertain",
          reason: "providerUnknown",
          errorCode: outcome.errorCode ?? "DELIVERY_UNKNOWN",
          resolvedAt,
          preserveLeaseExpiry: true
        });
      }
      if (outcome.remoteState === "rejected") {
        return this.finishTerminal(db, attempt, {
          status: "rejected",
          reason: "providerRejected",
          errorCode: outcome.errorCode,
          resolvedAt
        });
      }
      if (outcome.outcome === "skipped") {
        return this.finishTerminal(db, attempt, {
          status: "skipped",
          reason: "providerSkipped",
          errorCode: outcome.errorCode,
          resolvedAt
        });
      }
      if (outcome.remoteState === "notAttempted" || !outcome.attempted) {
        return this.finishTerminal(db, attempt, {
          status: "failedBeforeSend",
          reason: "providerPreSendFailed",
          errorCode: outcome.errorCode,
          resolvedAt
        });
      }
      return this.finishTerminal(db, attempt, {
        status: "uncertain",
        reason: "providerUnknown",
        errorCode: outcome.errorCode ?? "DELIVERY_UNKNOWN",
        resolvedAt,
        preserveLeaseExpiry: true
      });
    });
  }

  private async finishSent(
    db: any,
    attempt: ReminderAttempt,
    outcome: SubscribeMessageResult,
    resolvedAt: Date
  ): Promise<AvailabilityReminderAttemptDeliveryResult> {
    // Updating frequency is a success-only write. It shares the relevant
    // attempt → handoff → candidate → favorite prefix of the global lock order.
    await this.lockHandoff(db, attempt.handoffId);
    const handoff = await db.availabilityReminderHandoff.findUnique({
      where: { id: attempt.handoffId },
      select: { candidateId: true }
    }) as { candidateId: string } | null;
    if (!handoff) return this.finishTerminal(db, attempt, {
      status: "uncertain",
      reason: "providerUnknown",
      errorCode: "HANDOFF_MISSING_AFTER_PROVIDER_ACCEPTANCE",
      resolvedAt,
      preserveLeaseExpiry: true
    });

    await this.lockCandidate(db, handoff.candidateId);
    const candidate = await db.availabilityReminderCandidate.findUnique({
      where: { id: handoff.candidateId },
      select: { favoriteId: true }
    }) as { favoriteId: string } | null;
    if (!candidate) return this.finishTerminal(db, attempt, {
      status: "uncertain",
      reason: "providerUnknown",
      errorCode: "CANDIDATE_MISSING_AFTER_PROVIDER_ACCEPTANCE",
      resolvedAt,
      preserveLeaseExpiry: true
    });

    await this.lockFavorite(db, candidate.favoriteId);
    const finalized = await db.availabilityReminderAttempt.updateMany({
      where: { id: attempt.id, status: "sending", sendLeaseToken: attempt.sendLeaseToken },
      data: {
        status: "sent",
        outcomeReason: null,
        providerResolvedAt: resolvedAt,
        providerMessageId: outcome.providerMessageId ?? null,
        providerErrorCode: null,
        sendLeaseToken: null,
        sendLeaseExpiresAt: null
      }
    });
    if (finalized.count !== 1) this.throwStateConflict();

    const frequencyUpdated = await db.companionFavorite.updateMany({
      where: { id: candidate.favoriteId },
      data: { availabilityReminderLastDeliveredAt: resolvedAt }
    });
    if (frequencyUpdated.count !== 1) this.throwStateConflict();
    return { attemptId: attempt.id, decision: "sent", reason: null };
  }

  private async finishWithoutProvider(
    db: any,
    attempt: ReminderAttempt,
    resolvedAt: Date,
    errorCode: string
  ): Promise<AvailabilityReminderAttemptDeliveryResult> {
    return this.finishTerminal(db, attempt, {
      status: "failedBeforeSend",
      reason: "providerPreSendFailed",
      errorCode,
      resolvedAt
    });
  }

  private async finishSkippedWithoutProvider(
    db: any,
    attempt: ReminderAttempt,
    resolvedAt: Date,
    errorCode: string
  ): Promise<AvailabilityReminderAttemptDeliveryResult> {
    return this.finishTerminal(db, attempt, {
      status: "skipped",
      reason: "providerSkipped",
      errorCode,
      resolvedAt
    });
  }

  private async finishTerminal(
    db: any,
    attempt: ReminderAttempt,
    input: {
      status: "skipped" | "failedBeforeSend" | "rejected" | "uncertain";
      reason: "sendLeaseExpired" | "providerSkipped" | "providerPreSendFailed" | "providerRejected" | "providerUnknown";
      errorCode?: string;
      resolvedAt: Date;
      preserveLeaseExpiry?: boolean;
    }
  ): Promise<AvailabilityReminderAttemptDeliveryResult> {
    const finalized = await db.availabilityReminderAttempt.updateMany({
      where: { id: attempt.id, status: attempt.status, sendLeaseToken: attempt.sendLeaseToken },
      data: {
        status: input.status,
        outcomeReason: input.reason,
        providerResolvedAt: input.resolvedAt,
        providerMessageId: null,
        providerErrorCode: this.compactErrorCode(input.errorCode),
        sendLeaseToken: null,
        ...(input.preserveLeaseExpiry ? {} : { sendLeaseExpiresAt: null })
      }
    });
    if (finalized.count !== 1) this.throwStateConflict();

    return { attemptId: attempt.id, decision: input.status, reason: input.reason };
  }

  private async activeOrQuarantined(
    db: any,
    attempt: ReminderAttempt,
    now: Date
  ): Promise<AvailabilityReminderAttemptDeliveryResult> {
    if (
      attempt.authorizationConsumedAt
      && attempt.sendLeaseToken
      && attempt.sendLeaseExpiresAt
      && attempt.sendLeaseExpiresAt.getTime() > now.getTime()
    ) {
      return { attemptId: attempt.id, decision: "inFlight", reason: null };
    }
    return this.finishTerminal(db, attempt, {
      status: "uncertain",
      reason: "sendLeaseExpired",
      errorCode: "SEND_LEASE_EXPIRED",
      resolvedAt: now,
      preserveLeaseExpiry: true
    });
  }

  private hasActiveLease(attempt: ReminderAttempt, sendLeaseToken: string, now: Date) {
    return Boolean(
      sendLeaseToken
      && attempt.authorizationConsumedAt
      && attempt.sendLeaseToken === sendLeaseToken
      && attempt.sendLeaseExpiresAt
      && attempt.sendLeaseExpiresAt.getTime() > now.getTime()
    );
  }

  private toResult(attempt: ReminderAttempt): AvailabilityReminderAttemptDeliveryResult {
    if (attempt.status === "sent") return { attemptId: attempt.id, decision: "sent", reason: null };
    if (attempt.status === "skipped") {
      return { attemptId: attempt.id, decision: "skipped", reason: attempt.outcomeReason ?? "providerSkipped" };
    }
    if (attempt.status === "failedBeforeSend") {
      return { attemptId: attempt.id, decision: "failedBeforeSend", reason: attempt.outcomeReason ?? "providerPreSendFailed" };
    }
    if (attempt.status === "rejected") {
      return { attemptId: attempt.id, decision: "rejected", reason: attempt.outcomeReason ?? "providerRejected" };
    }
    if (attempt.status === "uncertain") {
      return { attemptId: attempt.id, decision: "uncertain", reason: attempt.outcomeReason ?? "providerUnknown" };
    }
    if (attempt.status === "readyToSend" || attempt.status === "sending") {
      return { attemptId: attempt.id, decision: "inFlight", reason: null };
    }
    return { attemptId: attempt.id, decision: "notReady", reason: null };
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

  private compactErrorCode(value: string | undefined) {
    const normalized = value?.trim();
    return normalized ? normalized.slice(0, 120) : null;
  }

  private async lockAttempt(db: any, attemptId: string) {
    if (typeof db.$queryRaw !== "function") return;
    await db.$queryRaw`SELECT "id" FROM "AvailabilityReminderAttempt" WHERE "id" = ${attemptId} FOR UPDATE`;
  }

  private async lockHandoff(db: any, handoffId: string) {
    if (typeof db.$queryRaw !== "function") return;
    await db.$queryRaw`SELECT "id" FROM "AvailabilityReminderHandoff" WHERE "id" = ${handoffId} FOR UPDATE`;
  }

  private async lockCandidate(db: any, candidateId: string) {
    if (typeof db.$queryRaw !== "function") return;
    await db.$queryRaw`SELECT "id" FROM "AvailabilityReminderCandidate" WHERE "id" = ${candidateId} FOR UPDATE`;
  }

  private async lockFavorite(db: any, favoriteId: string) {
    if (typeof db.$queryRaw !== "function") return;
    await db.$queryRaw`SELECT "id" FROM "CompanionFavorite" WHERE "id" = ${favoriteId} FOR UPDATE`;
  }

  private async lockSubscriptionGrant(db: any, subscriptionGrantId: string) {
    if (typeof db.$queryRaw !== "function") return;
    await db.$queryRaw`SELECT "id" FROM "WeChatSubscriptionGrant" WHERE "id" = ${subscriptionGrantId} FOR UPDATE`;
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
      "Availability reminder attempt state changed before it could be delivered",
      HttpStatus.CONFLICT
    );
  }
}
