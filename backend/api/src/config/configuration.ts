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
  REVIEW_JWT_ACCESS_SECRET: string;
  REVIEW_JWT_REFRESH_SECRET: string;
  REVIEW_JWT_ACCESS_TTL: string;
  REVIEW_JWT_REFRESH_TTL: string;
  SMS_CODE_TTL_SECONDS: number;
  DEEPSEEK_API_KEY: string;
  DEEPSEEK_URL: string;
  DEEPSEEK_MODEL: string;
  MEDIA_FEATURE_ENABLED: boolean;
  MEDIA_PROVIDER: string;
  TRTC_ENABLED: boolean;
  TRTC_SDK_APP_ID: number;
  TRTC_SDK_SECRET_KEY: string;
  TRTC_PRIVATE_MAP_KEY_ENABLED: boolean;
  TRTC_USER_SIG_TTL_SECONDS: number;
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
  ORDER_RESCHEDULE_EXPIRY_ENABLED: boolean;
  ORDER_RESCHEDULE_EXPIRY_INTERVAL_SECONDS: number;
  ORDER_RESCHEDULE_EXPIRY_BATCH_SIZE: number;
  METRICS_TOKEN: string;
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
  COMMERCIAL_RELEASE_MODE: CommercialReleaseMode;
  PLATFORM_FEE_BPS: number;
  COMPANION_SETTLEMENT_HOLD_HOURS: number;
  REFUND_REQUEST_WINDOW_HOURS: number;
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
  NOTIFICATION_DELIVERY_ENABLED: boolean;
  NOTIFICATION_DELIVERY_INTERVAL_SECONDS: number;
  NOTIFICATION_DELIVERY_BATCH_SIZE: number;
  AVAILABILITY_REMINDER_PREPARATION_ENABLED: boolean;
  AVAILABILITY_REMINDER_PREPARATION_INTERVAL_SECONDS: number;
  AVAILABILITY_REMINDER_PREPARATION_BATCH_SIZE: number;
  AVAILABILITY_REMINDER_DELIVERY_ENABLED: boolean;
  AVAILABILITY_REMINDER_DELIVERY_INTERVAL_SECONDS: number;
  AVAILABILITY_REMINDER_DELIVERY_BATCH_SIZE: number;
  WECHAT_SUBSCRIBE_MESSAGES_ENABLED: boolean;
  WECHAT_SUBSCRIBE_TEMPLATES: WeChatSubscribeTemplate[];
}

const DEFAULT_DATABASE_URL = "postgres://talk:talk@localhost:5432/talk_and_talk";
const DEFAULT_REDIS_URL = "redis://localhost:6379";
const DEFAULT_DEEPSEEK_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
const DEFAULT_LEGAL_CONSENT_VERSION = "2.0-2026-07-20";
const DEFAULT_LEGAL_CONSENT_EFFECTIVE_DATE = "2026-07-20";
// Retain these stable public URLs for existing Mini Program consent receipts;
// the static documents redirect to the server-rendered, configuration-backed
// legal endpoints below.
const DEFAULT_LEGAL_PRIVACY_URL = "https://api.talkandtalk.app/legal/privacy.html";
const DEFAULT_LEGAL_TERMS_URL = "https://api.talkandtalk.app/legal/terms.html";
const DEFAULT_LEGAL_PLATFORM_RULES_URL = "https://api.talkandtalk.app/api/v1/legal/platform-rules";
const DEVELOPMENT_OPERATOR_NAME = "Talk&Talk 开发环境运营方（不可用于对外发布）";
const REQUIRED_TRANSACTIONAL_TEMPLATE_KEYS = [
  "newOrder",
  "orderConfirmed",
  "orderRejected",
  "orderResponseExpired",
  "paymentSuccess",
  "serviceStarted",
  "serviceCompleted",
  "orderCancelled",
  "reservationExpired",
  "rescheduleRequested",
  "rescheduleAccepted",
  "rescheduleRejected",
  "rescheduleExpired",
  "rescheduleCancelled",
  "supportUpdate",
  "messageReceived"
] as const;
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
    assertProductionValue("REVIEW_JWT_ACCESS_SECRET", reviewJwtAccessSecret);
    assertProductionValue("REVIEW_JWT_REFRESH_SECRET", reviewJwtRefreshSecret);
    assertProductionValue("METRICS_TOKEN", metricsToken);
    assertProductionValue("DATABASE_URL", env.DATABASE_URL!.trim());
    assertProductionValue("REDIS_URL", env.REDIS_URL!.trim());
  }

  const deepseekApiKey = optionalString(env.DEEPSEEK_API_KEY);
  const deepseekUrl = requiredUrl("DEEPSEEK_URL", env.DEEPSEEK_URL, DEFAULT_DEEPSEEK_URL);
  const deepseekModel = env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL;
  if (appEnv === "production") {
    if (!deepseekApiKey || !env.DEEPSEEK_URL?.trim() || !env.DEEPSEEK_MODEL?.trim()) {
      throw new Error("DEEPSEEK_API_KEY, DEEPSEEK_URL and DEEPSEEK_MODEL are required for production content moderation");
    }
    if (deepseekApiKey.length < 24) {
      throw new Error("DEEPSEEK_API_KEY must contain at least 24 characters in production");
    }
    assertProductionValue("DEEPSEEK_API_KEY", deepseekApiKey);
    assertProductionValue("DEEPSEEK_MODEL", deepseekModel);
    if (new URL(deepseekUrl).protocol !== "https:") {
      throw new Error("DEEPSEEK_URL must be an absolute HTTPS URL in production");
    }
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
  const platformFeeBps = boundedInteger("PLATFORM_FEE_BPS", env.PLATFORM_FEE_BPS, 0, 0, 10_000);
  const companionSettlementHoldHours = boundedInteger(
    "COMPANION_SETTLEMENT_HOLD_HOURS",
    env.COMPANION_SETTLEMENT_HOLD_HOURS,
    96,
    1,
    24 * 30
  );
  const refundRequestWindowHours = boundedInteger(
    "REFUND_REQUEST_WINDOW_HOURS",
    env.REFUND_REQUEST_WINDOW_HOURS,
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
  if (legalContactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(legalContactEmail)) {
    throw new Error("LEGAL_CONTACT_EMAIL must be a valid email address when configured");
  }
  if (appEnv === "production") {
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
    for (const name of [
      "COMPANION_SETTLEMENT_HOLD_HOURS",
      "REFUND_REQUEST_WINDOW_HOURS",
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
      "SUPPORT_MAX_OPEN_PER_USER"
    ]) {
      if (env[name] === undefined || env[name]?.trim() === "") {
        throw new Error(`${name} must be explicitly configured in production`);
      }
    }
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
  const trtcPrivateMapKeyEnabled = parseBoolean(env.TRTC_PRIVATE_MAP_KEY_ENABLED, false);
  const trtcUserSigTtlSeconds = boundedInteger(
    "TRTC_USER_SIG_TTL_SECONDS", env.TRTC_USER_SIG_TTL_SECONDS, 300, 60, 900
  );
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
    if (!trtcSdkAppId || !trtcSdkSecretKey || !trtcPrivateMapKeyEnabled || !trtcRoomControlEnabled) {
      throw new Error(
        "TRTC_ENABLED=true requires TRTC_SDK_APP_ID, TRTC_SDK_SECRET_KEY, TRTC_PRIVATE_MAP_KEY_ENABLED=true and TRTC_ROOM_CONTROL_ENABLED=true"
      );
    }
    if (trtcSdkSecretKey.length < 16) {
      throw new Error("TRTC_SDK_SECRET_KEY is unexpectedly short");
    }
    if (appEnv === "production") {
      assertProductionValue("TRTC_SDK_SECRET_KEY", trtcSdkSecretKey);
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
    JWT_ACCESS_TTL: env.JWT_ACCESS_TTL?.trim() || "15m",
    JWT_REFRESH_TTL: env.JWT_REFRESH_TTL?.trim() || "30d",
    REVIEW_JWT_ACCESS_SECRET: reviewJwtAccessSecret,
    REVIEW_JWT_REFRESH_SECRET: reviewJwtRefreshSecret,
    REVIEW_JWT_ACCESS_TTL: env.REVIEW_JWT_ACCESS_TTL?.trim() || "15m",
    REVIEW_JWT_REFRESH_TTL: env.REVIEW_JWT_REFRESH_TTL?.trim() || "8h",
    SMS_CODE_TTL_SECONDS: positiveInteger("SMS_CODE_TTL_SECONDS", env.SMS_CODE_TTL_SECONDS, 300),
    DEEPSEEK_API_KEY: deepseekApiKey,
    DEEPSEEK_URL: deepseekUrl,
    DEEPSEEK_MODEL: deepseekModel,
    MEDIA_FEATURE_ENABLED: mediaFeatureEnabled,
    MEDIA_PROVIDER: mediaProvider,
    TRTC_ENABLED: trtcEnabled,
    TRTC_SDK_APP_ID: trtcSdkAppId,
    TRTC_SDK_SECRET_KEY: trtcSdkSecretKey,
    TRTC_PRIVATE_MAP_KEY_ENABLED: trtcPrivateMapKeyEnabled,
    TRTC_USER_SIG_TTL_SECONDS: trtcUserSigTtlSeconds,
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
    ORDER_RESCHEDULE_EXPIRY_ENABLED: orderRescheduleExpiryEnabled,
    ORDER_RESCHEDULE_EXPIRY_INTERVAL_SECONDS: orderRescheduleExpiryIntervalSeconds,
    ORDER_RESCHEDULE_EXPIRY_BATCH_SIZE: orderRescheduleExpiryBatchSize,
    METRICS_TOKEN: metricsToken,
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
    COMMERCIAL_RELEASE_MODE: commercialReleaseMode,
    PLATFORM_FEE_BPS: platformFeeBps,
    COMPANION_SETTLEMENT_HOLD_HOURS: companionSettlementHoldHours,
    REFUND_REQUEST_WINDOW_HOURS: refundRequestWindowHours,
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
    NOTIFICATION_DELIVERY_ENABLED: notificationDeliveryEnabled,
    NOTIFICATION_DELIVERY_INTERVAL_SECONDS: notificationDeliveryIntervalSeconds,
    NOTIFICATION_DELIVERY_BATCH_SIZE: notificationDeliveryBatchSize,
    AVAILABILITY_REMINDER_PREPARATION_ENABLED: availabilityReminderPreparationEnabled,
    AVAILABILITY_REMINDER_PREPARATION_INTERVAL_SECONDS: availabilityReminderPreparationIntervalSeconds,
    AVAILABILITY_REMINDER_PREPARATION_BATCH_SIZE: availabilityReminderPreparationBatchSize,
    AVAILABILITY_REMINDER_DELIVERY_ENABLED: availabilityReminderDeliveryEnabled,
    AVAILABILITY_REMINDER_DELIVERY_INTERVAL_SECONDS: availabilityReminderDeliveryIntervalSeconds,
    AVAILABILITY_REMINDER_DELIVERY_BATCH_SIZE: availabilityReminderDeliveryBatchSize,
    WECHAT_SUBSCRIBE_MESSAGES_ENABLED: wechatSubscribeMessagesEnabled,
    WECHAT_SUBSCRIBE_TEMPLATES: wechatSubscribeTemplates
  };
}

export const configuration = () => validateEnvironment(process.env);
