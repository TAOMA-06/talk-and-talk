import { createHash } from "node:crypto";
import { AuthService } from "./auth.service";

describe("partner login", () => {
  const code = "partner-test-" + "x".repeat(32);
  function setup(overrides: Record<string, unknown> = {}) {
    const values: Record<string, unknown> = {
      APP_ENV: "staging",
      PARTNER_ACCESS_CODE_SHA256: createHash("sha256").update(code).digest("hex"),
      PARTNER_ACCESS_EXPIRES_AT: new Date(Date.now() + 3_600_000).toISOString(),
      ...overrides
    };
    const prisma = { user: { upsert: jest.fn().mockResolvedValue({ id: "partner-customer-a", role: "user", profile: {} }), findUnique: jest.fn() }, conversation: { upsert: jest.fn().mockResolvedValue({}) } };
    const counters = { increment: jest.fn().mockResolvedValue(1) };
    const service = new AuthService(prisma as any, {} as any,
      { get: (name: string, fallback?: unknown) => values[name] ?? fallback } as any,
      {} as any, { record: jest.fn() } as any, {} as any, counters as any);
    const issue = jest.spyOn(service as any, "issueTokens").mockResolvedValue({ accessToken: "access", refreshToken: "refresh", expiresIn: 900 });
    jest.spyOn(service as any, "recordLoginAudit").mockResolvedValue(undefined);
    return { service, prisma, counters, issue };
  }
  it("is unavailable in production, when unconfigured, or after invitation expiry", async () => {
    for (const override of [{ APP_ENV: "production" }, { PARTNER_ACCESS_CODE_SHA256: "" }, { PARTNER_ACCESS_EXPIRES_AT: "2000-01-01" }]) {
      const { service, prisma } = setup(override);
      await expect(service.loginPartner(code, "customer-a")).rejects.toMatchObject({ code: "PARTNER_ACCESS_CLOSED" });
      expect(prisma.user.upsert).not.toHaveBeenCalled();
    }
  });
  it("does not create users for a wrong access code or arbitrary role", async () => {
    const { service, prisma } = setup();
    await expect(service.loginPartner("wrong", "customer-a")).rejects.toMatchObject({ code: "PARTNER_ACCESS_INVALID" });
    await expect(service.loginPartner(code, "admin" as any)).rejects.toMatchObject({ code: "PARTNER_ACCESS_INVALID" });
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });
  it("uses a bounded shared attempt counter before creating a session", async () => {
    const { service, counters, issue } = setup();
    counters.increment.mockResolvedValue(31);
    await expect(service.loginPartner(code, "customer-a")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(issue).not.toHaveBeenCalled();
  });
  it("issues a normal revocable consumer session for a fixed test persona", async () => {
    const { service, issue } = setup();
    const result = await service.loginPartner(code, "customer-a");
    expect(result.accessToken).toBe("access");
    expect(issue).toHaveBeenCalledWith(expect.objectContaining({ id: "partner-customer-a", role: "user" }), expect.objectContaining({ clientPlatform: "web" }));
  });
  it("never promotes an arbitrary account to companion or staff", async () => {
    const { service, prisma, issue } = setup();
    prisma.user.findUnique.mockResolvedValue({ id: "seed-owner-c1", role: "admin" });
    await expect(service.loginPartner(code, "companion")).rejects.toMatchObject({ code: "PARTNER_ACCOUNT_UNAVAILABLE" });
    expect(issue).not.toHaveBeenCalled();
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });
});
