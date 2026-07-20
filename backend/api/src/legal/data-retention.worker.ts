import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AuditService } from "../common/audit/audit.service";
import { PrismaService } from "../database/prisma.service";

const RETENTION_SCAN_INTERVAL_MS = 24 * 60 * 60_000;

/**
 * Enforces the configured ceiling for low-risk operational records. Financial,
 * legal-consent, support, moderation and service evidence are deliberately not
 * deleted here because their statutory schedule must be approved separately.
 */
@Injectable()
export class DataRetentionWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DataRetentionWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService
  ) {}

  onModuleInit() {
    if (this.config.get<string>("NODE_ENV") === "test") return;
    this.timer = setInterval(() => this.runOnceSafely(), RETENTION_SCAN_INTERVAL_MS);
    this.timer.unref?.();
    this.runOnceSafely();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce() {
    if (this.running) return { skipped: true };
    this.running = true;
    try {
      const retentionDays = this.config.get<number>("LEGAL_PRIVACY_RETENTION_DAYS") ?? 1095;
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60_000);
      const tokenCutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000);
      const result = await this.prisma.$transaction(async (tx) => {
        const [notifications, grants, refreshTokens] = await Promise.all([
          tx.notification.deleteMany({ where: { createdAt: { lt: cutoff } } }),
          tx.weChatSubscriptionGrant.deleteMany({ where: { createdAt: { lt: cutoff } } }),
          tx.refreshToken.deleteMany({
            where: {
              expiresAt: { lt: tokenCutoff },
              OR: [{ revokedAt: { not: null } }, { expiresAt: { lt: tokenCutoff } }]
            }
          })
        ]);
        await this.audit.record({
          action: "privacy.retention_cleanup_completed",
          resourceType: "dataRetentionRun",
          metadata: {
            cutoff: cutoff.toISOString(),
            retentionDays,
            deletedNotifications: notifications.count,
            deletedSubscriptionGrants: grants.count,
            deletedRefreshTokens: refreshTokens.count
          }
        }, tx);
        return {
          cutoff: cutoff.toISOString(),
          deletedNotifications: notifications.count,
          deletedSubscriptionGrants: grants.count,
          deletedRefreshTokens: refreshTokens.count
        };
      });
      return { skipped: false, ...result };
    } catch (error) {
      this.logger.error(`Retention cleanup failed (${error instanceof Error ? error.name : "unknown_error"})`);
      throw error;
    } finally {
      this.running = false;
    }
  }

  private runOnceSafely(): void {
    // runOnce already emits the sanitized failure record; consume the scheduled
    // rejection so one transient dependency failure cannot become an unhandled
    // process-level rejection.
    void this.runOnce().catch(() => undefined);
  }
}
