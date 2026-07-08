import { performance } from "node:perf_hooks";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import { Pool } from "pg";

export type DependencyStatus = {
  status: "ok" | "error";
  latencyMs: number;
  message?: string;
};

export type HealthResponse = {
  status: "ok" | "degraded";
  service: "talk-and-talk-api";
  version: string;
  uptimeSeconds: number;
  dependencies: {
    database: DependencyStatus;
    redis: DependencyStatus;
  };
};

@Injectable()
export class HealthService {
  constructor(private readonly config: ConfigService) {}

  async check(): Promise<HealthResponse> {
    const [database, redis] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis()
    ]);
    const healthy = database.status === "ok" && redis.status === "ok";

    return {
      status: healthy ? "ok" : "degraded",
      service: "talk-and-talk-api",
      version: this.config.getOrThrow<string>("APP_VERSION"),
      uptimeSeconds: Math.round(process.uptime()),
      dependencies: {
        database,
        redis
      }
    };
  }

  private async checkDatabase(): Promise<DependencyStatus> {
    const start = performance.now();
    const pool = new Pool({
      connectionString: this.config.getOrThrow<string>("DATABASE_URL"),
      connectionTimeoutMillis: 1200,
      idleTimeoutMillis: 1000,
      max: 1
    });

    try {
      await pool.query("SELECT 1");
      return this.ok(start);
    } catch (error) {
      return this.error(start, error);
    } finally {
      await pool.end().catch(() => undefined);
    }
  }

  private async checkRedis(): Promise<DependencyStatus> {
    const start = performance.now();
    const redis = new Redis(this.config.getOrThrow<string>("REDIS_URL"), {
      connectTimeout: 1200,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: null
    });
    redis.on("error", () => undefined);

    try {
      await redis.connect();
      await redis.ping();
      return this.ok(start);
    } catch (error) {
      return this.error(start, error);
    } finally {
      redis.disconnect();
    }
  }

  private ok(start: number): DependencyStatus {
    return {
      status: "ok",
      latencyMs: this.latency(start)
    };
  }

  private error(start: number, error: unknown): DependencyStatus {
    return {
      status: "error",
      latencyMs: this.latency(start),
      message: error instanceof Error
        ? error.message || error.name || "Dependency check failed"
        : "Dependency check failed"
    };
  }

  private latency(start: number): number {
    return Math.max(0, Math.round(performance.now() - start));
  }
}
