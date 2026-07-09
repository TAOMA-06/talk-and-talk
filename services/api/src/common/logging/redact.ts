const SENSITIVE_KEYS = new Set([
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
  "identityToken",
  "code",
  "verificationCode",
  "apiKey",
  "api_key",
  "secret",
  "privateKey",
  "wechatpay-signature",
  "sign"
]);

const PHONE_RE = /(?:\+?86)?1[3-9]\d{9}/g;
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const CODE_IN_SMS_RE = /→\s*\d{4,8}/g;

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return "***";
  const local = digits.slice(-11);
  if (local.length >= 7) {
    return `${local.slice(0, 3)}****${local.slice(-4)}`;
  }
  return "***";
}

export function redactString(value: string): string {
  return value
    .replace(PHONE_RE, (match) => maskPhone(match))
    .replace(JWT_RE, "[REDACTED_TOKEN]")
    .replace(CODE_IN_SMS_RE, "→ ******");
}

export function redactSecrets<T>(value: T): T {
  if (value == null) {
    return value;
  }

  if (typeof value === "string") {
    return redactString(value) as T;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item)) as T;
  }

  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(input)) {
      if (SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(key.toLowerCase())) {
        output[key] = "[REDACTED]";
        continue;
      }
      if (key.toLowerCase().includes("phone") && typeof nested === "string") {
        output[key] = maskPhone(nested);
        continue;
      }
      if (key.toLowerCase().includes("token") || key.toLowerCase().includes("secret")) {
        output[key] = "[REDACTED]";
        continue;
      }
      output[key] = redactSecrets(nested);
    }
    return output as T;
  }

  return value;
}
