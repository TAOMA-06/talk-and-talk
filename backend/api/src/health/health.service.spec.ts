import { ConfigService } from "@nestjs/config";

import { HealthService } from "./health.service";

jest.mock("pg", () => ({
  Pool: jest.fn()
}));

jest.mock("ioredis", () => jest.fn());

const { Pool } = jest.requireMock("pg") as { Pool: jest.Mock };
const Redis = jest.requireMock("ioredis") as jest.Mock;

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

  it("reports slim liveness when database and redis checks pass", async () => {
    Pool.mockImplementation(() => ({
      query: jest.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
      end: jest.fn().mockResolvedValue(undefined)
    }));
    Redis.mockImplementation(() => ({
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      ping: jest.fn().mockResolvedValue("PONG"),
      disconnect: jest.fn()
    }));

    const service = new HealthService(config());
    const liveness = await service.check();
    const ready = await service.ready();

    expect(liveness).toEqual({
      status: "ok",
      service: "talk-and-talk-api",
      version: "9.9.9"
    });
    expect(ready.appEnv).toBe("staging");
    expect(ready.dependencies.database.status).toBe("ok");
    expect(ready.dependencies.redis.status).toBe("ok");
  });

  it("reports degraded when a dependency fails without leaking error text", async () => {
    Pool.mockImplementation(() => ({
      query: jest.fn().mockRejectedValue(new Error("db offline secret-host")),
      end: jest.fn().mockResolvedValue(undefined)
    }));
    Redis.mockImplementation(() => ({
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      ping: jest.fn().mockResolvedValue("PONG"),
      disconnect: jest.fn()
    }));

    const service = new HealthService(config());
    const liveness = await service.check();
    const ready = await service.ready();

    expect(liveness.status).toBe("degraded");
    expect(liveness).not.toHaveProperty("dependencies");
    expect(ready.dependencies.database.status).toBe("error");
    expect(ready.dependencies.database.message).toBe("Dependency check failed");
    expect(JSON.stringify(ready)).not.toContain("secret-host");
  });

  it("does not expose dependency error details in production ready payload", async () => {
    Pool.mockImplementation(() => ({
      query: jest.fn().mockRejectedValue(new Error("password authentication failed for user secret-admin")),
      end: jest.fn().mockResolvedValue(undefined)
    }));
    Redis.mockImplementation(() => ({
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      ping: jest.fn().mockResolvedValue("PONG"),
      disconnect: jest.fn()
    }));

    const result = await new HealthService(config("production")).ready();

    expect(result.dependencies.database.message).toBe("Dependency check failed");
    expect(JSON.stringify(result)).not.toContain("secret-admin");
  });
});
