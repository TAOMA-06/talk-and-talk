import { randomUUID } from "node:crypto";

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { PrismaService } from "../database/prisma.service";
import { MetricsService } from "../metrics/metrics.service";
import {
  AvailabilityReminderAttemptConsumptionResult,
  AvailabilityReminderAttemptConsumptionService
} from "./availability-reminder-attempt-consumption.service";
import {
  AvailabilityReminderAttemptDeliveryResult,
  AvailabilityReminderAttemptDeliveryService
} from "./availability-reminder-attempt-delivery.service";

const DEFAULT_INTERVAL_SECONDS = 60;
const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 100;
const BATCHES_PER_TICK = 5;
const WORK_LEASE_MS = 2 * 60_000;
const TICK_WALL_BUDGET_MS = 45_000;
const MAX_FAILURES = 8;
const MAX_RETRY_DELAY_MS = 5 * 60_000;

export type AvailabilityReminderDeliveryRunResult = {
  scanned: number;
  recovered: number;
  authorized: number;
  sent: number;
  skipped: number;
  failedBeforeSend: number;
  rejected: number;
  uncertain: number;
  inFlight: number;
  notReady: number;
  errors: number;
  retryScheduled: number;
  failed: number;
  leaseLost: number;
};

type DeliveryClaim = {
  id: string;
  status: "reserved" | "readyToSend" | "sending";
  deliveryFailureCount: number;
  leaseToken: string;
};

/**
 * Explicitly opt-in coordinator for the irreversible availability-reminder
 * boundary. A pass can only (a) quarantine an expired active lease or (b)
 * consume a freshly-reserved attempt and immediately hand its new lease to the
 * existing delivery service. It deliberately never revisits a live old lease,
 * terminal attempt, or uncertain remote result.
 */
@Injectable()
export class AvailabilityReminderDeliveryRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AvailabilityReminderDeliveryRunner.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly consumption: AvailabilityReminderAttemptConsumptionService,
    private readonly delivery: AvailabilityReminderAttemptDeliveryService,
    private readonly metrics: MetricsService
  ) {}

  onModuleInit() {
    if (!this.isEnabled()) return;

    const intervalMs = (this.config.get<number>("AVAILABILITY_REMINDER_DELIVERY_INTERVAL_SECONDS")
      ?? DEFAULT_INTERVAL_SECONDS) * 1_000;
    this.timer = setInterval(() => this.deliverDueSafely(), intervalMs);
    this.timer.unref?.();
    this.deliverDueSafely();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async deliverDue(): Promise<AvailabilityReminderDeliveryRunResult | undefined> {
    if (this.running || !this.isEnabled()) return;

    this.running = true;
    try {
      const tickStartedAt = Date.now();
      const batchSize = this.config.get<number>("AVAILABILITY_REMINDER_DELIVERY_BATCH_SIZE")
        ?? DEFAULT_BATCH_SIZE;
      const result = this.emptyResult();

      // Expired irreversible leases are claimed first; otherwise replicas
      // claim fresh reserved attempts. One-at-a-time refill keeps the batch
      // bounded and lets a poison row back off without blocking later work.
      const normalizedBatchSize = this.normalizeLimit(batchSize);
      let wallBudgetReached = false;
      for (let batch = 0; batch < BATCHES_PER_TICK; batch += 1) {
        let claimedInBatch = 0;
        for (let index = 0; index < normalizedBatchSize; index += 1) {
          // Every durable lease is based on wall-clock time at the actual claim,
          // never the start of a potentially slow provider tick.
          if (Date.now() - tickStartedAt >= TICK_WALL_BUDGET_MS) {
            wallBudgetReached = true;
            break;
          }
          const claim = await this.claimNext(new Date());
          if (!claim) break;
          claimedInBatch += 1;
          result.scanned += 1;
          if (claim.status === "reserved") {
            await this.consumeAndDeliverFreshAttempt(claim, result);
          } else {
            await this.recoverExpiredAttempt(claim, result);
          }
        }
        if (wallBudgetReached || claimedInBatch < normalizedBatchSize) break;
      }

      if (result.scanned > 0) this.logAggregate(result);
      return result;
    } catch (error) {
      this.metrics.recordAvailabilityReminderDeliveryFailure();
      throw error;
    } finally {
      this.running = false;
    }
  }

  private isEnabled() {
    return this.config.get<boolean>("AVAILABILITY_REMINDER_DELIVERY_ENABLED") === true
      && this.config.get<boolean>("WECHAT_SUBSCRIBE_MESSAGES_ENABLED") === true;
  }

  private async recoverExpiredAttempt(
    claim: DeliveryClaim,
    result: AvailabilityReminderDeliveryRunResult
  ) {
    try {
      const recovery = await this.consumption.recoverExpiredSendLease(claim.id, new Date());
      if (recovery.decision === "recoveryRequired") {
        result.recovered += 1;
        result.uncertain += 1;
        this.metrics.recordAvailabilityReminderDeliveryFailure();
        if (!await this.releaseClaim(claim)) result.leaseLost += 1;
        return;
      }
      this.recordConsumptionWithoutSend(recovery, result);
      if (!await this.releaseClaim(claim)) result.leaseLost += 1;
    } catch (error) {
      result.errors += 1;
      this.metrics.recordAvailabilityReminderDeliveryFailure();
      await this.recordClaimFailure(claim, error, new Date(), result);
    }
  }

  private async consumeAndDeliverFreshAttempt(
    claim: DeliveryClaim,
    result: AvailabilityReminderDeliveryRunResult
  ) {
    try {
      const authorization = await this.consumption.acquireFinalSendAuthorization(claim.id, new Date());
      if (authorization.decision !== "authorized") {
        this.recordConsumptionWithoutSend(authorization, result);
        if (!await this.releaseClaim(claim)) result.leaseLost += 1;
        return;
      }

      result.authorized += 1;
      // This should be guaranteed by the consumption service. Keeping the
      // defensive guard here ensures a malformed internal result cannot turn
      // into a delivery call without the exact fresh lease token.
      if (!authorization.sendLeaseToken) {
        throw new Error("AVAILABILITY_REMINDER_SEND_LEASE_MISSING");
      }

      const delivery = await this.delivery.deliver(claim.id, authorization.sendLeaseToken, new Date());
      this.recordDelivery(delivery, result);
      if (!await this.releaseClaim(claim)) result.leaseLost += 1;
    } catch (error) {
      result.errors += 1;
      this.metrics.recordAvailabilityReminderDeliveryFailure();
      await this.recordClaimFailure(claim, error, new Date(), result);
    }
  }

  private async claimNext(now: Date): Promise<DeliveryClaim | null> {
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + WORK_LEASE_MS);
    const rows = await this.prisma.$queryRaw<Array<{
      id: string;
      status: "reserved" | "readyToSend" | "sending";
      deliveryFailureCount: number;
    }>>`
      WITH due AS (
        SELECT attempt."id"
        FROM "AvailabilityReminderAttempt" attempt
        WHERE attempt."deliveryFailedAt" IS NULL
          AND attempt."deliveryNextAttemptAt" <= ${now}
          AND (
            attempt."deliveryClaimToken" IS NULL
            OR attempt."deliveryClaimExpiresAt" IS NULL
            OR attempt."deliveryClaimExpiresAt" <= ${now}
          )
          AND (
            attempt."status"::text = 'reserved'
            OR (
              attempt."status"::text IN ('readyToSend', 'sending')
              AND (
                attempt."sendLeaseExpiresAt" IS NULL
                OR attempt."sendLeaseExpiresAt" <= ${now}
              )
            )
          )
        ORDER BY
          CASE WHEN attempt."status"::text IN ('readyToSend', 'sending') THEN 0 ELSE 1 END,
          attempt."createdAt" ASC,
          attempt."id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "AvailabilityReminderAttempt" attempt
      SET "deliveryClaimToken" = ${leaseToken},
          "deliveryClaimExpiresAt" = ${leaseExpiresAt},
          "updatedAt" = ${now}
      FROM due
      WHERE attempt."id" = due."id"
      RETURNING attempt."id", attempt."status"::text AS "status", attempt."deliveryFailureCount"
    `;
    return rows[0] ? { ...rows[0], leaseToken } : null;
  }

  private async releaseClaim(claim: DeliveryClaim) {
    const released = await this.prisma.availabilityReminderAttempt.updateMany({
      where: { id: claim.id, deliveryClaimToken: claim.leaseToken },
      data: {
        deliveryClaimToken: null,
        deliveryClaimExpiresAt: null,
        deliveryLastErrorCode: null
      }
    } as any);
    return released.count === 1;
  }

  private async recordClaimFailure(
    claim: DeliveryClaim,
    error: unknown,
    now: Date,
    result: AvailabilityReminderDeliveryRunResult
  ) {
    const failureCount = claim.deliveryFailureCount + 1;
    const terminal = failureCount >= MAX_FAILURES;
    const failed = await this.prisma.availabilityReminderAttempt.updateMany({
      where: { id: claim.id, deliveryClaimToken: claim.leaseToken },
      data: {
        deliveryClaimToken: null,
        deliveryClaimExpiresAt: null,
        deliveryFailureCount: failureCount,
        deliveryNextAttemptAt: new Date(now.getTime() + this.retryDelayMs(failureCount)),
        deliveryLastErrorCode: this.errorCode(error),
        deliveryFailedAt: terminal ? now : null
      }
    } as any);
    if (failed.count !== 1) result.leaseLost += 1;
    else if (terminal) result.failed += 1;
    else result.retryScheduled += 1;
  }

  private normalizeLimit(value: number) {
    if (!Number.isFinite(value)) return DEFAULT_BATCH_SIZE;
    return Math.min(MAX_BATCH_SIZE, Math.max(1, Math.floor(value)));
  }

  private retryDelayMs(failureCount: number) {
    return Math.min(MAX_RETRY_DELAY_MS, 5_000 * 2 ** Math.max(0, failureCount - 1));
  }

  private errorCode(error: unknown) {
    const name = error instanceof Error ? error.name : "unknown_error";
    return name.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80) || "unknown_error";
  }

  private recordConsumptionWithoutSend(
    result: AvailabilityReminderAttemptConsumptionResult,
    aggregate: AvailabilityReminderDeliveryRunResult
  ) {
    if (result.decision === "skipped") {
      aggregate.skipped += 1;
      this.metrics.recordAvailabilityReminderDeliverySkipped();
      return;
    }
    if (result.decision === "recoveryRequired") {
      aggregate.uncertain += 1;
      this.metrics.recordAvailabilityReminderDeliveryFailure();
      return;
    }
    if (result.decision === "inFlight") {
      aggregate.inFlight += 1;
      return;
    }
    aggregate.notReady += 1;
  }

  private recordDelivery(
    result: AvailabilityReminderAttemptDeliveryResult,
    aggregate: AvailabilityReminderDeliveryRunResult
  ) {
    if (result.decision === "sent") {
      aggregate.sent += 1;
      this.metrics.recordAvailabilityReminderDeliverySuccess();
      return;
    }
    if (result.decision === "skipped") {
      aggregate.skipped += 1;
      this.metrics.recordAvailabilityReminderDeliverySkipped();
      return;
    }
    if (result.decision === "failedBeforeSend") {
      aggregate.failedBeforeSend += 1;
      this.metrics.recordAvailabilityReminderDeliveryFailure();
      return;
    }
    if (result.decision === "rejected") {
      aggregate.rejected += 1;
      this.metrics.recordAvailabilityReminderDeliveryFailure();
      return;
    }
    if (result.decision === "uncertain") {
      aggregate.uncertain += 1;
      this.metrics.recordAvailabilityReminderDeliveryFailure();
      return;
    }
    if (result.decision === "inFlight") {
      aggregate.inFlight += 1;
      return;
    }
    aggregate.notReady += 1;
  }

  private deliverDueSafely(): void {
    void this.deliverDue().catch((error) => {
      this.logger.error(
        `Availability reminder delivery failed (${error instanceof Error ? error.name : "unknown_error"})`
      );
    });
  }

  private emptyResult(): AvailabilityReminderDeliveryRunResult {
    return {
      scanned: 0,
      recovered: 0,
      authorized: 0,
      sent: 0,
      skipped: 0,
      failedBeforeSend: 0,
      rejected: 0,
      uncertain: 0,
      inFlight: 0,
      notReady: 0,
      errors: 0,
      retryScheduled: 0,
      failed: 0,
      leaseLost: 0
    };
  }

  private logAggregate(result: AvailabilityReminderDeliveryRunResult) {
    this.logger.log(
      `Availability reminder delivery scanned=${result.scanned} recovered=${result.recovered} `
      + `authorized=${result.authorized} sent=${result.sent} skipped=${result.skipped} `
      + `failedBeforeSend=${result.failedBeforeSend} rejected=${result.rejected} `
      + `uncertain=${result.uncertain} inFlight=${result.inFlight} `
      + `notReady=${result.notReady} errors=${result.errors} `
      + `retryScheduled=${result.retryScheduled} failed=${result.failed} leaseLost=${result.leaseLost}`
    );
  }
}
