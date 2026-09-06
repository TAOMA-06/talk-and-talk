import { isPartnerChat } from "./partner-preview-access";

describe("partner trial chat", () => {
  const row = { id: "partner-chat-customer-a", userId: "partner-customer-a", companionId: "c1" };
  const base = { APP_ENV: "staging", WEB_GATEWAY_SECRET: "x".repeat(48), PARTNER_ACCESS_CODE_SHA256: "a".repeat(64), PARTNER_ACCESS_EXPIRES_AT: new Date(Date.now() + 60_000).toISOString() };
  const config = (overrides = {}) => ({ get: (key: string, fallback?: unknown) => ({ ...base, ...overrides } as Record<string, unknown>)[key] ?? fallback }) as any;
  it("allows only the named trial conversation in an active protected staging environment", () => {
    expect(isPartnerChat(config(), row)).toBe(true);
    for (const change of [{ id: "other" }, { userId: "another-user" }, { companionId: "c2" }]) expect(isPartnerChat(config(), { ...row, ...change })).toBe(false);
  });
  it("cannot activate a free conversation in production or after invitation expiry", () => {
    expect(isPartnerChat(config({ APP_ENV: "production" }), row)).toBe(false);
    expect(isPartnerChat(config({ PARTNER_ACCESS_EXPIRES_AT: "2000-01-01" }), row)).toBe(false);
    expect(isPartnerChat(config({ WEB_GATEWAY_SECRET: "" }), row)).toBe(false);
  });
});
