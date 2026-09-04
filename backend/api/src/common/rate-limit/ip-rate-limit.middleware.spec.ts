import { ConfigService } from "@nestjs/config";

import { SecurityCounterService } from "../security-counter/security-counter.service";
import { IpRateLimitMiddleware, clientIp, isWeChatPaymentCallback, shouldFailClosed } from "./ip-rate-limit.middleware";

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
    "/api/v1/review/auth/refresh",
    "/api/v1/orders",
    "/api/v1/orders/ord-1/prepay",
    "/api/v1/orders/ord-1/payment/sync",
    "/api/v1/orders/ord-1/refund",
    "/api/v1/conversations/c-1/media-uploads",
    "/api/v1/support/tickets/t-1/evidence-uploads",
    "/api/v1/attendance-disputes/d-1/evidence-uploads",
    "/api/v1/commercial/companion/incident-evidence-uploads",
    "/api/v1/case-evidence/uploads/a-1/complete"
  ])("protects external sensitive route %s", (originalUrl) => {
    expect(shouldFailClosed({ method: "POST", originalUrl } as any, "production")).toBe(true);
    expect(shouldFailClosed({ method: "POST", originalUrl } as any, "staging")).toBe(true);
  });

  it("keeps health checks available when the counter backend is unavailable", () => {
    expect(shouldFailClosed({ method: "GET", originalUrl: "/api/v1/health" } as any, "production")).toBe(false);
  });

  it("keeps development usable without the counter backend", () => {
    expect(shouldFailClosed({ method: "POST", originalUrl: "/api/v1/auth/refresh" } as any, "development")).toBe(false);
  });
});

describe("isWeChatPaymentCallback", () => {
  it.each([
    "/api/v1/payments/wechat/notify",
    "/api/v1/payments/wechat/refund-notify",
    "/api/v1/payments/wechat/complaints"
  ])("recognizes provider callback %s", (originalUrl) => {
    expect(isWeChatPaymentCallback({ method: "POST", originalUrl } as any)).toBe(true);
  });

  it("does not bypass ordinary payment sync", () => {
    expect(isWeChatPaymentCallback({
      method: "POST",
      originalUrl: "/api/v1/orders/ord-1/payment/sync"
    } as any)).toBe(false);
  });
});

describe("IpRateLimitMiddleware counters", () => {
  it.each([
    ["redis", /^rl:ip:203\.0\.113\.8:\d+$/],
    ["postgres", "rl:ip:203.0.113.8"]
  ] as const)("uses the %s counter key strategy", async (backend, expectedKey) => {
    const increment = jest.fn().mockResolvedValue(1);
    const middleware = new IpRateLimitMiddleware(
      {
        get: jest.fn((key: string) => key === "RATE_LIMIT_PER_MINUTE" ? 120 : "development")
      } as unknown as ConfigService,
      { backend, increment } as unknown as SecurityCounterService
    );
    const next = jest.fn();
    const response = { setHeader: jest.fn() };

    await middleware.use({
      method: "GET",
      originalUrl: "/api/v1/companions",
      ip: "203.0.113.8",
      socket: {}
    } as any, response as any, next);

    expect(increment).toHaveBeenCalledWith(
      typeof expectedKey === "string" ? expectedKey : expect.stringMatching(expectedKey),
      60
    );
    expect(next).toHaveBeenCalledWith();
    expect(response.setHeader).toHaveBeenCalledWith("X-RateLimit-Remaining", "119");
  });

  it("fails closed on sensitive production writes when the selected backend is unavailable", async () => {
    const middleware = new IpRateLimitMiddleware(
      {
        get: jest.fn((key: string, fallback?: unknown) =>
          key === "APP_ENV" ? "production" : fallback
        )
      } as unknown as ConfigService,
      {
        backend: "postgres",
        increment: jest.fn().mockRejectedValue(new Error("database details must stay private"))
      } as unknown as SecurityCounterService
    );
    const next = jest.fn();

    await middleware.use({
      method: "POST",
      originalUrl: "/api/v1/auth/phone/login",
      ip: "203.0.113.8",
      socket: {}
    } as any, { setHeader: jest.fn() } as any, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      code: "RATE_LIMIT_UNAVAILABLE",
      status: 503
    }));
  });
});
