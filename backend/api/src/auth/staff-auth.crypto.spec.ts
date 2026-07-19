import { decryptTotpSecret, encryptTotpSecret, matchTotpCounter, normalizeBase32Secret, verifyTotp } from "./staff-auth.crypto";

describe("staff auth cryptography", () => {
  it("encrypts TOTP seeds with authenticated encryption", () => {
    const encrypted = encryptTotpSecret("GEZDGNBVGY3TQOJQ", "a-separate-encryption-key-with-32-characters");
    expect(encrypted).not.toContain("GEZDGNBVGY3TQOJQ");
    expect(decryptTotpSecret(encrypted, "a-separate-encryption-key-with-32-characters"))
      .toBe("GEZDGNBVGY3TQOJQ");
    expect(() => decryptTotpSecret(encrypted, "wrong-but-still-long-encryption-key"))
      .toThrow();
  });

  it("verifies RFC 6238 compatible six-digit codes with a narrow clock window", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(verifyTotp(secret, "287082", 59_000)).toBe(true);
    expect(matchTotpCounter(secret, "287082", 59_000)).toBe(1);
    expect(verifyTotp(secret, "287082", 59_000 + 90_000)).toBe(false);
    expect(verifyTotp(secret, "000000", 59_000)).toBe(false);
  });

  it("rejects weak or malformed Base32 seeds", () => {
    expect(normalizeBase32Secret("GEZD GNBV GY3T QOJQ")).toBe("GEZDGNBVGY3TQOJQ");
    expect(() => normalizeBase32Secret("too-short")).toThrow();
  });
});
