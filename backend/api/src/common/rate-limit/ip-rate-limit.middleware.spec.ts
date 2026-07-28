import { ConfigService } from "@nestjs/config";

import { IpRateLimitMiddleware, clientIp, shouldFailClosed } from "./ip-rate-limit.middleware";

const disconnect = jest.fn();

jest.mock("ioredis", () => jest.fn().mockImplementation(() => ({
  on: jest.fn(),
  disconnect
})));

describe("clientIp", () => {
  it("uses Express req.ip instead of trusting a client supplied forwarding header", () => {
    const req = {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
      ip: "10.0.0.1",
      socket: { remoteAddress: "10.0.0.1" }
    } as any;
    expect(clientIp(req)).toBe("10.0.0.1");
  });

  it("falls back to req.ip", () => {
    const req = {
      headers: {},
      ip: "9.9.9.9",
      socket: { remoteAddress: "10.0.0.1" }
    } as any;
    expect(clientIp(req)).toBe("9.9.9.9");
  });
});

describe("shouldFailClosed", () => {
  it.each([
    "/api/v1/auth/sms/send-code",
    "/api/v1/auth/phone/login",
    "/api/v1/auth/wechat/mini-program",
    "/api/v1/auth/refresh",
    "/api/v1/review/auth/login",
    "/api/v1/review/auth/refresh"
  ])("protects production authentication route %s", (originalUrl) => {
    expect(shouldFailClosed({ method: "POST", originalUrl } as any, "production")).toBe(true);
  });

  it("keeps health checks available when Redis is unavailable", () => {
    expect(shouldFailClosed({ method: "GET", originalUrl: "/api/v1/health" } as any, "production")).toBe(false);
  });

  it("keeps development usable without Redis", () => {
    expect(shouldFailClosed({ method: "POST", originalUrl: "/api/v1/auth/refresh" } as any, "development")).toBe(false);
  });
});

describe("IpRateLimitMiddleware lifecycle", () => {
  it("disconnects the Redis client during application shutdown", () => {
    const middleware = new IpRateLimitMiddleware({
      getOrThrow: jest.fn().mockReturnValue("redis://localhost:6379")
    } as unknown as ConfigService);

    (middleware as any).getRedis();
    middleware.onModuleDestroy();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
