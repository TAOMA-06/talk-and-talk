import { maskPhone, redactSecrets, redactString } from "./redact";

describe("redactSecrets", () => {
  it("masks phone numbers in strings", () => {
    expect(maskPhone("13800138000")).toBe("138****8000");
    expect(redactString("user 13800138000 logged in")).toContain("138****8000");
    expect(redactString("user 13800138000 logged in")).not.toContain("13800138000");
  });

  it("redacts sensitive object keys", () => {
    const result = redactSecrets({
      phone: "13800138000",
      code: "123456",
      accessToken: "eyJhbGciOiJIUzI1NiJ9.aaa.bbb",
      orderId: "o1",
      amountCents: 3900
    });

    expect(result.phone).toBe("138****8000");
    expect(result.code).toBe("[REDACTED]");
    expect(result.accessToken).toBe("[REDACTED]");
    expect(result.orderId).toBe("o1");
    expect(result.amountCents).toBe(3900);
  });

  it("never leaves raw verification code in mock SMS style logs", () => {
    const line = redactString("[MOCK SMS] 13800138000 → 654321");
    expect(line).not.toContain("654321");
    expect(line).not.toMatch(/1[3-9]\d{9}/);
    expect(line).toContain("******");
  });
});
