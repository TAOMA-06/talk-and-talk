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
const DEFAULT_BATCH_SIZE = 20;

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
      const now = new Date();
      const batchSize = this.config.get<number>("AVAILABILITY_REMINDER_DELIVERY_BATCH_SIZE")
        ?? DEFAULT_BATCH_SIZE;
      const result = this.emptyResult();

      // A ready/sending lease is only inspected when it is already expired or
      // malformed. It is never handed back to delivery from this runner: an
      // unknown remote boundary must remain quarantined rather than retried.
      const expiredActiveAttempts = await this.prisma.availabilityReminderAttempt.findMany({
        where: {
          status: { in: ["readyToSend", "sending"] },
          OR: [
            { sendLeaseExpiresAt: { lte: now } },
            { sendLeaseExpiresAt: null }
          ]
        },
        select: { id: true },
        orderBy: [{ sendLeaseExpiresAt: "asc" }, { id: "asc" }],
        take: batchSize
      } as any) as Array<{ id: string }>;
      result.scanned += expiredActiveAttempts.length;

      for (const attempt of expiredActiveAttempts) {
        await this.recoverExpiredAttempt(attempt.id, now, result);
      }

      // Share the pass budget with recovery. The only eligible send path below
      // starts from `reserved`, which guarantees that a delivery call can use
      // only the brand-new in-memory lease returned by final consumption.
      const remaining = Math.max(0, batchSize - expiredActiveAttempts.length);
      if (remaining > 0) {
        const reservedAttempts = await this.prisma.availabilityReminderAttempt.findMany({
          where: { status: "reserved" },
          select: { id: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: remaining
        } as any) as Array<{ id: string }>;
        result.scanned += reservedAttempts.length;

        for (const attempt of reservedAttempts) {
          await this.consumeAndDeliverFreshAttempt(attempt.id, now, result);
        }
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
    attemptId: string,
    now: Date,
    result: AvailabilityReminderDeliveryRunResult
  ) {
    try {
      const recovery = await this.consumption.recoverExpiredSendLease(attemptId, now);
      if (recovery.decision === "recoveryRequired") {
        result.recovered += 1;
        result.uncertain += 1;
        this.metrics.recordAvailabilityReminderDeliveryFailure();
        return;
      }
      this.recordConsumptionWithoutSend(recovery, result);
    } catch {
      result.errors += 1;
      this.metrics.recordAvailabilityReminderDeliveryFailure();
    }
  }

  private async consumeAndDeliverFreshAttempt(
    attemptId: string,
    now: Date,
    result: AvailabilityReminderDeliveryRunResult
  ) {
    try {
      const authorization = await this.consumption.acquireFinalSendAuthorization(attemptId, now);
      if (authorization.decision !== "authorized") {
        this.recordConsumptionWithoutSend(authorization, result);
        return;
      }

      result.authorized += 1;
      // This should be guaranteed by the consumption service. Keeping the
      // defensive guard here ensures a malformed internal result cannot turn
      // into a delivery call without the exact fresh lease token.
      if (!authorization.sendLeaseToken) {
        result.errors += 1;
        this.metrics.recordAvailabilityReminderDeliveryFailure();
        return;
      }

      const delivery = await this.delivery.deliver(attemptId, authorization.sendLeaseToken, now);
      this.recordDelivery(delivery, result);
    } catch {
      result.errors += 1;
      this.metrics.recordAvailabilityReminderDeliveryFailure();
    }
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
      errors: 0
    };
  }

  private logAggregate(result: AvailabilityReminderDeliveryRunResult) {
    this.logger.log(
      `Availability reminder delivery scanned=${result.scanned} recovered=${result.recovered} `
      + `authorized=${result.authorized} sent=${result.sent} skipped=${result.skipped} `
      + `failedBeforeSend=${result.failedBeforeSend} rejected=${result.rejected} `
      + `uncertain=${result.uncertain} inFlight=${result.inFlight} `
      + `notReady=${result.notReady} errors=${result.errors}`
    );
  }
}
