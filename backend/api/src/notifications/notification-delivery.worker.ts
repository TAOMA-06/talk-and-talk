import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";

import { PrismaService } from "../database/prisma.service";
import { MetricsService } from "../metrics/metrics.service";
import { conversationIdFromMessageNotificationEventKey } from "./notifications.service";
import { notificationDeliveryIntervalSeconds } from "./notification-delivery.policy";
import { WeChatSubscribeMessageProvider } from "./wechat/wechat-subscribe-message.provider";

const LEASE_MS = 2 * 60_000;
const AUTHORIZATION_WAIT_MS = 10 * 60_000;
const NO_GRANT_RECHECK_MS = 30_000;
const MAX_PRE_SEND_RETRIES = 3;
const MAX_DELIVERY_BATCH_SIZE = 200;
const CLAIM_CHUNK_SIZE = 20;
const PROVIDER_CONCURRENCY = 5;
const MAX_RECOVERY_BATCHES_PER_RUN = 4;

type DeliveryClaim = { id: string; leaseToken: string };
type DeliveryResult = "sent" | "failed" | "skipped" | "deferred" | "lost";

/**
 * Durable delivery worker. It leases a database row before reading a
 * one-time subscription grant, so restarts and concurrent API replicas cannot
 * turn a transactional notification into an unbounded or duplicate push loop.
 */
@Injectable()
export class NotificationDeliveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationDeliveryWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly provider: WeChatSubscribeMessageProvider,
    private readonly metrics: MetricsService
  ) {}

  onModuleInit() {
    if (!this.config.get<boolean>("NOTIFICATION_DELIVERY_ENABLED")) return;
    const interval = notificationDeliveryIntervalSeconds(this.config) * 1_000;
    this.timer = setInterval(() => this.deliverDueSafely(), interval);
    this.timer.unref?.();
    this.deliverDueSafely();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async deliverDue() {
    if (this.running || !this.config.get<boolean>("NOTIFICATION_DELIVERY_ENABLED")) return;
    this.running = true;
    try {
      const now = new Date();
      const batchSize = this.normalizeBatchSize(
        this.config.get<number>("NOTIFICATION_DELIVERY_BATCH_SIZE") ?? 20
      );
      const recovered = await this.recoverExpiredLeases(now, batchSize);
      if (recovered > 0) {
        for (let index = 0; index < recovered; index += 1) {
          this.metrics.recordNotificationDeliveryFailure();
        }
        this.logger.warn(`Marked ${recovered} expired notification lease(s) failed to avoid duplicate delivery.`);
      }

      let scanned = 0;
      let sent = 0;
      let failed = 0;
      let skipped = 0;
      while (scanned < batchSize) {
        const claimLimit = Math.min(CLAIM_CHUNK_SIZE, batchSize - scanned);
        const claims = await this.claimDueBatch(new Date(), claimLimit);
        if (claims.length === 0) break;
        scanned += claims.length;
        const outcomes = await this.deliverClaimedBatch(claims);
        for (const result of outcomes) {
          if (result === "sent") sent += 1;
          if (result === "failed") failed += 1;
          if (result === "skipped") skipped += 1;
        }
        if (claims.length < claimLimit) break;
      }
      return { scanned, sent, failed, skipped, recovered };
    } finally {
      this.running = false;
    }
  }

  private deliverDueSafely(): void {
    void this.deliverDue().catch((error) => {
      this.logger.error(`Notification delivery scan failed (${error instanceof Error ? error.name : "unknown_error"})`);
    });
  }

  private async claimDueBatch(now: Date, limit: number): Promise<DeliveryClaim[]> {
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const claims = await db.$queryRaw`
        WITH candidates AS (
          SELECT delivery."id", delivery."nextAttemptAt"
          FROM "NotificationDelivery" AS delivery
          WHERE delivery."status" = 'pending'::"NotificationDeliveryStatus"
            AND delivery."nextAttemptAt" <= ${now}
          ORDER BY delivery."nextAttemptAt" ASC, delivery."id" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        ), claimed AS (
          UPDATE "NotificationDelivery" AS delivery
          SET "status" = 'processing'::"NotificationDeliveryStatus",
              "leaseToken" = ${leaseToken},
              "leaseExpiresAt" = ${leaseExpiresAt},
              "updatedAt" = ${now}
          FROM candidates
          WHERE delivery."id" = candidates."id"
          RETURNING delivery."id", delivery."leaseToken", candidates."nextAttemptAt"
        )
        SELECT claimed."id", claimed."leaseToken"
        FROM claimed
        ORDER BY claimed."nextAttemptAt" ASC, claimed."id" ASC
      `;
      return claims as DeliveryClaim[];
    });
  }

  private async recoverExpiredLeases(now: Date, batchSize: number): Promise<number> {
    let recovered = 0;
    for (let batch = 0; batch < MAX_RECOVERY_BATCHES_PER_RUN; batch += 1) {
      const ids = await this.prisma.$transaction(async (tx) => {
        const db = tx as any;
        const rows = await db.$queryRaw`
          WITH candidates AS (
            SELECT delivery."id", delivery."leaseExpiresAt"
            FROM "NotificationDelivery" AS delivery
            WHERE delivery."status" = 'processing'::"NotificationDeliveryStatus"
              AND (delivery."leaseExpiresAt" IS NULL OR delivery."leaseExpiresAt" <= ${now})
            ORDER BY delivery."leaseExpiresAt" ASC NULLS FIRST, delivery."id" ASC
            FOR UPDATE SKIP LOCKED
            LIMIT ${batchSize}
          ), finalized AS (
            UPDATE "NotificationDelivery" AS delivery
            SET "status" = 'failed'::"NotificationDeliveryStatus",
                "errorCode" = 'LEASE_EXPIRED_UNKNOWN_STATE',
                "lastError" = 'Worker lease expired after an unknown remote delivery state',
                "leaseToken" = NULL,
                "leaseExpiresAt" = NULL,
                "updatedAt" = ${now}
            FROM candidates
            WHERE delivery."id" = candidates."id"
            RETURNING delivery."id", candidates."leaseExpiresAt"
          )
          SELECT finalized."id"
          FROM finalized
          ORDER BY finalized."leaseExpiresAt" ASC NULLS FIRST, finalized."id" ASC
        `;
        return rows as Array<{ id: string }>;
      });
      recovered += ids.length;
      if (ids.length < batchSize) break;
    }
    return recovered;
  }

  private async deliverClaimedBatch(claims: DeliveryClaim[]): Promise<DeliveryResult[]> {
    const results: DeliveryResult[] = [];
    for (let offset = 0; offset < claims.length; offset += PROVIDER_CONCURRENCY) {
      const wave = claims.slice(offset, offset + PROVIDER_CONCURRENCY);
      const outcomes = await Promise.all(wave.map((claim) => this.deliverClaimedSafely(claim)));
      results.push(...outcomes);
    }
    return results;
  }

  private async deliverClaimedSafely(claim: DeliveryClaim): Promise<DeliveryResult> {
    try {
      return await this.deliverClaimed(claim);
    } catch (error) {
      this.logger.error(
        `Claimed notification delivery failed (${error instanceof Error ? error.name : "unknown_error"})`
      );
      return "lost";
    }
  }

  private async deliverClaimed({ id: deliveryId, leaseToken }: DeliveryClaim): Promise<DeliveryResult> {
    const reserved = await this.reserveGrant(deliveryId, leaseToken);
    if (reserved.kind !== "ready") {
      if (reserved.kind === "deferred") return "deferred";
      if (reserved.kind === "failed") {
        this.metrics.recordNotificationDeliveryFailure();
        this.logger.warn(`Notification delivery ${deliveryId} failed before send (unknown template).`);
        return "failed";
      }
      if (reserved.kind === "skipped") {
        this.metrics.recordNotificationDeliverySkipped();
        return "skipped";
      }
      return "lost";
    }

    const outcome = await this.provider.send({
      userId: reserved.userId,
      templateKey: reserved.templateKey,
      templateId: reserved.templateId,
      title: reserved.title,
      body: reserved.body,
      data: reserved.data
    });

    if (outcome.outcome === "sent") {
      const finalized = await this.finish(deliveryId, leaseToken, {
        status: "sent",
        sentAt: new Date(),
        providerMessageId: outcome.providerMessageId ?? null,
        errorCode: null,
        lastError: null
      });
      if (!finalized) return "lost";
      this.metrics.recordNotificationDeliverySuccess();
      return "sent";
    }

    if (outcome.outcome === "retryable" && !outcome.attempted && reserved.attemptCount < MAX_PRE_SEND_RETRIES) {
      await this.releaseGrantAndRetry(deliveryId, leaseToken, reserved.grantId, reserved.attemptCount, outcome);
      return "deferred";
    }

    const terminalStatus = outcome.outcome === "skipped" ? "skipped" : "failed";
    const finalized = await this.finish(deliveryId, leaseToken, {
      status: terminalStatus,
      errorCode: outcome.errorCode ?? (terminalStatus === "skipped" ? "CHANNEL_SKIPPED" : "DELIVERY_FAILED"),
      lastError: outcome.message ?? null
    });
    if (!finalized) return "lost";
    if (terminalStatus === "skipped") {
      this.metrics.recordNotificationDeliverySkipped();
      return "skipped";
    }
    this.metrics.recordNotificationDeliveryFailure();
    this.logger.warn(`Notification delivery ${deliveryId} failed (${outcome.errorCode ?? "unknown"}).`);
    return "failed";
  }

  private async reserveGrant(deliveryId: string, leaseToken: string): Promise<
    | { kind: "ready"; grantId: string; attemptCount: number; userId: string; templateKey: string; templateId: string; title: string; body: string; data: Record<string, unknown> | null }
    | { kind: "deferred" | "failed" | "skipped" | "lost" }
  > {
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const delivery = await db.notificationDelivery.findUnique({
        where: { id: deliveryId },
        include: { notification: true }
      });
      if (!delivery || delivery.status !== "processing" || delivery.leaseToken !== leaseToken) {
        return { kind: "lost" as const };
      }

      // A mute is a private, conversation-scoped preference. Check it while
      // the delivery lease is held and before a one-time WeChat grant is
      // consumed, so a queued external reminder never bypasses a later mute.
      if (delivery.notification.type === "messageReceived") {
        const conversationId = conversationIdFromMessageNotificationEventKey(
          delivery.notification.eventKey,
          delivery.userId
        );
        if (!conversationId) {
          await db.notificationDelivery.updateMany({
            where: { id: deliveryId, status: "processing", leaseToken },
            data: {
              status: "skipped",
              errorCode: "MESSAGE_NOTIFICATION_INVALID",
              lastError: "Message notification is missing a valid recipient-owned conversation key",
              leaseToken: null,
              leaseExpiresAt: null
            }
          });
          return { kind: "skipped" as const };
        }
        // Share the Conversation row lock with block/unblock writes. If the
        // boundary commits first, this delivery observes it before consuming a
        // one-time grant; if delivery has already crossed this point, it has
        // already become an external-send attempt and cannot be unsent.
        if (typeof db.$queryRaw === "function") {
          await db.$queryRaw`SELECT "id" FROM "Conversation" WHERE "id" = ${conversationId} FOR UPDATE`;
        }
        const preference = await db.conversationNotificationPreference.findUnique({
          where: { conversationId_userId: { conversationId, userId: delivery.userId } },
          select: { mutedAt: true }
        });
        if (preference?.mutedAt) {
          await db.notificationDelivery.updateMany({
            where: { id: deliveryId, status: "processing", leaseToken },
            data: {
              status: "skipped",
              errorCode: "CONVERSATION_MUTED",
              lastError: "Recipient muted this conversation before message delivery",
              leaseToken: null,
              leaseExpiresAt: null
            }
          });
          return { kind: "skipped" as const };
        }
        // A relationship boundary is more restrictive than a reminder
        // preference. Recheck it while holding the delivery lease so neither
        // the inbox nor a one-time WeChat grant can deliver after a block.
        const block = await db.conversationBlock.findFirst({
          where: { conversationId },
          select: { id: true }
        });
        if (block) {
          await db.notificationDelivery.updateMany({
            where: { id: deliveryId, status: "processing", leaseToken },
            data: {
              status: "skipped",
              errorCode: "CONVERSATION_BLOCKED",
              lastError: "Conversation interaction ended before message delivery",
              leaseToken: null,
              leaseExpiresAt: null
            }
          });
          return { kind: "skipped" as const };
        }
      }

      const configuredTemplate = (this.config.get<Array<{ key: string; templateId: string }>>("WECHAT_SUBSCRIBE_TEMPLATES") ?? [])
        .find((template) => template.key === delivery.templateKey);
      if (!configuredTemplate) {
        await db.notificationDelivery.updateMany({
          where: { id: deliveryId, status: "processing", leaseToken },
          data: {
            status: "failed",
            errorCode: "UNKNOWN_TEMPLATE",
            lastError: "Configured WeChat template is unavailable",
            leaseToken: null,
            leaseExpiresAt: null
          }
        });
        return { kind: "failed" as const };
      }

      const grants: Array<{ id: string; templateId: string }> = await db.$queryRaw`
        SELECT grant."id", grant."templateId"
        FROM "WeChatSubscriptionGrant" AS grant
        WHERE grant."userId" = ${delivery.userId}
          AND grant."templateKey" = ${delivery.templateKey}
          AND grant."templateId" = ${configuredTemplate.templateId}
          AND grant."consumedAt" IS NULL
          -- A private availability-reminder preference or reservation owns its
          -- exact grant. This generic delivery pool must not steal it between
          -- preference binding, reservation, and final consumption.
          AND NOT EXISTS (
            SELECT 1
            FROM "CompanionFavorite" AS reminder_favorite
            WHERE reminder_favorite."availabilityReminderGrantId" = grant."id"
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "AvailabilityReminderAttempt" AS reminder_attempt
            WHERE reminder_attempt."subscriptionGrantId" = grant."id"
          )
        ORDER BY grant."grantedAt" ASC, grant."id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `;
      const grant = grants[0];
      if (!grant) {
        const isExpired = delivery.createdAt.getTime() + AUTHORIZATION_WAIT_MS <= Date.now();
        await db.notificationDelivery.updateMany({
          where: { id: deliveryId, status: "processing", leaseToken },
          data: isExpired
            ? {
                status: "skipped",
                errorCode: "SUBSCRIPTION_NOT_AUTHORIZED",
                lastError: "No one-time WeChat subscription authorization before delivery deadline",
                leaseToken: null,
                leaseExpiresAt: null
              }
            : {
                status: "pending",
                nextAttemptAt: new Date(Date.now() + NO_GRANT_RECHECK_MS),
                leaseToken: null,
                leaseExpiresAt: null
              }
        });
        return { kind: isExpired ? "skipped" as const : "deferred" as const };
      }

      await db.weChatSubscriptionGrant.update({
        where: { id: grant.id },
        data: { consumedAt: new Date(), consumedByDeliveryId: deliveryId }
      });
      return {
        kind: "ready" as const,
        grantId: grant.id,
        attemptCount: delivery.attemptCount,
        userId: delivery.userId,
        templateKey: delivery.templateKey,
        templateId: grant.templateId,
        title: delivery.notification.title,
        body: delivery.notification.body,
        data: (delivery.notification.data ?? null) as Record<string, unknown> | null
      };
    });
  }

  private async releaseGrantAndRetry(
    deliveryId: string,
    leaseToken: string,
    grantId: string,
    attemptCount: number,
    outcome: { errorCode?: string; message?: string }
  ) {
    const seconds = Math.min(30 * (attemptCount + 1), 5 * 60);
    await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const released = await db.notificationDelivery.updateMany({
        where: { id: deliveryId, status: "processing", leaseToken },
        data: {
          status: "pending",
          attemptCount: { increment: 1 },
          nextAttemptAt: new Date(Date.now() + seconds * 1_000),
          errorCode: outcome.errorCode ?? "PRE_SEND_RETRY",
          lastError: outcome.message ?? null,
          leaseToken: null,
          leaseExpiresAt: null
        }
      });
      if (released.count === 1) {
        await db.weChatSubscriptionGrant.updateMany({
          where: { id: grantId, consumedByDeliveryId: deliveryId },
          data: { consumedAt: null, consumedByDeliveryId: null }
        });
      }
    });
  }

  private async finish(deliveryId: string, leaseToken: string, data: Record<string, unknown>) {
    const finalized = await this.prisma.notificationDelivery.updateMany({
      where: { id: deliveryId, status: "processing", leaseToken },
      data: { ...data, leaseToken: null, leaseExpiresAt: null }
    } as any);
    return finalized.count === 1;
  }

  private normalizeBatchSize(value: number): number {
    if (!Number.isFinite(value)) return 20;
    return Math.min(MAX_DELIVERY_BATCH_SIZE, Math.max(1, Math.floor(value)));
  }
}
