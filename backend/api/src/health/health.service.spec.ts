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

  it("reports ok when database and redis checks pass", async () => {
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

    const result = await new HealthService(config()).check();

    expect(result.status).toBe("ok");
    expect(result.version).toBe("9.9.9");
    expect(result.appEnv).toBe("staging");
    expect(result.dependencies.database.status).toBe("ok");
    expect(result.dependencies.redis.status).toBe("ok");
  });

  it("reports degraded when a dependency fails", async () => {
    Pool.mockImplementation(() => ({
      query: jest.fn().mockRejectedValue(new Error("db offline")),
      end: jest.fn().mockResolvedValue(undefined)
    }));
    Redis.mockImplementation(() => ({
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      ping: jest.fn().mockResolvedValue("PONG"),
      disconnect: jest.fn()
    }));

    const result = await new HealthService(config()).check();

    expect(result.status).toBe("degraded");
    expect(result.dependencies.database.status).toBe("error");
    expect(result.dependencies.database.message).toContain("db offline");
  });

  it("does not expose dependency error details in production", async () => {
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

    const result = await new HealthService(config("production")).check();

    expect(result.dependencies.database.message).toBe("Dependency check failed");
  });
});
