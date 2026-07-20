import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";

import { PrismaService } from "../database/prisma.service";
import { MetricsService } from "../metrics/metrics.service";
import { WeChatSubscribeMessageProvider } from "./wechat/wechat-subscribe-message.provider";

const LEASE_MS = 2 * 60_000;
const AUTHORIZATION_WAIT_MS = 10 * 60_000;
const NO_GRANT_RECHECK_MS = 30_000;
const MAX_PRE_SEND_RETRIES = 3;

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
    const interval = (this.config.get<number>("NOTIFICATION_DELIVERY_INTERVAL_SECONDS") ?? 30) * 1_000;
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
      const recovered = await this.prisma.notificationDelivery.updateMany({
        where: { status: "processing", leaseExpiresAt: { lte: now } },
        data: {
          status: "failed",
          errorCode: "LEASE_EXPIRED_UNKNOWN_STATE",
          lastError: "Worker lease expired after an unknown remote delivery state",
          leaseToken: null,
          leaseExpiresAt: null
        }
      } as any);
      if (recovered.count > 0) {
        this.metrics.recordNotificationDeliveryFailure();
        this.logger.warn(`Marked ${recovered.count} expired notification lease(s) failed to avoid duplicate delivery.`);
      }

      const batchSize = this.config.get<number>("NOTIFICATION_DELIVERY_BATCH_SIZE") ?? 20;
      const candidates = await this.prisma.notificationDelivery.findMany({
        where: { status: "pending", nextAttemptAt: { lte: now } },
        select: { id: true },
        orderBy: { nextAttemptAt: "asc" },
        take: batchSize
      } as any);
      let sent = 0;
      let failed = 0;
      let skipped = 0;
      for (const candidate of candidates) {
        const result = await this.deliverOne(candidate.id);
        if (result === "sent") sent += 1;
        if (result === "failed") failed += 1;
        if (result === "skipped") skipped += 1;
      }
      return { scanned: candidates.length, sent, failed, skipped, recovered: recovered.count };
    } finally {
      this.running = false;
    }
  }

  private deliverDueSafely(): void {
    void this.deliverDue().catch((error) => {
      this.logger.error(`Notification delivery scan failed (${error instanceof Error ? error.name : "unknown_error"})`);
    });
  }

  private async deliverOne(deliveryId: string): Promise<"sent" | "failed" | "skipped" | "deferred" | "lost"> {
    const leaseToken = randomUUID();
    const now = new Date();
    const claimed = await this.prisma.notificationDelivery.updateMany({
      where: { id: deliveryId, status: "pending", nextAttemptAt: { lte: now } },
      data: {
        status: "processing",
        leaseToken,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS)
      }
    } as any);
    if (claimed.count !== 1) return "lost";

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
        SELECT "id", "templateId"
        FROM "WeChatSubscriptionGrant"
        WHERE "userId" = ${delivery.userId}
          AND "templateKey" = ${delivery.templateKey}
          AND "templateId" = ${configuredTemplate.templateId}
          AND "consumedAt" IS NULL
        ORDER BY "grantedAt" ASC, "id" ASC
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
}
