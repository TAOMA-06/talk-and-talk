import { ConfigService } from "@nestjs/config";

import { PrismaService } from "../../database/prisma.service";
import { SecurityCounterService } from "./security-counter.service";

const redis = {
  incr: jest.fn(),
  expire: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  ping: jest.fn(),
  on: jest.fn(),
  disconnect: jest.fn()
};

jest.mock("ioredis", () => jest.fn().mockImplementation(() => redis));

function createService(backend: "redis" | "postgres") {
  const config = {
    get: jest.fn((key: string, fallback?: unknown) =>
      key === "SECURITY_COUNTER_BACKEND" ? backend : fallback
    ),
    getOrThrow: jest.fn(() => "redis://localhost:6379")
  } as unknown as ConfigService;
  const prisma = {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn().mockResolvedValue(0)
  } as unknown as PrismaService;
  return {
    service: new SecurityCounterService(config, prisma),
    prisma: prisma as unknown as { $queryRaw: jest.Mock; $executeRaw: jest.Mock }
  };
}

describe("SecurityCounterService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redis.incr.mockResolvedValue(1);
    redis.expire.mockResolvedValue(1);
    redis.set.mockResolvedValue("OK");
    redis.del.mockResolvedValue(1);
    redis.ping.mockResolvedValue("PONG");
  });

  it("keeps Redis as the default-compatible counter behavior", async () => {
    const { service } = createService("redis");

    await expect(service.increment("rl:ip:127.0.0.1", 60)).resolves.toBe(1);
    await expect(service.claim("staff-totp:staff-1:10", 90)).resolves.toBe(true);
    await service.delete("sms:verify:+8613800138000");

    expect(redis.incr).toHaveBeenCalledWith("rl:ip:127.0.0.1");
    expect(redis.expire).toHaveBeenCalledWith("rl:ip:127.0.0.1", 60);
    expect(redis.set).toHaveBeenCalledWith("staff-totp:staff-1:10", "1", "EX", 90, "NX");
    expect(redis.del).toHaveBeenCalledWith("sms:verify:+8613800138000");
  });

  it("uses atomic PostgreSQL statements and never passes the plaintext key", async () => {
    const { service, prisma } = createService("postgres");
    prisma.$queryRaw
      .mockResolvedValueOnce([{ value: 3 }])
      .mockResolvedValueOnce([{ keyHash: "digest" }]);

    await expect(service.increment("sms:ip:203.0.113.7", 3600)).resolves.toBe(3);
    await expect(service.claim("review-totp:reviewer-1:42", 90)).resolves.toBe(true);

    const serializedCalls = JSON.stringify(prisma.$queryRaw.mock.calls);
    expect(serializedCalls).not.toContain("sms:ip:203.0.113.7");
    expect(serializedCalls).not.toContain("review-totp:reviewer-1:42");
    expect(serializedCalls).toContain("SecurityCounter");
    expect(serializedCalls).toContain("ON CONFLICT");
  });

  it("treats an active PostgreSQL claim as already used", async () => {
    const { service, prisma } = createService("postgres");
    prisma.$queryRaw.mockResolvedValue([]);

    await expect(service.claim("staff-totp:staff-1:10", 90)).resolves.toBe(false);
  });

  it("checks the selected dependency and releases only a created Redis client", async () => {
    const redisService = createService("redis").service;
    await redisService.ping();
    redisService.onModuleDestroy();
    expect(redis.ping).toHaveBeenCalledTimes(1);
    expect(redis.disconnect).toHaveBeenCalledTimes(1);

    const postgres = createService("postgres");
    postgres.prisma.$queryRaw.mockResolvedValue([]);
    await postgres.service.ping();
    postgres.service.onModuleDestroy();
    expect(postgres.prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(redis.disconnect).toHaveBeenCalledTimes(1);
  });
});
