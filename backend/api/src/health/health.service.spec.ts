import { ConfigService } from "@nestjs/config";

import type { SecurityCounterService } from "../common/security-counter/security-counter.service";
import { HealthService } from "./health.service";

jest.mock("../common/security-counter/security-counter.service", () => ({
  SecurityCounterService: class SecurityCounterService {}
}));
jest.mock("pg", () => ({
  Pool: jest.fn()
}));

const { Pool } = jest.requireMock("pg") as { Pool: jest.Mock };

function counters(backend: "redis" | "postgres" = "redis") {
  return {
    backend,
    ping: jest.fn().mockResolvedValue(undefined)
  } as unknown as SecurityCounterService;
}

function config(appEnv = "staging"): ConfigService {
  return {
    getOrThrow: jest.fn((key: string) => {
      const values: Record<string, string> = {
        APP_VERSION: "9.9.9",
        APP_ENV: appEnv,
        DATABASE_URL: "postgres://test:test@localhost:5432/test",
        REDIS_URL: "redis://localhost:6379"
      };
      return values[key];
    })
  } as unknown as ConfigService;
}

describe("HealthService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("reports slim liveness without probing dependencies", async () => {
    const securityCounters = counters();
    const service = new HealthService(config(), securityCounters);
    const liveness = await service.check();

    expect(liveness).toEqual({
      status: "ok",
      service: "talk-and-talk-api",
      version: "9.9.9"
    });
    expect(Pool).not.toHaveBeenCalled();
    expect(securityCounters.ping).not.toHaveBeenCalled();
  });

  it("keeps liveness ok when a dependency fails and only readiness degrades", async () => {
    Pool.mockImplementation(() => ({
      query: jest.fn().mockRejectedValue(new Error("db offline secret-host")),
      end: jest.fn().mockResolvedValue(undefined)
    }));
    const service = new HealthService(config(), counters());
    const liveness = await service.check();
    const ready = await service.ready();

    expect(liveness.status).toBe("ok");
    expect(liveness).not.toHaveProperty("dependencies");
    expect(ready.status).toBe("degraded");
    expect(ready.dependencies.database.status).toBe("error");
    expect(ready.dependencies.database.message).toBe("Dependency check failed");
    expect(ready.dependencies.securityCounters).toEqual(expect.objectContaining({
      backend: "redis",
      status: "ok"
    }));
    expect(ready.dependencies.redis?.status).toBe("ok");
    expect(JSON.stringify(ready)).not.toContain("secret-host");
  });

  it("does not expose dependency error details in production ready payload", async () => {
    Pool.mockImplementation(() => ({
      query: jest.fn().mockRejectedValue(new Error("password authentication failed for user secret-admin")),
      end: jest.fn().mockResolvedValue(undefined)
    }));
    const result = await new HealthService(config("production"), counters()).ready();

    expect(result.dependencies.database.message).toBe("Dependency check failed");
    expect(JSON.stringify(result)).not.toContain("secret-admin");
  });

  it("requires the PostgreSQL security-counter table but does not report Redis as a dependency", async () => {
    Pool.mockImplementation(() => ({
      query: jest.fn().mockResolvedValue({ rows: [{ one: 1 }] }),
      end: jest.fn().mockResolvedValue(undefined)
    }));
    const securityCounters = counters("postgres");

    const result = await new HealthService(config(), securityCounters).ready();

    expect(securityCounters.ping).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("ok");
    expect(result.dependencies.securityCounters).toEqual(expect.objectContaining({
      backend: "postgres",
      status: "ok"
    }));
    expect(result.dependencies).not.toHaveProperty("redis");
  });
});
