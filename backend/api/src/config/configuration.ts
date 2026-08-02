import transactionalTemplateManifest = require("../../config/transactional-template-manifest.js");

type NodeEnv = "development" | "test" | "production";
type AppEnv = "development" | "staging" | "production";
type CommercialReleaseMode = "internal" | "paidPilot" | "commercial";

export type WeChatSubscribeTemplate = {
  key: string;
  templateId: string;
  page?: string;
  data: Record<string, string>;
};

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
  AUTH_IDENTITY_TOMBSTONE_HMAC_KEYS: string;
  AUTH_IDENTITY_TOMBSTONE_ACTIVE_KEY_ID: string;
  AUTH_IDENTITY_REREGISTRATION_POLICY: "after_tombstone_expiry";
  REVIEW_JWT_ACCESS_SECRET: string;
  REVIEW_JWT_REFRESH_SECRET: string;
  REVIEW_JWT_ACCESS_TTL: string;
  REVIEW_JWT_REFRESH_TTL: string;
  SMS_CODE_TTL_SECONDS: number;
  EXTERNAL_AI_USER_CONTENT_ENABLED: boolean;
  MEDIA_FEATURE_ENABLED: boolean;
  MEDIA_PROVIDER: string;
  TRTC_ENABLED: boolean;
  TRTC_SDK_APP_ID: number;
  TRTC_SDK_SECRET_KEY: string;
  TRTC_CALLBACK_SIGNING_KEY: string;
  TRTC_PRIVATE_MAP_KEY_ENABLED: boolean;
  TRTC_USER_SIG_TTL_SECONDS: number;
  TRTC_PRIVACY_DISCLOSURE_APPROVED: boolean;
  TRTC_PRIVACY_DISCLOSURE_REFERENCE: string;
  TRTC_ROOM_CONTROL_ENABLED: boolean;
  TRTC_EMERGENCY_STOP_ENABLED: boolean;
  TRTC_CONTROL_REGION: "ap-beijing" | "ap-guangzhou";
  TRTC_CONTROL_TIMEOUT_MS: number;
  TRTC_ROOM_CONTROL_INTERVAL_SECONDS: number;
  TRTC_ROOM_CONTROL_BATCH_SIZE: number;
  TENCENTCLOUD_SECRET_ID: string;
  TENCENTCLOUD_SECRET_KEY: string;
  TENCENTCLOUD_SECURITY_TOKEN: string;
  WECHAT_PAY_APP_ID: string;
  WECHAT_PAY_MCH_ID: string;
  WECHAT_PAY_API_V3_KEY: string;
  WECHAT_PAY_PRIVATE_KEY: string;
  WECHAT_PAY_PRIVATE_KEY_PATH: string;
  WECHAT_PAY_CERT_SERIAL_NO: string;
  WECHAT_PAY_NOTIFY_BASE_URL: string;
  WECHAT_PAY_COMPLAINTS_ENABLED: boolean;
  WECHAT_PAY_COMPLAINT_POLL_INTERVAL_SECONDS: number;
  WECHAT_PAY_COMPLAINT_BATCH_SIZE: number;
  WECHAT_MINIPROGRAM_APP_ID: string;
  WECHAT_MINIPROGRAM_APP_SECRET: string;
  APPLE_SIGN_IN_BUNDLE_ID: string;
  SMS_PROVIDER: string;
  STAFF_TOTP_ENCRYPTION_KEY: string;
  REVIEW_TOTP_ENCRYPTION_KEY: string;
  RATE_LIMIT_PER_MINUTE: number;
  BODY_SIZE_LIMIT: string;
  SEED_ON_STARTUP: boolean;
  PAYMENT_RECONCILIATION_ENABLED: boolean;
  PAYMENT_RECONCILIATION_INTERVAL_SECONDS: number;
  PAYMENT_RECONCILIATION_BATCH_SIZE: number;
  WECHAT_DAILY_BILL_RECONCILIATION_ENABLED: boolean;
  WECHAT_DAILY_BILL_RECONCILIATION_APPROVED: boolean;
  WECHAT_DAILY_BILL_RECONCILIATION_APPROVAL_REFERENCE: string;
  WECHAT_DAILY_BILL_RECONCILIATION_START_DATE: string;
  WECHAT_DAILY_BILL_RECONCILIATION_HOUR: number;
  WECHAT_DAILY_BILL_RECONCILIATION_BATCH_SIZE: number;
  ORDER_RESCHEDULE_EXPIRY_ENABLED: boolean;
  ORDER_RESCHEDULE_EXPIRY_INTERVAL_SECONDS: number;
  ORDER_RESCHEDULE_EXPIRY_BATCH_SIZE: number;
  METRICS_TOKEN: string;
  MOCK_WECHAT_NOTIFY_SECRET: string;
  LEGAL_CONSENT_VERSION: string;
  LEGAL_CONSENT_EFFECTIVE_DATE: string;
  LEGAL_PRIVACY_URL: string;
  LEGAL_TERMS_URL: string;
  LEGAL_PLATFORM_RULES_URL: string;
  LEGAL_OPERATOR_NAME: string;
  LEGAL_CONTACT_EMAIL: string;
  LEGAL_CONTACT_PHONE: string;
  LEGAL_COMPLAINT_CHANNEL: string;
  LEGAL_PRIVACY_RETENTION_DAYS: number;
  ACCOUNT_DELETION_RETENTION_POLICY_APPROVED: boolean;
  ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE: string;
  ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_APPROVED: boolean;
  ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_VERSION: string;
  ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_APPROVAL_REFERENCE: string;
  ACCOUNT_DATA_RETENTION_LEGAL_HOLD_REASON_CODES_JSON: string;
  CRISIS_RESOURCES_APPROVED: boolean;
  CRISIS_RESOURCES_APPROVAL_REFERENCE: string;
  COMMERCIAL_RELEASE_MODE: CommercialReleaseMode;
  COMPANION_VOICE_EVIDENCE_VIEWER_URL: string;
  COMPANION_VOICE_EVIDENCE_SIGNING_SECRET: string;
  COMPANION_VOICE_EVIDENCE_URL_TTL_SECONDS: number;
  PLATFORM_FEE_BPS: number;
  COMPANION_SETTLEMENT_HOLD_HOURS: number;
  REFUND_POLICY_VERSION: string;
  REFUND_POLICY_APPROVED: boolean;
  REFUND_POLICY_APPROVAL_REFERENCE: string;
  REFUND_REQUEST_WINDOW_HOURS: number;
  REFUND_REVIEW_SLA_HOURS: number;
  REFUND_RESOLUTION_SLA_HOURS: number;
  ORDER_RESPONSE_WINDOW_MINUTES: number;
  ORDER_CHAT_PRE_SERVICE_WINDOW_MINUTES: number;
  ORDER_CHAT_POST_SERVICE_WINDOW_MINUTES: number;
  ORDER_RESCHEDULE_RESPONSE_WINDOW_MINUTES: number;
  ORDER_MAX_SCHEDULE_DAYS: number;
  ORDER_INTAKE_ENABLED: boolean;
  ORDER_MAX_OPEN_TOTAL: number;
  ORDER_MAX_OPEN_PER_USER: number;
  ORDER_MAX_PENDING_PER_COMPANION: number;
  PAYOUT_CLAIMS_ENABLED: boolean;
  SUPPORT_RESPONSE_HOURS: number;
  SUPPORT_MAX_OPEN_PER_USER: number;
  SUPPORT_PUBLIC_SERVICE_HOURS: string;
  SUPPORT_PUBLIC_STATUS_URL: string;
  DATA_EXPORT_DELIVERY_BASE_URL: string;
  DATA_EXPORT_DELIVERY_API_KEY: string;
  DATA_EXPORT_DELIVERY_TIMEOUT_MS: number;
  DATA_EXPORT_MAX_BYTES: number;
  COMPANION_APPEAL_SUBMISSION_DAYS: number;
  COMPANION_APPEAL_RESPONSE_HOURS: number;
  NOTIFICATION_DELIVERY_ENABLED: boolean;
  NOTIFICATION_DELIVERY_INTERVAL_SECONDS: number;
  NOTIFICATION_DELIVERY_BATCH_SIZE: number;
  AVAILABILITY_REMINDER_PREPARATION_ENABLED: boolean;
  AVAILABILITY_REMINDER_PREPARATION_INTERVAL_SECONDS: number;
  AVAILABILITY_REMINDER_PREPARATION_BATCH_SIZE: number;
  AVAILABILITY_REMINDER_FANOUT_BATCH_SIZE: number;
  AVAILABILITY_REMINDER_FANOUT_BATCHES_PER_RUN: number;
  AVAILABILITY_REMINDER_FANOUT_LEASE_SECONDS: number;
  AVAILABILITY_REMINDER_FANOUT_MAX_FAILURES: number;
  AVAILABILITY_REMINDER_FANOUT_RETRY_BASE_SECONDS: number;
  AVAILABILITY_REMINDER_DELIVERY_ENABLED: boolean;
  AVAILABILITY_REMINDER_DELIVERY_INTERVAL_SECONDS: number;
  AVAILABILITY_REMINDER_DELIVERY_BATCH_SIZE: number;
  WECHAT_SUBSCRIBE_MESSAGES_ENABLED: boolean;
  WECHAT_SUBSCRIBE_TEMPLATES: WeChatSubscribeTemplate[];
}

const DEFAULT_DATABASE_URL = "postgres://talk:talk@localhost:5432/talk_and_talk";
const DEFAULT_REDIS_URL = "redis://localhost:6379";
const DEFAULT_LEGAL_CONSENT_VERSION = "2.2-2026-08-01";
const DEFAULT_LEGAL_CONSENT_EFFECTIVE_DATE = "2026-08-01";
// Retain these stable public URLs for existing Mini Program consent receipts;
// the static documents redirect to the server-rendered, configuration-backed
// legal endpoints below.
const DEFAULT_LEGAL_PRIVACY_URL = "https://api.talkandtalk.app/legal/privacy.html";
const DEFAULT_LEGAL_TERMS_URL = "https://api.talkandtalk.app/legal/terms.html";
const DEFAULT_LEGAL_PLATFORM_RULES_URL = "https://api.talkandtalk.app/api/v1/legal/platform-rules";
const DEVELOPMENT_OPERATOR_NAME = "Talk&Talk 开发环境运营方（不可用于对外发布）";
const JWT_ACCESS_TTL_MIN_MS = 5 * 60_000;
const JWT_ACCESS_TTL_MAX_MS = 60 * 60_000;
const JWT_REFRESH_TTL_MIN_MS = 60 * 60_000;
const JWT_REFRESH_TTL_MAX_MS = 90 * 24 * 60 * 60_000;
const JWT_TTL_MULTIPLIERS = {
  s: 1_000,
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000
} as const;
const REQUIRED_TRANSACTIONAL_TEMPLATE_KEYS = transactionalTemplateManifest.map(({ key }) => key);
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

function boundedInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
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

export function parseJwtTtlToMs(name: string, value: string): number {
  const match = value.match(/^([1-9]\d*)(s|m|h|d)$/);
  if (!match) {
    throw new Error(`${name} must use a positive integer followed by s, m, h, or d (for example 15m)`);
  }
  const amount = Number(match[1]);
  const ttlMs = amount * JWT_TTL_MULTIPLIERS[match[2] as keyof typeof JWT_TTL_MULTIPLIERS];
  if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(ttlMs)) {
    throw new Error(`${name} is too large`);
  }
  return ttlMs;
}

export function validateConsumerJwtTtls(
  accessValue: string | undefined,
  refreshValue: string | undefined
): { accessTtl: string; refreshTtl: string; accessTtlMs: number; refreshTtlMs: number } {
  const accessTtl = accessValue?.trim() || "15m";
  const refreshTtl = refreshValue?.trim() || "30d";
  const accessTtlMs = parseJwtTtlToMs("JWT_ACCESS_TTL", accessTtl);
  const refreshTtlMs = parseJwtTtlToMs("JWT_REFRESH_TTL", refreshTtl);

  if (accessTtlMs < JWT_ACCESS_TTL_MIN_MS || accessTtlMs > JWT_ACCESS_TTL_MAX_MS) {
    throw new Error("JWT_ACCESS_TTL must be between 5 minutes and 1 hour");
  }
  if (refreshTtlMs < JWT_REFRESH_TTL_MIN_MS || refreshTtlMs > JWT_REFRESH_TTL_MAX_MS) {
    throw new Error("JWT_REFRESH_TTL must be between 1 hour and 90 days");
  }
  if (refreshTtlMs <= accessTtlMs) {
    throw new Error("JWT_REFRESH_TTL must be greater than JWT_ACCESS_TTL");
  }

  return { accessTtl, refreshTtl, accessTtlMs, refreshTtlMs };
}

function parseCommercialReleaseMode(value: string | undefined): CommercialReleaseMode {
  const mode = value?.trim() || "internal";
  if (mode === "internal" || mode === "paidPilot" || mode === "commercial") return mode;
  throw new Error("COMMERCIAL_RELEASE_MODE must be internal, paidPilot or commercial");
}

function parseWeChatSubscribeTemplates(value: string | undefined, enabled: boolean): WeChatSubscribeTemplate[] {
  const source = optionalString(value);
  if (!source) {
    if (enabled) {
      throw new Error("WECHAT_SUBSCRIBE_TEMPLATES_JSON is required when WECHAT_SUBSCRIBE_MESSAGES_ENABLED=true");
    }
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("WECHAT_SUBSCRIBE_TEMPLATES_JSON must be valid JSON");
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 20) {
    throw new Error("WECHAT_SUBSCRIBE_TEMPLATES_JSON must be a non-empty array with at most 20 templates");
  }

  const keys = new Set<string>();
  const templateIds = new Set<string>();
  return parsed.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`WECHAT_SUBSCRIBE_TEMPLATES_JSON[${index}] must be an object`);
    }
    const candidate = item as Record<string, unknown>;
    const key = typeof candidate.key === "string" ? candidate.key.trim() : "";
    const templateId = typeof candidate.templateId === "string" ? candidate.templateId.trim() : "";
    const page = typeof candidate.page === "string" ? candidate.page.trim() : "";
    const data = candidate.data;
    if (!/^[A-Za-z][A-Za-z0-9_-]{1,63}$/.test(key) || keys.has(key)) {
      throw new Error(`WECHAT_SUBSCRIBE_TEMPLATES_JSON[${index}].key must be unique and use letters, digits, _ or -`);
    }
    if (templateId.length < 8 || templateId.length > 256 || templateIds.has(templateId)) {
      throw new Error(`WECHAT_SUBSCRIBE_TEMPLATES_JSON[${index}].templateId is invalid`);
    }
    if (page && (!page.startsWith("pages/") || page.length > 256)) {
      throw new Error(`WECHAT_SUBSCRIBE_TEMPLATES_JSON[${index}].page must start with pages/`);
    }
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length === 0) {
      throw new Error(`WECHAT_SUBSCRIBE_TEMPLATES_JSON[${index}].data must be a non-empty object`);
    }
    const normalizedData: Record<string, string> = {};
    for (const [field, template] of Object.entries(data as Record<string, unknown>)) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(field) || typeof template !== "string" || !template.trim()) {
        throw new Error(`WECHAT_SUBSCRIBE_TEMPLATES_JSON[${index}].data has an invalid field`);
      }
      normalizedData[field] = template.trim();
    }
    keys.add(key);
    templateIds.add(templateId);
    return { key, templateId, page: page || undefined, data: normalizedData };
  });
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
  if (appEnv === "production" && nodeEnv !== "production") {
    throw new Error("NODE_ENV=production is required when APP_ENV=production");
  }
  const apiPrefix = env.API_PREFIX?.trim() || "api/v1";
  const corsOrigins = parseCorsOrigins(env.CORS_ORIGINS, nodeEnv, appEnv);

  const jwtAccessSecret = env.JWT_ACCESS_SECRET?.trim() || (nodeEnv === "production" ? "" : "dev-access-secret");
  const jwtRefreshSecret = env.JWT_REFRESH_SECRET?.trim() || (nodeEnv === "production" ? "" : "dev-refresh-secret");
  const developmentTombstoneKey = Buffer.from(
    "talk-and-talk-development-auth-tombstone-key-v1",
    "utf8"
  ).toString("base64");
  const authIdentityTombstoneHmacKeys = optionalString(
    env.AUTH_IDENTITY_TOMBSTONE_HMAC_KEYS
  ) || (appEnv === "production" ? "" : JSON.stringify({ "dev-v1": developmentTombstoneKey }));
  const authIdentityTombstoneActiveKeyId = optionalString(
    env.AUTH_IDENTITY_TOMBSTONE_ACTIVE_KEY_ID
  ) || (appEnv === "production" ? "" : "dev-v1");
  const authIdentityReregistrationPolicy = optionalString(
    env.AUTH_IDENTITY_REREGISTRATION_POLICY
  ) || "after_tombstone_expiry";
  let tombstoneKeyring: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(authIdentityTombstoneHmacKeys || "");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      tombstoneKeyring = parsed as Record<string, unknown>;
    }
  } catch {
    tombstoneKeyring = {};
  }
  const tombstoneKeyEntries = Object.entries(tombstoneKeyring);
  if (!tombstoneKeyEntries.length) {
    throw new Error("AUTH_IDENTITY_TOMBSTONE_HMAC_KEYS must be a non-empty JSON keyring");
  }
  for (const [keyId, encoded] of tombstoneKeyEntries) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(keyId) || typeof encoded !== "string") {
      throw new Error("AUTH_IDENTITY_TOMBSTONE_HMAC_KEYS contains an invalid key id or value");
    }
    const decoded = Buffer.from(encoded, "base64");
    if (decoded.length < 32
      || decoded.toString("base64").replace(/=+$/u, "") !== encoded.replace(/=+$/u, "")) {
      throw new Error("Each auth identity tombstone HMAC key must be valid base64 for at least 32 bytes");
    }
    if (appEnv === "production") {
      assertProductionValue(`AUTH_IDENTITY_TOMBSTONE_HMAC_KEYS.${keyId}`, decoded.toString("utf8"));
    }
  }
  if (!Object.prototype.hasOwnProperty.call(tombstoneKeyring, authIdentityTombstoneActiveKeyId)) {
    throw new Error("AUTH_IDENTITY_TOMBSTONE_ACTIVE_KEY_ID must exist in the configured keyring");
  }
  if (authIdentityReregistrationPolicy !== "after_tombstone_expiry") {
    throw new Error(
      "AUTH_IDENTITY_REREGISTRATION_POLICY must be after_tombstone_expiry"
    );
  }
  const reviewJwtAccessSecret = env.REVIEW_JWT_ACCESS_SECRET?.trim() ||
    (nodeEnv === "production" ? "" : "dev-review-access-secret");
  const reviewJwtRefreshSecret = env.REVIEW_JWT_REFRESH_SECRET?.trim() ||
    (nodeEnv === "production" ? "" : "dev-review-refresh-secret");

  if ((nodeEnv === "production" || appEnv === "production") && (!jwtAccessSecret || !jwtRefreshSecret)) {
    throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set in production");
  }
  if (appEnv === "production" && (jwtAccessSecret.length < 32 || jwtRefreshSecret.length < 32)) {
    throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must each contain at least 32 characters in production");
  }
  if (appEnv === "production" && jwtAccessSecret === jwtRefreshSecret) {
    throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different in production");
  }
  if ((nodeEnv === "production" || appEnv === "production") && (!reviewJwtAccessSecret || !reviewJwtRefreshSecret)) {
    throw new Error("REVIEW_JWT_ACCESS_SECRET and REVIEW_JWT_REFRESH_SECRET must be set in production");
  }
  if (appEnv === "production" && (reviewJwtAccessSecret.length < 32 || reviewJwtRefreshSecret.length < 32)) {
    throw new Error("REVIEW_JWT_ACCESS_SECRET and REVIEW_JWT_REFRESH_SECRET must each contain at least 32 characters in production");
  }
  if (appEnv === "production" && reviewJwtAccessSecret === reviewJwtRefreshSecret) {
    throw new Error("REVIEW_JWT_ACCESS_SECRET and REVIEW_JWT_REFRESH_SECRET must be different in production");
  }
  if (appEnv === "production" && (reviewJwtAccessSecret === jwtAccessSecret || reviewJwtRefreshSecret === jwtRefreshSecret)) {
    throw new Error("Review JWT secrets must not reuse consumer JWT secrets in production");
  }
  const { accessTtl: jwtAccessTtl, refreshTtl: jwtRefreshTtl } = validateConsumerJwtTtls(
    env.JWT_ACCESS_TTL,
    env.JWT_REFRESH_TTL
  );

  const metricsToken = optionalString(env.METRICS_TOKEN);
  if ((appEnv === "production" || appEnv === "staging") && metricsToken.length < 32) {
    throw new Error("METRICS_TOKEN must contain at least 32 characters in staging/production");
  }
  const mockWechatNotifySecret =
    optionalString(env.MOCK_WECHAT_NOTIFY_SECRET) ||
    (nodeEnv === "test" ? "test-only-mock-wechat-notify-secret-32b" : "");
  if (appEnv === "production" && (!env.DATABASE_URL?.trim() || !env.REDIS_URL?.trim())) {
    throw new Error("DATABASE_URL and REDIS_URL must be explicitly configured in production");
  }
  if (appEnv === "production") {
    assertProductionValue("JWT_ACCESS_SECRET", jwtAccessSecret);
    assertProductionValue("JWT_REFRESH_SECRET", jwtRefreshSecret);
    assertProductionValue("REVIEW_JWT_ACCESS_SECRET", reviewJwtAccessSecret);
    assertProductionValue("REVIEW_JWT_REFRESH_SECRET", reviewJwtRefreshSecret);
    assertProductionValue("METRICS_TOKEN", metricsToken);
    assertProductionValue("DATABASE_URL", env.DATABASE_URL!.trim());
    assertProductionValue("REDIS_URL", env.REDIS_URL!.trim());
  }

  const externalAiUserContentEnabled = parseBoolean(env.EXTERNAL_AI_USER_CONTENT_ENABLED, false);
  if (externalAiUserContentEnabled) {
    throw new Error(
      "EXTERNAL_AI_USER_CONTENT_ENABLED=true is not supported: user-authored content must remain local-only"
    );
  }
  if (optionalString(env.DEEPSEEK_API_KEY)) {
    throw new Error(
      "DEEPSEEK_API_KEY must be unset: the generic DeepSeek service is not approved for user-authored content"
    );
  }
  if (appEnv === "production" && env.EXTERNAL_AI_USER_CONTENT_ENABLED?.trim() !== "false") {
    throw new Error("EXTERNAL_AI_USER_CONTENT_ENABLED=false must be explicitly configured in production");
  }

  const smsProvider = env.SMS_PROVIDER?.trim() || defaultSmsProvider(appEnv);
  if (appEnv === "production" && smsProvider === "mock") {
    throw new Error("SMS_PROVIDER=mock is not allowed when APP_ENV=production");
  }
  const staffTotpEncryptionKey = optionalString(env.STAFF_TOTP_ENCRYPTION_KEY) ||
    (appEnv === "production" ? "" : "development-staff-totp-key-not-for-production");
  const reviewTotpEncryptionKey = optionalString(env.REVIEW_TOTP_ENCRYPTION_KEY) ||
    (appEnv === "production" ? "" : "development-review-totp-key-not-for-production");
  if (appEnv === "production") {
    if (staffTotpEncryptionKey.length < 32) {
      throw new Error("STAFF_TOTP_ENCRYPTION_KEY must contain at least 32 characters in production");
    }
    assertProductionValue("STAFF_TOTP_ENCRYPTION_KEY", staffTotpEncryptionKey);
    if (reviewTotpEncryptionKey.length < 32) {
      throw new Error("REVIEW_TOTP_ENCRYPTION_KEY must contain at least 32 characters in production");
    }
    if (reviewTotpEncryptionKey === staffTotpEncryptionKey) {
      throw new Error("REVIEW_TOTP_ENCRYPTION_KEY must not reuse STAFF_TOTP_ENCRYPTION_KEY in production");
    }
    assertProductionValue("REVIEW_TOTP_ENCRYPTION_KEY", reviewTotpEncryptionKey);
  }
  const seedOnStartup = parseBoolean(env.SEED_ON_STARTUP, appEnv === "staging");
  if (appEnv === "production" && seedOnStartup) {
    throw new Error("SEED_ON_STARTUP is not allowed when APP_ENV=production");
  }
  // This worker is database-driven and idempotent: it is safe for multiple
  // replicas and resumes any overdue order after a restart. Keep it off under
  // NODE_ENV=test so unit/e2e processes do not leave live timers behind.
  const paymentReconciliationEnabled = parseBoolean(
    env.PAYMENT_RECONCILIATION_ENABLED,
    nodeEnv !== "test"
  );
  const paymentReconciliationIntervalSeconds = positiveInteger(
    "PAYMENT_RECONCILIATION_INTERVAL_SECONDS",
    env.PAYMENT_RECONCILIATION_INTERVAL_SECONDS,
    60
  );
  const paymentReconciliationBatchSize = Math.min(
    positiveInteger("PAYMENT_RECONCILIATION_BATCH_SIZE", env.PAYMENT_RECONCILIATION_BATCH_SIZE, 50),
    200
  );
  const wechatDailyBillReconciliationEnabled = parseBoolean(
    env.WECHAT_DAILY_BILL_RECONCILIATION_ENABLED,
    false
  );
  const wechatDailyBillReconciliationApproved = parseBoolean(
    env.WECHAT_DAILY_BILL_RECONCILIATION_APPROVED,
    false
  );
  const wechatDailyBillReconciliationApprovalReference = optionalString(
    env.WECHAT_DAILY_BILL_RECONCILIATION_APPROVAL_REFERENCE
  );
  const wechatDailyBillReconciliationStartDate = optionalString(
    env.WECHAT_DAILY_BILL_RECONCILIATION_START_DATE
  );
  if (wechatDailyBillReconciliationStartDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(wechatDailyBillReconciliationStartDate)) {
      throw new Error("WECHAT_DAILY_BILL_RECONCILIATION_START_DATE must use YYYY-MM-DD");
    }
    const parsedStartDate = new Date(`${wechatDailyBillReconciliationStartDate}T00:00:00.000Z`);
    if (Number.isNaN(parsedStartDate.getTime())
      || parsedStartDate.toISOString().slice(0, 10) !== wechatDailyBillReconciliationStartDate) {
      throw new Error("WECHAT_DAILY_BILL_RECONCILIATION_START_DATE must be a valid calendar date");
    }
  }
  if (wechatDailyBillReconciliationEnabled && !wechatDailyBillReconciliationStartDate) {
    throw new Error(
      "WECHAT_DAILY_BILL_RECONCILIATION_ENABLED=true requires WECHAT_DAILY_BILL_RECONCILIATION_START_DATE"
    );
  }
  if (
    wechatDailyBillReconciliationApprovalReference
    && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,159}$/.test(wechatDailyBillReconciliationApprovalReference)
  ) {
    throw new Error(
      "WECHAT_DAILY_BILL_RECONCILIATION_APPROVAL_REFERENCE must be a 6-160 character non-secret reference"
    );
  }
  if (
    wechatDailyBillReconciliationApproved
    && !wechatDailyBillReconciliationApprovalReference
  ) {
    throw new Error(
      "WECHAT_DAILY_BILL_RECONCILIATION_APPROVED=true requires WECHAT_DAILY_BILL_RECONCILIATION_APPROVAL_REFERENCE"
    );
  }
  const wechatDailyBillReconciliationHour = boundedInteger(
    "WECHAT_DAILY_BILL_RECONCILIATION_HOUR",
    env.WECHAT_DAILY_BILL_RECONCILIATION_HOUR,
    10,
    10,
    23
  );
  const wechatDailyBillReconciliationBatchSize = boundedInteger(
    "WECHAT_DAILY_BILL_RECONCILIATION_BATCH_SIZE",
    env.WECHAT_DAILY_BILL_RECONCILIATION_BATCH_SIZE,
    4,
    1,
    16
  );
  const wechatPayComplaintsEnabled = parseBoolean(
    env.WECHAT_PAY_COMPLAINTS_ENABLED,
    nodeEnv !== "test"
  );
  const wechatPayComplaintPollIntervalSeconds = boundedInteger(
    "WECHAT_PAY_COMPLAINT_POLL_INTERVAL_SECONDS",
    env.WECHAT_PAY_COMPLAINT_POLL_INTERVAL_SECONDS,
    300,
    60,
    60 * 60
  );
  const wechatPayComplaintBatchSize = boundedInteger(
    "WECHAT_PAY_COMPLAINT_BATCH_SIZE",
    env.WECHAT_PAY_COMPLAINT_BATCH_SIZE,
    50,
    1,
    200
  );
  // This is deliberately independent from payment reconciliation: operations
  // can pause automatic reschedule expiry during an incident without delaying
  // payment/refund reconciliation. It remains off in test processes so unit
  // and e2e runs cannot retain timers.
  const orderRescheduleExpiryEnabled = parseBoolean(
    env.ORDER_RESCHEDULE_EXPIRY_ENABLED,
    nodeEnv !== "test"
  );
  const orderRescheduleExpiryIntervalSeconds = positiveInteger(
    "ORDER_RESCHEDULE_EXPIRY_INTERVAL_SECONDS",
    env.ORDER_RESCHEDULE_EXPIRY_INTERVAL_SECONDS,
    60
  );
  const orderRescheduleExpiryBatchSize = Math.min(
    positiveInteger("ORDER_RESCHEDULE_EXPIRY_BATCH_SIZE", env.ORDER_RESCHEDULE_EXPIRY_BATCH_SIZE, 50),
    200
  );
  const commercialReleaseMode = parseCommercialReleaseMode(env.COMMERCIAL_RELEASE_MODE);
  const companionVoiceEvidenceViewerUrl = optionalString(env.COMPANION_VOICE_EVIDENCE_VIEWER_URL);
  const companionVoiceEvidenceSigningSecret = optionalString(env.COMPANION_VOICE_EVIDENCE_SIGNING_SECRET);
  if (Boolean(companionVoiceEvidenceViewerUrl) !== Boolean(companionVoiceEvidenceSigningSecret)) {
    throw new Error(
      "COMPANION_VOICE_EVIDENCE_VIEWER_URL and COMPANION_VOICE_EVIDENCE_SIGNING_SECRET must be configured together"
    );
  }
  if (companionVoiceEvidenceViewerUrl) {
    let viewerUrl: URL;
    try {
      viewerUrl = new URL(companionVoiceEvidenceViewerUrl);
    } catch {
      throw new Error("COMPANION_VOICE_EVIDENCE_VIEWER_URL must be an absolute HTTPS URL");
    }
    if (viewerUrl.protocol !== "https:") {
      throw new Error("COMPANION_VOICE_EVIDENCE_VIEWER_URL must be an absolute HTTPS URL");
    }
    if (viewerUrl.username || viewerUrl.password || viewerUrl.search || viewerUrl.hash) {
      throw new Error(
        "COMPANION_VOICE_EVIDENCE_VIEWER_URL must not contain credentials, a query string or a URL fragment"
      );
    }
  }
  if (
    appEnv === "production"
    && companionVoiceEvidenceSigningSecret
    && companionVoiceEvidenceSigningSecret.length < 32
  ) {
    throw new Error(
      "COMPANION_VOICE_EVIDENCE_SIGNING_SECRET must contain at least 32 characters in production"
    );
  }
  if (appEnv === "production" && companionVoiceEvidenceSigningSecret) {
    assertProductionValue("COMPANION_VOICE_EVIDENCE_SIGNING_SECRET", companionVoiceEvidenceSigningSecret);
  }
  const companionVoiceEvidenceUrlTtlSeconds = boundedInteger(
    "COMPANION_VOICE_EVIDENCE_URL_TTL_SECONDS",
    env.COMPANION_VOICE_EVIDENCE_URL_TTL_SECONDS,
    300,
    60,
    900
  );
  const platformFeeBps = boundedInteger("PLATFORM_FEE_BPS", env.PLATFORM_FEE_BPS, 0, 0, 10_000);
  const companionSettlementHoldHours = boundedInteger(
    "COMPANION_SETTLEMENT_HOLD_HOURS",
    env.COMPANION_SETTLEMENT_HOLD_HOURS,
    96,
    1,
    24 * 30
  );
  const refundPolicyVersion = optionalString(env.REFUND_POLICY_VERSION) || "development-v1";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(refundPolicyVersion)) {
    throw new Error(
      "REFUND_POLICY_VERSION must be a controlled 3-64 character version identifier"
    );
  }
  const refundPolicyApproved = parseBoolean(env.REFUND_POLICY_APPROVED, false);
  const refundPolicyApprovalReference = optionalString(env.REFUND_POLICY_APPROVAL_REFERENCE);
  if (
    refundPolicyApprovalReference
    && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,159}$/.test(refundPolicyApprovalReference)
  ) {
    throw new Error(
      "REFUND_POLICY_APPROVAL_REFERENCE must be a 6-160 character non-secret reference"
    );
  }
  if (refundPolicyApproved && !refundPolicyApprovalReference) {
    throw new Error(
      "REFUND_POLICY_APPROVED=true requires REFUND_POLICY_APPROVAL_REFERENCE"
    );
  }
  if (commercialReleaseMode === "commercial" && !refundPolicyApproved) {
    throw new Error(
      "COMMERCIAL_RELEASE_MODE=commercial requires an approved refund policy version"
    );
  }
  const refundRequestWindowHours = boundedInteger(
    "REFUND_REQUEST_WINDOW_HOURS",
    env.REFUND_REQUEST_WINDOW_HOURS,
    72,
    1,
    24 * 30
  );
  const refundReviewSlaHours = boundedInteger(
    "REFUND_REVIEW_SLA_HOURS",
    env.REFUND_REVIEW_SLA_HOURS,
    24,
    1,
    24 * 14
  );
  const refundResolutionSlaHours = boundedInteger(
    "REFUND_RESOLUTION_SLA_HOURS",
    env.REFUND_RESOLUTION_SLA_HOURS,
    72,
    1,
    24 * 30
  );
  const orderResponseWindowMinutes = boundedInteger(
    "ORDER_RESPONSE_WINDOW_MINUTES",
    env.ORDER_RESPONSE_WINDOW_MINUTES,
    10,
    1,
    24 * 60
  );
  // Order chat is a logistics/service channel, not an indefinite private
  // social channel. These values make its short pre-service and wrap-up
  // periods explicit and can be tuned without changing code.
  const orderChatPreServiceWindowMinutes = boundedInteger(
    "ORDER_CHAT_PRE_SERVICE_WINDOW_MINUTES",
    env.ORDER_CHAT_PRE_SERVICE_WINDOW_MINUTES,
    15,
    0,
    24 * 60
  );
  const orderChatPostServiceWindowMinutes = boundedInteger(
    "ORDER_CHAT_POST_SERVICE_WINDOW_MINUTES",
    env.ORDER_CHAT_POST_SERVICE_WINDOW_MINUTES,
    15,
    0,
    24 * 60
  );
  const orderRescheduleResponseWindowMinutes = boundedInteger(
    "ORDER_RESCHEDULE_RESPONSE_WINDOW_MINUTES",
    env.ORDER_RESCHEDULE_RESPONSE_WINDOW_MINUTES,
    12 * 60,
    5,
    7 * 24 * 60
  );
  const orderMaxScheduleDays = boundedInteger(
    "ORDER_MAX_SCHEDULE_DAYS",
    env.ORDER_MAX_SCHEDULE_DAYS,
    30,
    1,
    365
  );
  const orderIntakeEnabled = parseBoolean(env.ORDER_INTAKE_ENABLED, true);
  const orderMaxOpenTotal = boundedInteger(
    "ORDER_MAX_OPEN_TOTAL", env.ORDER_MAX_OPEN_TOTAL, 500, 1, 100_000
  );
  const orderMaxOpenPerUser = boundedInteger(
    "ORDER_MAX_OPEN_PER_USER", env.ORDER_MAX_OPEN_PER_USER, 3, 1, 100
  );
  const orderMaxPendingPerCompanion = boundedInteger(
    "ORDER_MAX_PENDING_PER_COMPANION", env.ORDER_MAX_PENDING_PER_COMPANION, 20, 1, 1_000
  );
  const payoutClaimsEnabled = parseBoolean(env.PAYOUT_CLAIMS_ENABLED, true);
  const supportResponseHours = boundedInteger(
    "SUPPORT_RESPONSE_HOURS",
    env.SUPPORT_RESPONSE_HOURS,
    24,
    1,
    24 * 30
  );
  const supportMaxOpenPerUser = boundedInteger(
    "SUPPORT_MAX_OPEN_PER_USER",
    env.SUPPORT_MAX_OPEN_PER_USER,
    5,
    1,
    100
  );
  const supportPublicServiceHours =
    optionalString(env.SUPPORT_PUBLIC_SERVICE_HOURS) || "工作日 09:00-18:00（北京时间）";
  if (supportPublicServiceHours.length > 120) {
    throw new Error("SUPPORT_PUBLIC_SERVICE_HOURS must be at most 120 characters");
  }
  const supportPublicStatusUrl = optionalString(env.SUPPORT_PUBLIC_STATUS_URL);
  if (supportPublicStatusUrl) {
    requiredProtocolUrl(
      "SUPPORT_PUBLIC_STATUS_URL",
      supportPublicStatusUrl,
      supportPublicStatusUrl,
      ["https:"]
    );
  }
  const dataExportDeliveryBaseUrl = optionalString(env.DATA_EXPORT_DELIVERY_BASE_URL);
  if (dataExportDeliveryBaseUrl) {
    requiredProtocolUrl(
      "DATA_EXPORT_DELIVERY_BASE_URL",
      dataExportDeliveryBaseUrl,
      dataExportDeliveryBaseUrl,
      ["https:"]
    );
  }
  const dataExportDeliveryApiKey = optionalString(env.DATA_EXPORT_DELIVERY_API_KEY);
  const dataExportDeliveryTimeoutMs = boundedInteger(
    "DATA_EXPORT_DELIVERY_TIMEOUT_MS",
    env.DATA_EXPORT_DELIVERY_TIMEOUT_MS,
    10_000,
    1_000,
    60_000
  );
  const dataExportMaxBytes = boundedInteger(
    "DATA_EXPORT_MAX_BYTES",
    env.DATA_EXPORT_MAX_BYTES,
    50 * 1024 * 1024,
    1_024,
    100 * 1024 * 1024
  );
  const companionAppealSubmissionDays = boundedInteger(
    "COMPANION_APPEAL_SUBMISSION_DAYS",
    env.COMPANION_APPEAL_SUBMISSION_DAYS,
    30,
    1,
    365
  );
  const companionAppealResponseHours = boundedInteger(
    "COMPANION_APPEAL_RESPONSE_HOURS",
    env.COMPANION_APPEAL_RESPONSE_HOURS,
    72,
    1,
    24 * 30
  );
  const notificationDeliveryEnabled = parseBoolean(
    env.NOTIFICATION_DELIVERY_ENABLED,
    nodeEnv !== "test"
  );
  const notificationDeliveryIntervalSeconds = boundedInteger(
    "NOTIFICATION_DELIVERY_INTERVAL_SECONDS",
    env.NOTIFICATION_DELIVERY_INTERVAL_SECONDS,
    30,
    5,
    60 * 60
  );
  const notificationDeliveryBatchSize = boundedInteger(
    "NOTIFICATION_DELIVERY_BATCH_SIZE",
    env.NOTIFICATION_DELIVERY_BATCH_SIZE,
    20,
    1,
    200
  );
  // This preparation runner only turns existing availability candidates into
  // private preflight/handoff state; it has no provider or delivery dependency.
  // Keep it explicitly off in every environment until operations opts in.
  const availabilityReminderPreparationEnabled = parseBoolean(
    env.AVAILABILITY_REMINDER_PREPARATION_ENABLED,
    false
  );
  const availabilityReminderPreparationIntervalSeconds = boundedInteger(
    "AVAILABILITY_REMINDER_PREPARATION_INTERVAL_SECONDS",
    env.AVAILABILITY_REMINDER_PREPARATION_INTERVAL_SECONDS,
    60,
    15,
    60 * 60
  );
  const availabilityReminderPreparationBatchSize = boundedInteger(
    "AVAILABILITY_REMINDER_PREPARATION_BATCH_SIZE",
    env.AVAILABILITY_REMINDER_PREPARATION_BATCH_SIZE,
    20,
    1,
    100
  );
  const availabilityReminderFanoutBatchSize = boundedInteger(
    "AVAILABILITY_REMINDER_FANOUT_BATCH_SIZE",
    env.AVAILABILITY_REMINDER_FANOUT_BATCH_SIZE,
    200,
    1,
    1_000
  );
  const availabilityReminderFanoutBatchesPerRun = boundedInteger(
    "AVAILABILITY_REMINDER_FANOUT_BATCHES_PER_RUN",
    env.AVAILABILITY_REMINDER_FANOUT_BATCHES_PER_RUN,
    20,
    1,
    100
  );
  const availabilityReminderFanoutLeaseSeconds = boundedInteger(
    "AVAILABILITY_REMINDER_FANOUT_LEASE_SECONDS",
    env.AVAILABILITY_REMINDER_FANOUT_LEASE_SECONDS,
    120,
    30,
    900
  );
  const availabilityReminderFanoutMaxFailures = boundedInteger(
    "AVAILABILITY_REMINDER_FANOUT_MAX_FAILURES",
    env.AVAILABILITY_REMINDER_FANOUT_MAX_FAILURES,
    8,
    1,
    50
  );
  const availabilityReminderFanoutRetryBaseSeconds = boundedInteger(
    "AVAILABILITY_REMINDER_FANOUT_RETRY_BASE_SECONDS",
    env.AVAILABILITY_REMINDER_FANOUT_RETRY_BASE_SECONDS,
    30,
    5,
    900
  );
  // Unlike preparation, this runner crosses the one-time authorization and
  // provider boundary. It remains separately and explicitly off until an
  // operator has configured the live subscribe channel and template below.
  const availabilityReminderDeliveryEnabled = parseBoolean(
    env.AVAILABILITY_REMINDER_DELIVERY_ENABLED,
    false
  );
  const availabilityReminderDeliveryIntervalSeconds = boundedInteger(
    "AVAILABILITY_REMINDER_DELIVERY_INTERVAL_SECONDS",
    env.AVAILABILITY_REMINDER_DELIVERY_INTERVAL_SECONDS,
    60,
    15,
    60 * 60
  );
  const availabilityReminderDeliveryBatchSize = boundedInteger(
    "AVAILABILITY_REMINDER_DELIVERY_BATCH_SIZE",
    env.AVAILABILITY_REMINDER_DELIVERY_BATCH_SIZE,
    20,
    1,
    100
  );
  const wechatSubscribeMessagesEnabled = parseBoolean(env.WECHAT_SUBSCRIBE_MESSAGES_ENABLED, false);
  const wechatSubscribeTemplates = parseWeChatSubscribeTemplates(
    env.WECHAT_SUBSCRIBE_TEMPLATES_JSON,
    wechatSubscribeMessagesEnabled
  );
  if (availabilityReminderDeliveryEnabled && !wechatSubscribeMessagesEnabled) {
    throw new Error("AVAILABILITY_REMINDER_DELIVERY_ENABLED requires WECHAT_SUBSCRIBE_MESSAGES_ENABLED=true");
  }
  if (availabilityReminderDeliveryEnabled
    && !wechatSubscribeTemplates.some((template) => template.key === "availabilityReminder")) {
    throw new Error("AVAILABILITY_REMINDER_DELIVERY_ENABLED requires an availabilityReminder subscribe template");
  }

  const miniProgramAppId = optionalString(env.WECHAT_MINIPROGRAM_APP_ID);
  const miniProgramAppSecret = optionalString(env.WECHAT_MINIPROGRAM_APP_SECRET);
  if (Boolean(miniProgramAppId) !== Boolean(miniProgramAppSecret)) {
    throw new Error("WECHAT_MINIPROGRAM_APP_ID and WECHAT_MINIPROGRAM_APP_SECRET must be configured together");
  }
  if (appEnv === "production") {
    if (!/^wx[0-9A-Za-z]{10,}$/.test(miniProgramAppId)) {
      throw new Error("WECHAT_MINIPROGRAM_APP_ID must look like a real WeChat AppID in production");
    }
    if (miniProgramAppSecret.length < 16) {
      throw new Error("WECHAT_MINIPROGRAM_APP_SECRET is unexpectedly short for production");
    }
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
    if (!/^wx[0-9A-Za-z]{10,}$/.test(requiredMiniProgramPaymentConfig.WECHAT_PAY_APP_ID)) {
      throw new Error("WECHAT_PAY_APP_ID must look like a real WeChat AppID in production");
    }
    if (!/^\d{6,32}$/.test(wechatPayMchId)) {
      throw new Error("WECHAT_PAY_MCH_ID must contain 6-32 digits in production");
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
  const legalConsentEffectiveDate = env.LEGAL_CONSENT_EFFECTIVE_DATE?.trim() || DEFAULT_LEGAL_CONSENT_EFFECTIVE_DATE;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(legalConsentEffectiveDate) || Number.isNaN(Date.parse(`${legalConsentEffectiveDate}T00:00:00Z`))) {
    throw new Error("LEGAL_CONSENT_EFFECTIVE_DATE must use YYYY-MM-DD");
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
  const legalPlatformRulesUrl = requiredProtocolUrl(
    "LEGAL_PLATFORM_RULES_URL",
    env.LEGAL_PLATFORM_RULES_URL,
    DEFAULT_LEGAL_PLATFORM_RULES_URL,
    ["https:"]
  );
  const legalOperatorName = optionalString(env.LEGAL_OPERATOR_NAME) || DEVELOPMENT_OPERATOR_NAME;
  const legalContactEmail = optionalString(env.LEGAL_CONTACT_EMAIL);
  const legalContactPhone = optionalString(env.LEGAL_CONTACT_PHONE);
  const legalComplaintChannel = optionalString(env.LEGAL_COMPLAINT_CHANNEL);
  const legalPrivacyRetentionDays = boundedInteger(
    "LEGAL_PRIVACY_RETENTION_DAYS",
    env.LEGAL_PRIVACY_RETENTION_DAYS,
    1095,
    1,
    36500
  );
  const accountDeletionRetentionPolicyApproved = parseBoolean(
    env.ACCOUNT_DELETION_RETENTION_POLICY_APPROVED,
    false
  );
  const accountDeletionRetentionPolicyApprovalReference = optionalString(
    env.ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE
  );
  const accountDataRetentionLegalHoldPolicyApproved = parseBoolean(
    env.ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_APPROVED,
    false
  );
  const accountDataRetentionLegalHoldPolicyVersion = optionalString(
    env.ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_VERSION
  );
  const accountDataRetentionLegalHoldPolicyApprovalReference = optionalString(
    env.ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_APPROVAL_REFERENCE
  );
  const accountDataRetentionLegalHoldReasonCodesJson = optionalString(
    env.ACCOUNT_DATA_RETENTION_LEGAL_HOLD_REASON_CODES_JSON
  ) || "[]";
  const crisisResourcesApproved = parseBoolean(env.CRISIS_RESOURCES_APPROVED, false);
  const crisisResourcesApprovalReference = optionalString(
    env.CRISIS_RESOURCES_APPROVAL_REFERENCE
  );
  if (
    accountDeletionRetentionPolicyApprovalReference
    && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,159}$/.test(accountDeletionRetentionPolicyApprovalReference)
  ) {
    throw new Error(
      "ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE must be a 6-160 character non-secret reference"
    );
  }
  if (accountDeletionRetentionPolicyApproved && !accountDeletionRetentionPolicyApprovalReference) {
    throw new Error(
      "ACCOUNT_DELETION_RETENTION_POLICY_APPROVED=true requires ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE"
    );
  }
  if (
    accountDataRetentionLegalHoldPolicyVersion
    && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,63}$/.test(accountDataRetentionLegalHoldPolicyVersion)
  ) {
    throw new Error(
      "ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_VERSION must be a controlled 3-64 character version identifier"
    );
  }
  if (
    accountDataRetentionLegalHoldPolicyApprovalReference
    && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,159}$/.test(
      accountDataRetentionLegalHoldPolicyApprovalReference
    )
  ) {
    throw new Error(
      "ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_APPROVAL_REFERENCE must be a 6-160 character non-secret reference"
    );
  }
  let accountDataRetentionLegalHoldReasons: unknown;
  try {
    accountDataRetentionLegalHoldReasons = JSON.parse(
      accountDataRetentionLegalHoldReasonCodesJson
    );
  } catch {
    throw new Error("ACCOUNT_DATA_RETENTION_LEGAL_HOLD_REASON_CODES_JSON must be valid JSON");
  }
  const legalHoldReasonCatalogValid = Array.isArray(accountDataRetentionLegalHoldReasons)
    && accountDataRetentionLegalHoldReasons.length > 0
    && accountDataRetentionLegalHoldReasons.every((item) => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Record<string, unknown>;
      const actions = candidate.actions;
      const categories = candidate.categories;
      return typeof candidate.code === "string"
        && /^[A-Z][A-Z0-9_]{2,63}$/.test(candidate.code)
        && Array.isArray(actions)
        && actions.length > 0
        && actions.every((action) => action === "placement" || action === "release")
        && new Set(actions).size === actions.length
        && Array.isArray(categories)
        && categories.length > 0
        && categories.every((category) => typeof category === "string" && category.length > 0)
        && new Set(categories).size === categories.length;
    });
  if (
    accountDataRetentionLegalHoldPolicyApproved
    && (
      !accountDataRetentionLegalHoldPolicyVersion
      || !accountDataRetentionLegalHoldPolicyApprovalReference
      || !legalHoldReasonCatalogValid
    )
  ) {
    throw new Error(
      "ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_APPROVED=true requires a controlled version, approval reference and non-empty reason catalog"
    );
  }
  if (
    crisisResourcesApprovalReference
    && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,159}$/.test(crisisResourcesApprovalReference)
  ) {
    throw new Error(
      "CRISIS_RESOURCES_APPROVAL_REFERENCE must be a 6-160 character non-secret reference"
    );
  }
  if (crisisResourcesApproved && !crisisResourcesApprovalReference) {
    throw new Error(
      "CRISIS_RESOURCES_APPROVED=true requires CRISIS_RESOURCES_APPROVAL_REFERENCE"
    );
  }
  if (legalContactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(legalContactEmail)) {
    throw new Error("LEGAL_CONTACT_EMAIL must be a valid email address when configured");
  }
  if (appEnv === "production") {
    if (!accountDeletionRetentionPolicyApproved || !accountDeletionRetentionPolicyApprovalReference) {
      throw new Error(
        "Production account deletion requires an approved retention policy and approval reference"
      );
    }
    if (
      !accountDataRetentionLegalHoldPolicyApproved
      || !accountDataRetentionLegalHoldPolicyVersion
      || !accountDataRetentionLegalHoldPolicyApprovalReference
      || !legalHoldReasonCatalogValid
    ) {
      throw new Error(
        "Production data-retention legal holds require an externally approved version, reference and reason catalog"
      );
    }
    if (!crisisResourcesApproved || !crisisResourcesApprovalReference) {
      throw new Error(
        "Production release requires approved crisis resources and a non-secret approval reference"
      );
    }
    const productionLegalFields = {
      LEGAL_OPERATOR_NAME: legalOperatorName,
      LEGAL_CONTACT_EMAIL: legalContactEmail,
      LEGAL_CONTACT_PHONE: legalContactPhone,
      LEGAL_COMPLAINT_CHANNEL: legalComplaintChannel
    };
    const missingLegal = Object.entries(productionLegalFields)
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missingLegal.length > 0) {
      throw new Error(`Production legal disclosures are missing: ${missingLegal.join(", ")}`);
    }
    if (legalOperatorName === DEVELOPMENT_OPERATOR_NAME) {
      throw new Error("LEGAL_OPERATOR_NAME must be explicitly configured in production");
    }
    if (!env.LEGAL_CONSENT_EFFECTIVE_DATE?.trim()) {
      throw new Error("LEGAL_CONSENT_EFFECTIVE_DATE must be explicitly configured in production");
    }
    if (!env.LEGAL_CONSENT_VERSION?.trim()) {
      throw new Error("LEGAL_CONSENT_VERSION must be explicitly configured in production");
    }
    for (const [name, value] of Object.entries(productionLegalFields)) {
      assertProductionValue(name, value);
    }
    if (commercialReleaseMode !== "commercial") {
      throw new Error("COMMERCIAL_RELEASE_MODE=commercial is required in production");
    }
    if (env.PLATFORM_FEE_BPS === undefined || env.PLATFORM_FEE_BPS.trim() === "") {
      throw new Error("PLATFORM_FEE_BPS must be explicitly configured in production");
    }
    if (!notificationDeliveryEnabled || !wechatSubscribeMessagesEnabled || wechatSubscribeTemplates.length === 0) {
      throw new Error(
        "Production commercial release requires NOTIFICATION_DELIVERY_ENABLED=true and configured WeChat subscription templates"
      );
    }
    const configuredTemplateKeys = new Set(wechatSubscribeTemplates.map((template) => template.key));
    const missingTemplateKeys = REQUIRED_TRANSACTIONAL_TEMPLATE_KEYS.filter((key) => !configuredTemplateKeys.has(key));
    if (missingTemplateKeys.length > 0) {
      throw new Error(`Production WeChat subscription templates are missing event keys: ${missingTemplateKeys.join(", ")}`);
    }
    if (env.PAYMENT_RECONCILIATION_ENABLED !== "true") {
      throw new Error("PAYMENT_RECONCILIATION_ENABLED=true is required for a production commercial release");
    }
    if (
      !wechatDailyBillReconciliationEnabled
      || !wechatDailyBillReconciliationApproved
      || !wechatDailyBillReconciliationApprovalReference
      || !wechatDailyBillReconciliationStartDate
    ) {
      throw new Error(
        "Production commercial release requires enabled and approved WeChat T+1 daily bill reconciliation"
      );
    }
    if (env.WECHAT_PAY_COMPLAINTS_ENABLED !== "true") {
      throw new Error("WECHAT_PAY_COMPLAINTS_ENABLED=true is required for a production commercial release");
    }
    for (const name of [
      "COMPANION_SETTLEMENT_HOLD_HOURS",
      "REFUND_POLICY_VERSION",
      "REFUND_POLICY_APPROVED",
      "REFUND_POLICY_APPROVAL_REFERENCE",
      "REFUND_REQUEST_WINDOW_HOURS",
      "REFUND_REVIEW_SLA_HOURS",
      "REFUND_RESOLUTION_SLA_HOURS",
      "ORDER_RESPONSE_WINDOW_MINUTES",
      "ORDER_CHAT_PRE_SERVICE_WINDOW_MINUTES",
      "ORDER_CHAT_POST_SERVICE_WINDOW_MINUTES",
      "ORDER_RESCHEDULE_RESPONSE_WINDOW_MINUTES",
      "ORDER_RESCHEDULE_EXPIRY_ENABLED",
      "ORDER_RESCHEDULE_EXPIRY_INTERVAL_SECONDS",
      "ORDER_RESCHEDULE_EXPIRY_BATCH_SIZE",
      "ORDER_MAX_SCHEDULE_DAYS",
      "ORDER_INTAKE_ENABLED",
      "ORDER_MAX_OPEN_TOTAL",
      "ORDER_MAX_OPEN_PER_USER",
      "ORDER_MAX_PENDING_PER_COMPANION",
      "PAYOUT_CLAIMS_ENABLED",
      "SUPPORT_RESPONSE_HOURS",
      "SUPPORT_MAX_OPEN_PER_USER",
      "SUPPORT_PUBLIC_SERVICE_HOURS",
      "SUPPORT_PUBLIC_STATUS_URL",
      "DATA_EXPORT_DELIVERY_BASE_URL",
      "DATA_EXPORT_DELIVERY_API_KEY",
      "DATA_EXPORT_DELIVERY_TIMEOUT_MS",
      "DATA_EXPORT_MAX_BYTES",
      "COMPANION_APPEAL_SUBMISSION_DAYS",
      "COMPANION_APPEAL_RESPONSE_HOURS"
    ]) {
      if (env[name] === undefined || env[name]?.trim() === "") {
        throw new Error(`${name} must be explicitly configured in production`);
      }
    }
    assertProductionValue("SUPPORT_PUBLIC_SERVICE_HOURS", supportPublicServiceHours);
    assertProductionValue("SUPPORT_PUBLIC_STATUS_URL", supportPublicStatusUrl);
    assertProductionValue("DATA_EXPORT_DELIVERY_BASE_URL", dataExportDeliveryBaseUrl);
    assertProductionValue("DATA_EXPORT_DELIVERY_API_KEY", dataExportDeliveryApiKey);
    if (companionSettlementHoldHours < refundRequestWindowHours + 24) {
      throw new Error(
        "COMPANION_SETTLEMENT_HOLD_HOURS must be at least REFUND_REQUEST_WINDOW_HOURS + 24 in production"
      );
    }
  }
  const mediaFeatureEnabled = parseBoolean(env.MEDIA_FEATURE_ENABLED, false);
  const mediaProvider = env.MEDIA_PROVIDER?.trim() || "disabled";
  if (!["disabled", "mock"].includes(mediaProvider)) {
    throw new Error("MEDIA_PROVIDER must be disabled or mock until a production media adapter is installed");
  }
  if (appEnv === "production" && mediaFeatureEnabled) {
    throw new Error("MEDIA_FEATURE_ENABLED requires a configured production media adapter and cannot use the bundled mock provider");
  }
  // Real-time voice is intentionally independent from attachment/media
  // uploads. It remains closed until the provider room restriction has been
  // enabled in the TRTC console and all server-side signing inputs exist.
  const trtcEnabled = parseBoolean(env.TRTC_ENABLED, false);
  const trtcSdkAppId = boundedInteger("TRTC_SDK_APP_ID", env.TRTC_SDK_APP_ID, 0, 0, 2_147_483_647);
  const trtcSdkSecretKey = optionalString(env.TRTC_SDK_SECRET_KEY);
  const trtcCallbackSigningKey = optionalString(env.TRTC_CALLBACK_SIGNING_KEY);
  const trtcPrivateMapKeyEnabled = parseBoolean(env.TRTC_PRIVATE_MAP_KEY_ENABLED, false);
  const trtcUserSigTtlSeconds = boundedInteger(
    "TRTC_USER_SIG_TTL_SECONDS", env.TRTC_USER_SIG_TTL_SECONDS, 300, 60, 900
  );
  const trtcPrivacyDisclosureApproved = parseBoolean(
    env.TRTC_PRIVACY_DISCLOSURE_APPROVED,
    false
  );
  const trtcPrivacyDisclosureReference = optionalString(
    env.TRTC_PRIVACY_DISCLOSURE_REFERENCE
  );
  if (
    trtcPrivacyDisclosureReference
    && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,159}$/.test(trtcPrivacyDisclosureReference)
  ) {
    throw new Error(
      "TRTC_PRIVACY_DISCLOSURE_REFERENCE must be a 6-160 character non-secret reference"
    );
  }
  // A client-side timer is only a convenience. A commercial voice service
  // needs a server-side room-close path for refunds and elapsed service
  // windows, otherwise an already-connected client can outlive the order.
  const trtcRoomControlEnabled = parseBoolean(env.TRTC_ROOM_CONTROL_ENABLED, false);
  // This is a temporary incident-control state, not a normal product switch.
  // It blocks new credentials and makes the durable worker close every room
  // it has recorded before operators turn the feature off completely.
  const trtcEmergencyStopEnabled = parseBoolean(env.TRTC_EMERGENCY_STOP_ENABLED, false);
  const trtcControlRegion = optionalString(env.TRTC_CONTROL_REGION) || "ap-guangzhou";
  if (trtcControlRegion !== "ap-beijing" && trtcControlRegion !== "ap-guangzhou") {
    throw new Error("TRTC_CONTROL_REGION must be ap-beijing or ap-guangzhou");
  }
  const trtcControlTimeoutMs = boundedInteger(
    "TRTC_CONTROL_TIMEOUT_MS", env.TRTC_CONTROL_TIMEOUT_MS, 5_000, 1_000, 10_000
  );
  const trtcRoomControlIntervalSeconds = boundedInteger(
    "TRTC_ROOM_CONTROL_INTERVAL_SECONDS", env.TRTC_ROOM_CONTROL_INTERVAL_SECONDS, 15, 10, 300
  );
  const trtcRoomControlBatchSize = boundedInteger(
    "TRTC_ROOM_CONTROL_BATCH_SIZE", env.TRTC_ROOM_CONTROL_BATCH_SIZE, 10, 1, 10
  );
  const tencentCloudSecretId = optionalString(env.TENCENTCLOUD_SECRET_ID);
  const tencentCloudSecretKey = optionalString(env.TENCENTCLOUD_SECRET_KEY);
  const tencentCloudSecurityToken = optionalString(env.TENCENTCLOUD_SECURITY_TOKEN);
  if (trtcEnabled) {
    if (!trtcPrivacyDisclosureApproved || !trtcPrivacyDisclosureReference) {
      throw new Error(
        "TRTC_ENABLED=true requires TRTC_PRIVACY_DISCLOSURE_APPROVED=true and TRTC_PRIVACY_DISCLOSURE_REFERENCE"
      );
    }
    if (!trtcSdkAppId || !trtcSdkSecretKey || !trtcCallbackSigningKey || !trtcPrivateMapKeyEnabled || !trtcRoomControlEnabled) {
      throw new Error(
        "TRTC_ENABLED=true requires TRTC_SDK_APP_ID, TRTC_SDK_SECRET_KEY, TRTC_CALLBACK_SIGNING_KEY, TRTC_PRIVATE_MAP_KEY_ENABLED=true and TRTC_ROOM_CONTROL_ENABLED=true"
      );
    }
    if (trtcSdkSecretKey.length < 16) {
      throw new Error("TRTC_SDK_SECRET_KEY is unexpectedly short");
    }
    if (!/^[A-Za-z0-9]{16,32}$/.test(trtcCallbackSigningKey)) {
      throw new Error("TRTC_CALLBACK_SIGNING_KEY must contain 16 to 32 ASCII letters or digits");
    }
    if (appEnv === "production") {
      assertProductionValue("TRTC_SDK_SECRET_KEY", trtcSdkSecretKey);
      assertProductionValue("TRTC_CALLBACK_SIGNING_KEY", trtcCallbackSigningKey);
    }
  }
  if (trtcRoomControlEnabled) {
    if (!trtcEnabled || !tencentCloudSecretId || !tencentCloudSecretKey) {
      throw new Error(
        "TRTC_ROOM_CONTROL_ENABLED=true requires TRTC_ENABLED=true, TENCENTCLOUD_SECRET_ID and TENCENTCLOUD_SECRET_KEY"
      );
    }
    if (tencentCloudSecretId.length < 16 || tencentCloudSecretKey.length < 16) {
      throw new Error("TENCENTCLOUD_SECRET_ID and TENCENTCLOUD_SECRET_KEY are unexpectedly short");
    }
    if (appEnv === "production") {
      assertProductionValue("TENCENTCLOUD_SECRET_ID", tencentCloudSecretId);
      assertProductionValue("TENCENTCLOUD_SECRET_KEY", tencentCloudSecretKey);
      if (tencentCloudSecurityToken) assertProductionValue("TENCENTCLOUD_SECURITY_TOKEN", tencentCloudSecurityToken);
    }
  }
  if (trtcEmergencyStopEnabled && (!trtcEnabled || !trtcRoomControlEnabled)) {
    throw new Error(
      "TRTC_EMERGENCY_STOP_ENABLED=true requires TRTC_ENABLED=true and TRTC_ROOM_CONTROL_ENABLED=true"
    );
  }

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
    JWT_ACCESS_TTL: jwtAccessTtl,
    JWT_REFRESH_TTL: jwtRefreshTtl,
    AUTH_IDENTITY_TOMBSTONE_HMAC_KEYS: authIdentityTombstoneHmacKeys,
    AUTH_IDENTITY_TOMBSTONE_ACTIVE_KEY_ID: authIdentityTombstoneActiveKeyId,
    AUTH_IDENTITY_REREGISTRATION_POLICY: "after_tombstone_expiry",
    REVIEW_JWT_ACCESS_SECRET: reviewJwtAccessSecret,
    REVIEW_JWT_REFRESH_SECRET: reviewJwtRefreshSecret,
    REVIEW_JWT_ACCESS_TTL: env.REVIEW_JWT_ACCESS_TTL?.trim() || "15m",
    REVIEW_JWT_REFRESH_TTL: env.REVIEW_JWT_REFRESH_TTL?.trim() || "8h",
    SMS_CODE_TTL_SECONDS: positiveInteger("SMS_CODE_TTL_SECONDS", env.SMS_CODE_TTL_SECONDS, 300),
    EXTERNAL_AI_USER_CONTENT_ENABLED: externalAiUserContentEnabled,
    MEDIA_FEATURE_ENABLED: mediaFeatureEnabled,
    MEDIA_PROVIDER: mediaProvider,
    TRTC_ENABLED: trtcEnabled,
    TRTC_SDK_APP_ID: trtcSdkAppId,
    TRTC_SDK_SECRET_KEY: trtcSdkSecretKey,
    TRTC_CALLBACK_SIGNING_KEY: trtcCallbackSigningKey,
    TRTC_PRIVATE_MAP_KEY_ENABLED: trtcPrivateMapKeyEnabled,
    TRTC_USER_SIG_TTL_SECONDS: trtcUserSigTtlSeconds,
    TRTC_PRIVACY_DISCLOSURE_APPROVED: trtcPrivacyDisclosureApproved,
    TRTC_PRIVACY_DISCLOSURE_REFERENCE: trtcPrivacyDisclosureReference,
    TRTC_ROOM_CONTROL_ENABLED: trtcRoomControlEnabled,
    TRTC_EMERGENCY_STOP_ENABLED: trtcEmergencyStopEnabled,
    TRTC_CONTROL_REGION: trtcControlRegion,
    TRTC_CONTROL_TIMEOUT_MS: trtcControlTimeoutMs,
    TRTC_ROOM_CONTROL_INTERVAL_SECONDS: trtcRoomControlIntervalSeconds,
    TRTC_ROOM_CONTROL_BATCH_SIZE: trtcRoomControlBatchSize,
    TENCENTCLOUD_SECRET_ID: tencentCloudSecretId,
    TENCENTCLOUD_SECRET_KEY: tencentCloudSecretKey,
    TENCENTCLOUD_SECURITY_TOKEN: tencentCloudSecurityToken,
    WECHAT_PAY_APP_ID: optionalString(env.WECHAT_PAY_APP_ID),
    WECHAT_PAY_MCH_ID: wechatPayMchId,
    WECHAT_PAY_API_V3_KEY: wechatPayApiV3Key,
    WECHAT_PAY_PRIVATE_KEY: wechatPayPrivateKey,
    WECHAT_PAY_PRIVATE_KEY_PATH: wechatPayPrivateKeyPath,
    WECHAT_PAY_CERT_SERIAL_NO: wechatPayCertSerialNo,
    WECHAT_PAY_NOTIFY_BASE_URL: wechatPayNotifyBaseUrl,
    WECHAT_PAY_COMPLAINTS_ENABLED: wechatPayComplaintsEnabled,
    WECHAT_PAY_COMPLAINT_POLL_INTERVAL_SECONDS: wechatPayComplaintPollIntervalSeconds,
    WECHAT_PAY_COMPLAINT_BATCH_SIZE: wechatPayComplaintBatchSize,
    WECHAT_MINIPROGRAM_APP_ID: miniProgramAppId,
    WECHAT_MINIPROGRAM_APP_SECRET: miniProgramAppSecret,
    APPLE_SIGN_IN_BUNDLE_ID: optionalString(env.APPLE_SIGN_IN_BUNDLE_ID),
    SMS_PROVIDER: smsProvider,
    STAFF_TOTP_ENCRYPTION_KEY: staffTotpEncryptionKey,
    REVIEW_TOTP_ENCRYPTION_KEY: reviewTotpEncryptionKey,
    RATE_LIMIT_PER_MINUTE: positiveInteger("RATE_LIMIT_PER_MINUTE", env.RATE_LIMIT_PER_MINUTE, 120),
    BODY_SIZE_LIMIT: env.BODY_SIZE_LIMIT?.trim() || "1mb",
    SEED_ON_STARTUP: seedOnStartup,
    PAYMENT_RECONCILIATION_ENABLED: paymentReconciliationEnabled,
    PAYMENT_RECONCILIATION_INTERVAL_SECONDS: paymentReconciliationIntervalSeconds,
    PAYMENT_RECONCILIATION_BATCH_SIZE: paymentReconciliationBatchSize,
    WECHAT_DAILY_BILL_RECONCILIATION_ENABLED: wechatDailyBillReconciliationEnabled,
    WECHAT_DAILY_BILL_RECONCILIATION_APPROVED: wechatDailyBillReconciliationApproved,
    WECHAT_DAILY_BILL_RECONCILIATION_APPROVAL_REFERENCE: wechatDailyBillReconciliationApprovalReference,
    WECHAT_DAILY_BILL_RECONCILIATION_START_DATE: wechatDailyBillReconciliationStartDate,
    WECHAT_DAILY_BILL_RECONCILIATION_HOUR: wechatDailyBillReconciliationHour,
    WECHAT_DAILY_BILL_RECONCILIATION_BATCH_SIZE: wechatDailyBillReconciliationBatchSize,
    ORDER_RESCHEDULE_EXPIRY_ENABLED: orderRescheduleExpiryEnabled,
    ORDER_RESCHEDULE_EXPIRY_INTERVAL_SECONDS: orderRescheduleExpiryIntervalSeconds,
    ORDER_RESCHEDULE_EXPIRY_BATCH_SIZE: orderRescheduleExpiryBatchSize,
    METRICS_TOKEN: metricsToken,
    MOCK_WECHAT_NOTIFY_SECRET: mockWechatNotifySecret,
    LEGAL_CONSENT_VERSION: legalConsentVersion,
    LEGAL_CONSENT_EFFECTIVE_DATE: legalConsentEffectiveDate,
    LEGAL_PRIVACY_URL: legalPrivacyUrl,
    LEGAL_TERMS_URL: legalTermsUrl,
    LEGAL_PLATFORM_RULES_URL: legalPlatformRulesUrl,
    LEGAL_OPERATOR_NAME: legalOperatorName,
    LEGAL_CONTACT_EMAIL: legalContactEmail,
    LEGAL_CONTACT_PHONE: legalContactPhone,
    LEGAL_COMPLAINT_CHANNEL: legalComplaintChannel,
    LEGAL_PRIVACY_RETENTION_DAYS: legalPrivacyRetentionDays,
    ACCOUNT_DELETION_RETENTION_POLICY_APPROVED: accountDeletionRetentionPolicyApproved,
    ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE: accountDeletionRetentionPolicyApprovalReference,
    ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_APPROVED: accountDataRetentionLegalHoldPolicyApproved,
    ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_VERSION: accountDataRetentionLegalHoldPolicyVersion,
    ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_APPROVAL_REFERENCE:
      accountDataRetentionLegalHoldPolicyApprovalReference,
    ACCOUNT_DATA_RETENTION_LEGAL_HOLD_REASON_CODES_JSON:
      accountDataRetentionLegalHoldReasonCodesJson,
    CRISIS_RESOURCES_APPROVED: crisisResourcesApproved,
    CRISIS_RESOURCES_APPROVAL_REFERENCE: crisisResourcesApprovalReference,
    COMMERCIAL_RELEASE_MODE: commercialReleaseMode,
    COMPANION_VOICE_EVIDENCE_VIEWER_URL: companionVoiceEvidenceViewerUrl,
    COMPANION_VOICE_EVIDENCE_SIGNING_SECRET: companionVoiceEvidenceSigningSecret,
    COMPANION_VOICE_EVIDENCE_URL_TTL_SECONDS: companionVoiceEvidenceUrlTtlSeconds,
    PLATFORM_FEE_BPS: platformFeeBps,
    COMPANION_SETTLEMENT_HOLD_HOURS: companionSettlementHoldHours,
    REFUND_POLICY_VERSION: refundPolicyVersion,
    REFUND_POLICY_APPROVED: refundPolicyApproved,
    REFUND_POLICY_APPROVAL_REFERENCE: refundPolicyApprovalReference,
    REFUND_REQUEST_WINDOW_HOURS: refundRequestWindowHours,
    REFUND_REVIEW_SLA_HOURS: refundReviewSlaHours,
    REFUND_RESOLUTION_SLA_HOURS: refundResolutionSlaHours,
    ORDER_RESPONSE_WINDOW_MINUTES: orderResponseWindowMinutes,
    ORDER_CHAT_PRE_SERVICE_WINDOW_MINUTES: orderChatPreServiceWindowMinutes,
    ORDER_CHAT_POST_SERVICE_WINDOW_MINUTES: orderChatPostServiceWindowMinutes,
    ORDER_RESCHEDULE_RESPONSE_WINDOW_MINUTES: orderRescheduleResponseWindowMinutes,
    ORDER_MAX_SCHEDULE_DAYS: orderMaxScheduleDays,
    ORDER_INTAKE_ENABLED: orderIntakeEnabled,
    ORDER_MAX_OPEN_TOTAL: orderMaxOpenTotal,
    ORDER_MAX_OPEN_PER_USER: orderMaxOpenPerUser,
    ORDER_MAX_PENDING_PER_COMPANION: orderMaxPendingPerCompanion,
    PAYOUT_CLAIMS_ENABLED: payoutClaimsEnabled,
    SUPPORT_RESPONSE_HOURS: supportResponseHours,
    SUPPORT_MAX_OPEN_PER_USER: supportMaxOpenPerUser,
    SUPPORT_PUBLIC_SERVICE_HOURS: supportPublicServiceHours,
    SUPPORT_PUBLIC_STATUS_URL: supportPublicStatusUrl,
    DATA_EXPORT_DELIVERY_BASE_URL: dataExportDeliveryBaseUrl,
    DATA_EXPORT_DELIVERY_API_KEY: dataExportDeliveryApiKey,
    DATA_EXPORT_DELIVERY_TIMEOUT_MS: dataExportDeliveryTimeoutMs,
    DATA_EXPORT_MAX_BYTES: dataExportMaxBytes,
    COMPANION_APPEAL_SUBMISSION_DAYS: companionAppealSubmissionDays,
    COMPANION_APPEAL_RESPONSE_HOURS: companionAppealResponseHours,
    NOTIFICATION_DELIVERY_ENABLED: notificationDeliveryEnabled,
    NOTIFICATION_DELIVERY_INTERVAL_SECONDS: notificationDeliveryIntervalSeconds,
    NOTIFICATION_DELIVERY_BATCH_SIZE: notificationDeliveryBatchSize,
    AVAILABILITY_REMINDER_PREPARATION_ENABLED: availabilityReminderPreparationEnabled,
    AVAILABILITY_REMINDER_PREPARATION_INTERVAL_SECONDS: availabilityReminderPreparationIntervalSeconds,
    AVAILABILITY_REMINDER_PREPARATION_BATCH_SIZE: availabilityReminderPreparationBatchSize,
    AVAILABILITY_REMINDER_FANOUT_BATCH_SIZE: availabilityReminderFanoutBatchSize,
    AVAILABILITY_REMINDER_FANOUT_BATCHES_PER_RUN: availabilityReminderFanoutBatchesPerRun,
    AVAILABILITY_REMINDER_FANOUT_LEASE_SECONDS: availabilityReminderFanoutLeaseSeconds,
    AVAILABILITY_REMINDER_FANOUT_MAX_FAILURES: availabilityReminderFanoutMaxFailures,
    AVAILABILITY_REMINDER_FANOUT_RETRY_BASE_SECONDS: availabilityReminderFanoutRetryBaseSeconds,
    AVAILABILITY_REMINDER_DELIVERY_ENABLED: availabilityReminderDeliveryEnabled,
    AVAILABILITY_REMINDER_DELIVERY_INTERVAL_SECONDS: availabilityReminderDeliveryIntervalSeconds,
    AVAILABILITY_REMINDER_DELIVERY_BATCH_SIZE: availabilityReminderDeliveryBatchSize,
    WECHAT_SUBSCRIBE_MESSAGES_ENABLED: wechatSubscribeMessagesEnabled,
    WECHAT_SUBSCRIBE_TEMPLATES: wechatSubscribeTemplates
  };
}

export const configuration = () => validateEnvironment(process.env);
