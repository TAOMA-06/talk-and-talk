type NodeEnv = "development" | "test" | "production";
type AppEnv = "development" | "staging" | "production";

interface Environment {
  NODE_ENV: NodeEnv;
  APP_ENV: AppEnv;
  HOST: string;
  PORT: number;
  API_PREFIX: string;
  APP_VERSION: string;
  DATABASE_URL: string;
  REDIS_URL: string;
  CORS_ORIGINS: string[];
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  JWT_ACCESS_TTL: string;
  JWT_REFRESH_TTL: string;
  SMS_CODE_TTL_SECONDS: number;
  DEEPSEEK_API_KEY: string;
  DEEPSEEK_URL: string;
  DEEPSEEK_MODEL: string;
  WECHAT_PAY_APP_ID: string;
  WECHAT_PAY_MCH_ID: string;
  WECHAT_PAY_API_V3_KEY: string;
  WECHAT_PAY_PRIVATE_KEY: string;
  WECHAT_PAY_PRIVATE_KEY_PATH: string;
  WECHAT_PAY_CERT_SERIAL_NO: string;
  WECHAT_PAY_NOTIFY_BASE_URL: string;
  WECHAT_MINIPROGRAM_APP_ID: string;
  WECHAT_MINIPROGRAM_APP_SECRET: string;
  APPLE_SIGN_IN_BUNDLE_ID: string;
  SMS_PROVIDER: string;
  STAFF_TOTP_ENCRYPTION_KEY: string;
  RATE_LIMIT_PER_MINUTE: number;
  BODY_SIZE_LIMIT: string;
  SEED_ON_STARTUP: boolean;
  METRICS_TOKEN: string;
  LEGAL_CONSENT_VERSION: string;
  LEGAL_PRIVACY_URL: string;
  LEGAL_TERMS_URL: string;
}

const DEFAULT_DATABASE_URL = "postgres://talk:talk@localhost:5432/talk_and_talk";
const DEFAULT_REDIS_URL = "redis://localhost:6379";
const DEFAULT_DEEPSEEK_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
const DEFAULT_LEGAL_CONSENT_VERSION = "1.0-2026-07-19";
const DEFAULT_LEGAL_PRIVACY_URL = "https://api.talkandtalk.app/legal/privacy.html";
const DEFAULT_LEGAL_TERMS_URL = "https://api.talkandtalk.app/legal/terms.html";
const DEFAULT_DEVELOPMENT_CORS_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8080",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:8080",
  "http://[::1]:3000",
  "http://[::1]:5173",
  "http://[::1]:8080"
];

function parsePort(value: string | undefined): number {
  const port = Number(value ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

function parseHost(value: string | undefined, appEnv: AppEnv): string {
  const host = value?.trim() || (appEnv === "development" ? "127.0.0.1" : "0.0.0.0");
  if (!["127.0.0.1", "::1", "0.0.0.0", "::"].includes(host)) {
    throw new Error("HOST must be one of: 127.0.0.1, ::1, 0.0.0.0, ::");
  }
  if (appEnv === "production" && (host === "127.0.0.1" || host === "::1")) {
    throw new Error("HOST must bind all interfaces in production");
  }
  return host;
}

function parseNodeEnv(value: string | undefined): NodeEnv {
  const nodeEnv = value ?? "development";
  if (nodeEnv === "development" || nodeEnv === "test" || nodeEnv === "production") {
    return nodeEnv;
  }
  throw new Error("NODE_ENV must be development, test, or production");
}

function parseAppEnv(value: string | undefined, nodeEnv: NodeEnv): AppEnv {
  const appEnv = value?.trim();
  if (appEnv === "development" || appEnv === "staging" || appEnv === "production") {
    return appEnv;
  }
  if (nodeEnv === "test") {
    return "development";
  }
  if (nodeEnv === "production") {
    return "production";
  }
  return "development";
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid boolean value: ${value}`);
}

function requiredUrl(name: string, value: string | undefined, fallback: string): string {
  const candidate = value?.trim() || fallback;
  try {
    new URL(candidate);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  return candidate;
}

function requiredProtocolUrl(
  name: string,
  value: string | undefined,
  fallback: string,
  protocols: string[]
): string {
  const candidate = requiredUrl(name, value, fallback);
  const protocol = new URL(candidate).protocol;
  if (!protocols.includes(protocol)) {
    throw new Error(`${name} must use one of these protocols: ${protocols.join(", ")}`);
  }
  return candidate;
}

function positiveInteger(name: string, value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function optionalUrl(value: string | undefined): string {
  const candidate = value?.trim() ?? "";
  if (!candidate) {
    return "";
  }
  try {
    new URL(candidate);
  } catch {
    throw new Error("WECHAT_PAY_NOTIFY_BASE_URL must be a valid URL when set");
  }
  return candidate.replace(/\/+$/, "");
}

function optionalString(value: string | undefined): string {
  return value?.trim() ?? "";
}

function isUnsafePlaceholder(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.includes("change_me") ||
    normalized.includes("change-me") ||
    normalized.includes("changeme") ||
    normalized.includes("replace_me") ||
    normalized.includes("replace-me") ||
    normalized.includes("example_secret") ||
    normalized.includes("example-secret") ||
    normalized === "default" ||
    normalized.startsWith("dev-access-secret") ||
    normalized.startsWith("dev-refresh-secret")
  );
}

function assertProductionValue(name: string, value: string): void {
  if (isUnsafePlaceholder(value)) {
    throw new Error(`${name} must not use a placeholder value in production`);
  }
}

function parseCorsOrigins(value: string | undefined, nodeEnv: NodeEnv, appEnv: AppEnv): string[] {
  const rawOrigins = value
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean) ?? [];

  if (rawOrigins.length > 0) {
    return [...new Set(rawOrigins)];
  }

  if (nodeEnv === "production" || appEnv === "production") {
    throw new Error("CORS_ORIGINS must be explicitly configured in production");
  }

  return DEFAULT_DEVELOPMENT_CORS_ORIGINS;
}

function defaultSmsProvider(appEnv: AppEnv): string {
  if (appEnv === "production") {
    return "none";
  }
  return "mock";
}

export function validateEnvironment(raw: Record<string, unknown>): Environment {
  const env = raw as Record<string, string | undefined>;
  const nodeEnv = parseNodeEnv(env.NODE_ENV);
  const appEnv = parseAppEnv(env.APP_ENV, nodeEnv);
  const apiPrefix = env.API_PREFIX?.trim() || "api/v1";
  const corsOrigins = parseCorsOrigins(env.CORS_ORIGINS, nodeEnv, appEnv);

  const jwtAccessSecret = env.JWT_ACCESS_SECRET?.trim() || (nodeEnv === "production" ? "" : "dev-access-secret");
  const jwtRefreshSecret = env.JWT_REFRESH_SECRET?.trim() || (nodeEnv === "production" ? "" : "dev-refresh-secret");

  if ((nodeEnv === "production" || appEnv === "production") && (!jwtAccessSecret || !jwtRefreshSecret)) {
    throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set in production");
  }
  if (appEnv === "production" && (jwtAccessSecret.length < 32 || jwtRefreshSecret.length < 32)) {
    throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must each contain at least 32 characters in production");
  }
  if (appEnv === "production" && jwtAccessSecret === jwtRefreshSecret) {
    throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different in production");
  }

  const metricsToken = optionalString(env.METRICS_TOKEN);
  if (appEnv === "production" && metricsToken.length < 32) {
    throw new Error("METRICS_TOKEN must contain at least 32 characters in production");
  }
  if (appEnv === "production" && (!env.DATABASE_URL?.trim() || !env.REDIS_URL?.trim())) {
    throw new Error("DATABASE_URL and REDIS_URL must be explicitly configured in production");
  }
  if (appEnv === "production") {
    assertProductionValue("JWT_ACCESS_SECRET", jwtAccessSecret);
    assertProductionValue("JWT_REFRESH_SECRET", jwtRefreshSecret);
    assertProductionValue("METRICS_TOKEN", metricsToken);
    assertProductionValue("DATABASE_URL", env.DATABASE_URL!.trim());
    assertProductionValue("REDIS_URL", env.REDIS_URL!.trim());
  }

  const smsProvider = env.SMS_PROVIDER?.trim() || defaultSmsProvider(appEnv);
  if (appEnv === "production" && smsProvider === "mock") {
    throw new Error("SMS_PROVIDER=mock is not allowed when APP_ENV=production");
  }
  const staffTotpEncryptionKey = optionalString(env.STAFF_TOTP_ENCRYPTION_KEY) ||
    (appEnv === "production" ? "" : "development-staff-totp-key-not-for-production");
  if (appEnv === "production") {
    if (staffTotpEncryptionKey.length < 32) {
      throw new Error("STAFF_TOTP_ENCRYPTION_KEY must contain at least 32 characters in production");
    }
    assertProductionValue("STAFF_TOTP_ENCRYPTION_KEY", staffTotpEncryptionKey);
  }
  const seedOnStartup = parseBoolean(env.SEED_ON_STARTUP, appEnv === "staging");
  if (appEnv === "production" && seedOnStartup) {
    throw new Error("SEED_ON_STARTUP is not allowed when APP_ENV=production");
  }

  const miniProgramAppId = optionalString(env.WECHAT_MINIPROGRAM_APP_ID);
  const miniProgramAppSecret = optionalString(env.WECHAT_MINIPROGRAM_APP_SECRET);
  if (Boolean(miniProgramAppId) !== Boolean(miniProgramAppSecret)) {
    throw new Error("WECHAT_MINIPROGRAM_APP_ID and WECHAT_MINIPROGRAM_APP_SECRET must be configured together");
  }

  const wechatPayMchId = optionalString(env.WECHAT_PAY_MCH_ID);
  const wechatPayApiV3Key = optionalString(env.WECHAT_PAY_API_V3_KEY);
  const wechatPayPrivateKey = optionalString(env.WECHAT_PAY_PRIVATE_KEY);
  const wechatPayPrivateKeyPath = optionalString(env.WECHAT_PAY_PRIVATE_KEY_PATH);
  const wechatPayCertSerialNo = optionalString(env.WECHAT_PAY_CERT_SERIAL_NO);
  const wechatPayNotifyBaseUrl = optionalUrl(env.WECHAT_PAY_NOTIFY_BASE_URL);

  if (appEnv === "production") {
    const requiredMiniProgramPaymentConfig = {
      WECHAT_PAY_APP_ID: optionalString(env.WECHAT_PAY_APP_ID),
      WECHAT_MINIPROGRAM_APP_ID: miniProgramAppId,
      WECHAT_MINIPROGRAM_APP_SECRET: miniProgramAppSecret,
      WECHAT_PAY_MCH_ID: wechatPayMchId,
      WECHAT_PAY_API_V3_KEY: wechatPayApiV3Key,
      WECHAT_PAY_CERT_SERIAL_NO: wechatPayCertSerialNo,
      WECHAT_PAY_NOTIFY_BASE_URL: wechatPayNotifyBaseUrl
    };
    const missing = Object.entries(requiredMiniProgramPaymentConfig)
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length > 0) {
      throw new Error(`Mini Program production payment configuration is missing: ${missing.join(", ")}`);
    }
    if (!wechatPayPrivateKey && !wechatPayPrivateKeyPath) {
      throw new Error("Mini Program production payment configuration is missing: WECHAT_PAY_PRIVATE_KEY or WECHAT_PAY_PRIVATE_KEY_PATH");
    }
    if (wechatPayApiV3Key.length !== 32) {
      throw new Error("WECHAT_PAY_API_V3_KEY must be exactly 32 characters in production");
    }
    if (new URL(wechatPayNotifyBaseUrl).protocol !== "https:") {
      throw new Error("WECHAT_PAY_NOTIFY_BASE_URL must be an absolute HTTPS URL in production");
    }
    assertProductionValue("WECHAT_MINIPROGRAM_APP_SECRET", miniProgramAppSecret);
    assertProductionValue("WECHAT_PAY_API_V3_KEY", wechatPayApiV3Key);
  }

  const legalConsentVersion = env.LEGAL_CONSENT_VERSION?.trim() || DEFAULT_LEGAL_CONSENT_VERSION;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(legalConsentVersion)) {
    throw new Error("LEGAL_CONSENT_VERSION must be a valid document version");
  }
  const legalPrivacyUrl = requiredProtocolUrl(
    "LEGAL_PRIVACY_URL",
    env.LEGAL_PRIVACY_URL,
    DEFAULT_LEGAL_PRIVACY_URL,
    ["https:"]
  );
  const legalTermsUrl = requiredProtocolUrl(
    "LEGAL_TERMS_URL",
    env.LEGAL_TERMS_URL,
    DEFAULT_LEGAL_TERMS_URL,
    ["https:"]
  );

  return {
    NODE_ENV: nodeEnv,
    APP_ENV: appEnv,
    HOST: parseHost(env.HOST, appEnv),
    PORT: parsePort(env.PORT),
    API_PREFIX: apiPrefix.replace(/^\/+|\/+$/g, ""),
    APP_VERSION: env.APP_VERSION?.trim() || "0.1.0",
    DATABASE_URL: requiredProtocolUrl(
      "DATABASE_URL",
      env.DATABASE_URL,
      DEFAULT_DATABASE_URL,
      ["postgres:", "postgresql:"]
    ),
    REDIS_URL: requiredProtocolUrl("REDIS_URL", env.REDIS_URL, DEFAULT_REDIS_URL, ["redis:", "rediss:"]),
    CORS_ORIGINS: corsOrigins,
    JWT_ACCESS_SECRET: jwtAccessSecret,
    JWT_REFRESH_SECRET: jwtRefreshSecret,
    JWT_ACCESS_TTL: env.JWT_ACCESS_TTL?.trim() || "15m",
    JWT_REFRESH_TTL: env.JWT_REFRESH_TTL?.trim() || "30d",
    SMS_CODE_TTL_SECONDS: positiveInteger("SMS_CODE_TTL_SECONDS", env.SMS_CODE_TTL_SECONDS, 300),
    DEEPSEEK_API_KEY: optionalString(env.DEEPSEEK_API_KEY),
    DEEPSEEK_URL: requiredUrl("DEEPSEEK_URL", env.DEEPSEEK_URL, DEFAULT_DEEPSEEK_URL),
    DEEPSEEK_MODEL: env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL,
    WECHAT_PAY_APP_ID: optionalString(env.WECHAT_PAY_APP_ID),
    WECHAT_PAY_MCH_ID: wechatPayMchId,
    WECHAT_PAY_API_V3_KEY: wechatPayApiV3Key,
    WECHAT_PAY_PRIVATE_KEY: wechatPayPrivateKey,
    WECHAT_PAY_PRIVATE_KEY_PATH: wechatPayPrivateKeyPath,
    WECHAT_PAY_CERT_SERIAL_NO: wechatPayCertSerialNo,
    WECHAT_PAY_NOTIFY_BASE_URL: wechatPayNotifyBaseUrl,
    WECHAT_MINIPROGRAM_APP_ID: miniProgramAppId,
    WECHAT_MINIPROGRAM_APP_SECRET: miniProgramAppSecret,
    APPLE_SIGN_IN_BUNDLE_ID: optionalString(env.APPLE_SIGN_IN_BUNDLE_ID),
    SMS_PROVIDER: smsProvider,
    STAFF_TOTP_ENCRYPTION_KEY: staffTotpEncryptionKey,
    RATE_LIMIT_PER_MINUTE: positiveInteger("RATE_LIMIT_PER_MINUTE", env.RATE_LIMIT_PER_MINUTE, 120),
    BODY_SIZE_LIMIT: env.BODY_SIZE_LIMIT?.trim() || "1mb",
    SEED_ON_STARTUP: seedOnStartup,
    METRICS_TOKEN: metricsToken,
    LEGAL_CONSENT_VERSION: legalConsentVersion,
    LEGAL_PRIVACY_URL: legalPrivacyUrl,
    LEGAL_TERMS_URL: legalTermsUrl
  };
}

export const configuration = () => validateEnvironment(process.env);
