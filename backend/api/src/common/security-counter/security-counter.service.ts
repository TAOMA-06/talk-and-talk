import { createHash } from "node:crypto";

import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

import type { SecurityCounterBackend } from "../../config/configuration";
import { PrismaService } from "../../database/prisma.service";

const MAX_TTL_SECONDS = 7 * 24 * 60 * 60;
const POSTGRES_PRUNE_INTERVAL_MS = 60_000;
const READINESS_TIMEOUT_MS = 1_200;

/**
 * Shared short-lived security state used for rate limits and replay claims.
 * Redis remains the default. PostgreSQL stores only SHA-256 key digests and
 * uses single-statement upserts so multiple API replicas share one counter.
 */
@Injectable()
export class SecurityCounterService implements OnModuleDestroy {
  private redis: Redis | null = null;
  private nextPostgresPruneAt = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService
  ) {}

  get backend(): SecurityCounterBackend {
    return this.config.get<SecurityCounterBackend>("SECURITY_COUNTER_BACKEND", "redis");
  }

  async increment(key: string, ttlSeconds: number): Promise<number> {
    this.assertInput(key, ttlSeconds);
    if (this.backend === "redis") {
      const redis = this.getRedis();
      const value = await redis.incr(key);
      if (value === 1) await redis.expire(key, ttlSeconds);
      return value;
    }

    const keyHash = this.keyHash(key);
    const rows = await this.prisma.$queryRaw<Array<{ value: number }>>`
      INSERT INTO "SecurityCounter" AS counter
        ("keyHash", "value", "expiresAt", "createdAt", "updatedAt")
      VALUES
        (${keyHash}, 1, CURRENT_TIMESTAMP + (${ttlSeconds} * INTERVAL '1 second'), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("keyHash") DO UPDATE SET
        "value" = CASE
          WHEN counter."expiresAt" <= CURRENT_TIMESTAMP THEN 1
          ELSE counter."value" + 1
        END,
        "expiresAt" = CASE
          WHEN counter."expiresAt" <= CURRENT_TIMESTAMP
            THEN CURRENT_TIMESTAMP + (${ttlSeconds} * INTERVAL '1 second')
          ELSE counter."expiresAt"
        END,
        "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "value"
    `;
    this.maybePrunePostgres();
    const value = rows[0]?.value;
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error("PostgreSQL security counter returned an invalid value");
    }
    return value;
  }

  async claim(key: string, ttlSeconds: number): Promise<boolean> {
    this.assertInput(key, ttlSeconds);
    if (this.backend === "redis") {
      const result = await this.getRedis().set(key, "1", "EX", ttlSeconds, "NX");
      return result === "OK";
    }

    const keyHash = this.keyHash(key);
    const rows = await this.prisma.$queryRaw<Array<{ keyHash: string }>>`
      INSERT INTO "SecurityCounter" AS counter
        ("keyHash", "value", "expiresAt", "createdAt", "updatedAt")
      VALUES
        (${keyHash}, 1, CURRENT_TIMESTAMP + (${ttlSeconds} * INTERVAL '1 second'), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("keyHash") DO UPDATE SET
        "value" = 1,
        "expiresAt" = CURRENT_TIMESTAMP + (${ttlSeconds} * INTERVAL '1 second'),
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE counter."expiresAt" <= CURRENT_TIMESTAMP
      RETURNING "keyHash"
    `;
    this.maybePrunePostgres();
    return rows.length === 1;
  }

  async delete(key: string): Promise<void> {
    this.assertKey(key);
    if (this.backend === "redis") {
      await this.getRedis().del(key);
      return;
    }
    const keyHash = this.keyHash(key);
    await this.prisma.$executeRaw`
      DELETE FROM "SecurityCounter" WHERE "keyHash" = ${keyHash}
    `;
  }

  async ping(): Promise<void> {
    if (this.backend === "redis") {
      await this.withTimeout(this.getRedis().ping());
      return;
    }
    // Resolve the relation as well as the database connection so readiness
    // fails if the security-counter migration has not been deployed.
    await this.withTimeout(
      this.prisma.$queryRaw`SELECT 1 FROM "SecurityCounter" LIMIT 0`
    );
    this.maybePrunePostgres();
  }

  onModuleDestroy(): void {
    this.redis?.disconnect();
    this.redis = null;
  }

  private getRedis(): Redis {
    if (!this.redis) {
      this.redis = new Redis(this.config.getOrThrow<string>("REDIS_URL"), {
        maxRetriesPerRequest: 3,
        lazyConnect: true
      });
      this.redis.on("error", () => undefined);
    }
    return this.redis;
  }

  private keyHash(key: string): string {
    return createHash("sha256").update(key).digest("hex");
  }

  private assertInput(key: string, ttlSeconds: number): void {
    this.assertKey(key);
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_TTL_SECONDS) {
      throw new Error(`Security counter TTL must be an integer between 1 and ${MAX_TTL_SECONDS} seconds`);
    }
  }

  private assertKey(key: string): void {
    if (!key || key.length > 512) {
      throw new Error("Security counter key must contain between 1 and 512 characters");
    }
  }

  private maybePrunePostgres(): void {
    const now = Date.now();
    if (now < this.nextPostgresPruneAt) return;
    this.nextPostgresPruneAt = now + POSTGRES_PRUNE_INTERVAL_MS;
    void this.prisma.$executeRaw`
      DELETE FROM "SecurityCounter"
      WHERE "keyHash" IN (
        SELECT "keyHash"
        FROM "SecurityCounter"
        WHERE "expiresAt" <= CURRENT_TIMESTAMP
        ORDER BY "expiresAt", "keyHash"
        LIMIT 10000
      )
    `.catch(() => {
      // Counter operations stay authoritative even if best-effort retention
      // cleanup fails; the next request retries instead of logging DB details.
      this.nextPostgresPruneAt = 0;
    });
  }

  private async withTimeout<T>(operation: Promise<T>): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Security counter dependency check timed out")),
            READINESS_TIMEOUT_MS
          );
        })
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
