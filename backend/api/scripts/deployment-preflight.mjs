#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLACEHOLDER = /change[_-]?me|replace[_-]?me|example|your[_-]/i;
const PAY_REQUIRED_FIELDS = [
  "WECHAT_PAY_APP_ID",
  "WECHAT_PAY_MCH_ID",
  "WECHAT_PAY_API_V3_KEY",
  "WECHAT_PAY_CERT_SERIAL_NO",
  "WECHAT_PAY_NOTIFY_BASE_URL"
];
const PAY_KEY_FIELDS = ["WECHAT_PAY_PRIVATE_KEY", "WECHAT_PAY_PRIVATE_KEY_PATH"];
const PAY_FIELDS = [...PAY_REQUIRED_FIELDS, ...PAY_KEY_FIELDS];
const LEGAL_REQUIRED_FIELDS = [
  "LEGAL_CONSENT_VERSION",
  "LEGAL_CONSENT_EFFECTIVE_DATE",
  "LEGAL_OPERATOR_NAME",
  "LEGAL_CONTACT_EMAIL",
  "LEGAL_CONTACT_PHONE",
  "LEGAL_COMPLAINT_CHANNEL",
  "LEGAL_PRIVACY_URL",
  "LEGAL_TERMS_URL",
  "LEGAL_PLATFORM_RULES_URL",
  "LEGAL_PRIVACY_RETENTION_DAYS"
];
const REQUIRED_TRANSACTIONAL_TEMPLATE_KEYS = [
  "newOrder", "orderConfirmed", "orderRejected", "orderResponseExpired", "paymentSuccess",
  "serviceStarted", "serviceCompleted", "orderCancelled", "reservationExpired", "supportUpdate"
];

export function parseEnv(text) {
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

function validUrl(value, protocols) {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function validateDeploymentConfig(env) {
  const errors = [];
  const production = env.APP_ENV === "production";
  const required = [
    "NODE_ENV", "APP_ENV", "API_PREFIX", "DATABASE_URL", "REDIS_URL", "CORS_ORIGINS",
    "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "WECHAT_MINIPROGRAM_APP_ID",
    "WECHAT_MINIPROGRAM_APP_SECRET"
  ];
  if (production) {
    required.push(
      ...PAY_REQUIRED_FIELDS,
      ...LEGAL_REQUIRED_FIELDS,
      "METRICS_TOKEN",
      "STAFF_TOTP_ENCRYPTION_KEY",
      "DEEPSEEK_API_KEY",
      "DEEPSEEK_URL",
      "DEEPSEEK_MODEL",
      "COMMERCIAL_RELEASE_MODE",
      "PLATFORM_FEE_BPS",
      "COMPANION_SETTLEMENT_HOLD_HOURS",
      "REFUND_REQUEST_WINDOW_HOURS",
      "ORDER_RESPONSE_WINDOW_MINUTES",
      "ORDER_MAX_SCHEDULE_DAYS",
      "ORDER_INTAKE_ENABLED",
      "ORDER_MAX_OPEN_TOTAL",
      "ORDER_MAX_OPEN_PER_USER",
      "ORDER_MAX_PENDING_PER_COMPANION",
      "PAYOUT_CLAIMS_ENABLED",
      "SUPPORT_RESPONSE_HOURS",
      "SUPPORT_MAX_OPEN_PER_USER",
      "NOTIFICATION_DELIVERY_ENABLED",
      "WECHAT_SUBSCRIBE_MESSAGES_ENABLED",
      "WECHAT_SUBSCRIBE_TEMPLATES_JSON",
      "PAYMENT_RECONCILIATION_ENABLED"
    );
  }

  for (const key of required) {
    const value = env[key]?.trim() ?? "";
    if (!value) errors.push(`${key} is required`);
    else if (PLACEHOLDER.test(value)) errors.push(`${key} still contains a placeholder`);
  }

  if (env.NODE_ENV !== "production") errors.push("NODE_ENV must be production for a deployed container");
  if (!['staging', 'production'].includes(env.APP_ENV)) errors.push("APP_ENV must be staging or production");
  if (env.API_PREFIX !== "api/v1") errors.push("API_PREFIX must remain api/v1");

  if (env.DATABASE_URL && !validUrl(env.DATABASE_URL, ["postgres:", "postgresql:"])) {
    errors.push("DATABASE_URL must be a PostgreSQL URL");
  }
  if (env.REDIS_URL && !validUrl(env.REDIS_URL, ["redis:", "rediss:"])) {
    errors.push("REDIS_URL must be a Redis URL");
  }
  if (production && env.REDIS_URL) {
    try {
      if (!new URL(env.REDIS_URL).password) errors.push("production REDIS_URL must include a password");
    } catch {
      // URL format is reported above.
    }
  }
  if (production && env.DEEPSEEK_URL && !validUrl(env.DEEPSEEK_URL, ["https:"])) {
    errors.push("DEEPSEEK_URL must be an HTTPS URL in production");
  }

  for (const key of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"]) {
    if (env[key] && env[key].length < 32) errors.push(`${key} must be at least 32 characters`);
  }
  for (const key of ["METRICS_TOKEN", "STAFF_TOTP_ENCRYPTION_KEY"]) {
    if (production && env[key] && env[key].length < 32) errors.push(`${key} must be at least 32 characters`);
  }
  if (production && env.DEEPSEEK_API_KEY && env.DEEPSEEK_API_KEY.length < 24) {
    errors.push("DEEPSEEK_API_KEY must be at least 24 characters");
  }
  if (env.JWT_ACCESS_SECRET && env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    errors.push("JWT access and refresh secrets must be different");
  }

  for (const origin of (env.CORS_ORIGINS ?? "").split(",").map((item) => item.trim()).filter(Boolean)) {
    if (!validUrl(origin, ["https:"])) errors.push("every deployed CORS_ORIGINS entry must use HTTPS");
  }

  if (env.WECHAT_MINIPROGRAM_APP_ID && !/^wx[0-9a-zA-Z]{10,}$/.test(env.WECHAT_MINIPROGRAM_APP_ID)) {
    errors.push("WECHAT_MINIPROGRAM_APP_ID must look like a WeChat AppID");
  }
  if (production && env.WECHAT_PAY_APP_ID && !/^wx[0-9a-zA-Z]{10,}$/.test(env.WECHAT_PAY_APP_ID)) {
    errors.push("WECHAT_PAY_APP_ID must look like a WeChat AppID");
  }
  if (env.WECHAT_MINIPROGRAM_APP_SECRET && env.WECHAT_MINIPROGRAM_APP_SECRET.length < 16) {
    errors.push("WECHAT_MINIPROGRAM_APP_SECRET is unexpectedly short");
  }
  if (production && env.WECHAT_PAY_MCH_ID && !/^\d{6,32}$/.test(env.WECHAT_PAY_MCH_ID)) {
    errors.push("WECHAT_PAY_MCH_ID must contain 6-32 digits");
  }

  const configuredPayFields = PAY_FIELDS.filter((key) => Boolean(env[key]?.trim()));
  const hasPayKey = PAY_KEY_FIELDS.some((key) => Boolean(env[key]?.trim()));
  if (production && !hasPayKey) {
    errors.push("WECHAT_PAY_PRIVATE_KEY or WECHAT_PAY_PRIVATE_KEY_PATH is required");
  }
  if (!production && configuredPayFields.length > 0) {
    const missingRequiredPayFields = PAY_REQUIRED_FIELDS.filter((key) => !env[key]?.trim());
    if (missingRequiredPayFields.length > 0 || !hasPayKey) {
      errors.push("staging WeChat Pay fields must be configured all together or all left empty for Mock");
    }
  }
  for (const key of configuredPayFields) {
    if (PLACEHOLDER.test(env[key])) errors.push(`${key} still contains a placeholder`);
  }
  if (env.WECHAT_PAY_API_V3_KEY && env.WECHAT_PAY_API_V3_KEY.length !== 32) {
    errors.push("WECHAT_PAY_API_V3_KEY must be exactly 32 characters");
  }
  if (env.WECHAT_PAY_PRIVATE_KEY_PATH && !env.WECHAT_PAY_PRIVATE_KEY_PATH.startsWith("/")) {
    errors.push("WECHAT_PAY_PRIVATE_KEY_PATH must be an absolute container path");
  }
  if (
    env.WECHAT_PAY_PRIVATE_KEY &&
    !/-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(env.WECHAT_PAY_PRIVATE_KEY.replace(/\\n/g, "\n"))
  ) {
    errors.push("WECHAT_PAY_PRIVATE_KEY must contain a PEM private key");
  }
  if (env.WECHAT_PAY_NOTIFY_BASE_URL && !validUrl(env.WECHAT_PAY_NOTIFY_BASE_URL, ["https:"])) {
    errors.push("WECHAT_PAY_NOTIFY_BASE_URL must use HTTPS");
  }

  for (const key of ["LEGAL_PRIVACY_URL", "LEGAL_TERMS_URL", "LEGAL_PLATFORM_RULES_URL"]) {
    if (env[key] && !validUrl(env[key], ["https:"])) errors.push(`${key} must use HTTPS`);
  }
  if (env.LEGAL_CONTACT_EMAIL && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.LEGAL_CONTACT_EMAIL)) {
    errors.push("LEGAL_CONTACT_EMAIL must be a valid email address");
  }
  if (env.LEGAL_CONSENT_EFFECTIVE_DATE && (!/^\d{4}-\d{2}-\d{2}$/.test(env.LEGAL_CONSENT_EFFECTIVE_DATE) || Number.isNaN(Date.parse(`${env.LEGAL_CONSENT_EFFECTIVE_DATE}T00:00:00Z`)))) {
    errors.push("LEGAL_CONSENT_EFFECTIVE_DATE must use YYYY-MM-DD");
  }
  for (const key of ["LEGAL_PRIVACY_RETENTION_DAYS", "PLATFORM_FEE_BPS", "COMPANION_SETTLEMENT_HOLD_HOURS", "REFUND_REQUEST_WINDOW_HOURS", "ORDER_RESPONSE_WINDOW_MINUTES", "ORDER_MAX_SCHEDULE_DAYS", "ORDER_MAX_OPEN_TOTAL", "ORDER_MAX_OPEN_PER_USER", "ORDER_MAX_PENDING_PER_COMPANION", "SUPPORT_RESPONSE_HOURS", "SUPPORT_MAX_OPEN_PER_USER"]) {
    if (env[key] && !/^\d+$/.test(env[key])) errors.push(`${key} must be an integer`);
  }
  for (const key of ["ORDER_MAX_OPEN_TOTAL", "ORDER_MAX_OPEN_PER_USER", "ORDER_MAX_PENDING_PER_COMPANION", "SUPPORT_MAX_OPEN_PER_USER"]) {
    if (env[key] && /^\d+$/.test(env[key]) && Number(env[key]) < 1) errors.push(`${key} must be at least 1`);
  }
  if (
    env.ORDER_MAX_SCHEDULE_DAYS && /^\d+$/.test(env.ORDER_MAX_SCHEDULE_DAYS) &&
    (Number(env.ORDER_MAX_SCHEDULE_DAYS) < 1 || Number(env.ORDER_MAX_SCHEDULE_DAYS) > 365)
  ) {
    errors.push("ORDER_MAX_SCHEDULE_DAYS must be between 1 and 365");
  }
  if (env.PLATFORM_FEE_BPS && (Number(env.PLATFORM_FEE_BPS) < 0 || Number(env.PLATFORM_FEE_BPS) > 10000)) {
    errors.push("PLATFORM_FEE_BPS must be between 0 and 10000");
  }
  if (
    env.COMMERCIAL_RELEASE_MODE === "commercial" &&
    Number(env.COMPANION_SETTLEMENT_HOLD_HOURS) < Number(env.REFUND_REQUEST_WINDOW_HOURS) + 24
  ) {
    errors.push("COMPANION_SETTLEMENT_HOLD_HOURS must be at least REFUND_REQUEST_WINDOW_HOURS + 24");
  }
  if (production && env.COMMERCIAL_RELEASE_MODE !== "commercial") {
    errors.push("COMMERCIAL_RELEASE_MODE must be commercial in production");
  }
  for (const key of ["ORDER_INTAKE_ENABLED", "PAYOUT_CLAIMS_ENABLED"]) {
    if (production && !["true", "false"].includes(env[key])) errors.push(`${key} must be true or false in production`);
  }
  if (production && env.NOTIFICATION_DELIVERY_ENABLED !== "true") {
    errors.push("NOTIFICATION_DELIVERY_ENABLED must be true in production");
  }
  if (production && env.WECHAT_SUBSCRIBE_MESSAGES_ENABLED !== "true") {
    errors.push("WECHAT_SUBSCRIBE_MESSAGES_ENABLED must be true in production");
  }
  if (production && env.PAYMENT_RECONCILIATION_ENABLED !== "true") {
    errors.push("PAYMENT_RECONCILIATION_ENABLED must be true in production");
  }
  if (env.WECHAT_SUBSCRIBE_TEMPLATES_JSON) {
    try {
      const templates = JSON.parse(env.WECHAT_SUBSCRIBE_TEMPLATES_JSON);
      if (!Array.isArray(templates) || templates.length === 0) {
        errors.push("WECHAT_SUBSCRIBE_TEMPLATES_JSON must be a non-empty JSON array");
      } else {
        const keys = new Set();
        const templateIds = new Set();
        for (const template of templates) {
          if (!template || typeof template !== "object" || !template.key || !template.templateId || !template.data || typeof template.data !== "object") {
            errors.push("WECHAT_SUBSCRIBE_TEMPLATES_JSON contains an invalid template");
            break;
          }
          if (keys.has(template.key)) {
            errors.push("WECHAT_SUBSCRIBE_TEMPLATES_JSON template keys must be unique");
            break;
          }
          if (templateIds.has(template.templateId)) {
            errors.push("WECHAT_SUBSCRIBE_TEMPLATES_JSON template IDs must be unique");
            break;
          }
          keys.add(template.key);
          templateIds.add(template.templateId);
        }
        if (production) {
          const missing = REQUIRED_TRANSACTIONAL_TEMPLATE_KEYS.filter((key) => !keys.has(key));
          if (missing.length) errors.push(`WECHAT_SUBSCRIBE_TEMPLATES_JSON is missing event keys: ${missing.join(", ")}`);
        }
      }
    } catch {
      errors.push("WECHAT_SUBSCRIBE_TEMPLATES_JSON must be valid JSON");
    }
  }

  if (production && env.SEED_ON_STARTUP !== "false") errors.push("production SEED_ON_STARTUP must be false");
  if (production && env.SMS_PROVIDER === "mock") errors.push("production SMS_PROVIDER cannot be mock");

  return [...new Set(errors)];
}

function extractQuotedProperty(source, property) {
  const match = source.match(new RegExp(`${property}\\s*:\\s*["']([^"']+)["']`));
  return match?.[1] ?? "";
}

function extractExportedString(source, name) {
  const match = source.match(new RegExp(`export\\s+const\\s+${name}\\s*=\\s*["']([^"']+)["']`));
  return match?.[1] ?? "";
}

export function validateMiniProgramReleaseConfig(env, source) {
  if (env.APP_ENV !== "production") return [];
  const errors = [];
  const releaseBackend = extractQuotedProperty(source, "release");
  const privacyUrl = extractQuotedProperty(source, "privacy");
  const termsUrl = extractQuotedProperty(source, "terms");
  const consentVersion = extractExportedString(source, "LEGAL_CONSENT_VERSION");
  const expectedBackend = `${(env.WECHAT_PAY_NOTIFY_BASE_URL ?? "").replace(/\/+$/, "")}/${env.API_PREFIX ?? "api/v1"}`;
  if (!releaseBackend || releaseBackend !== expectedBackend) {
    errors.push(`Mini Program release backend must equal ${expectedBackend}`);
  }
  if (!privacyUrl || privacyUrl !== env.LEGAL_PRIVACY_URL) {
    errors.push("Mini Program privacy URL must equal LEGAL_PRIVACY_URL");
  }
  if (!termsUrl || termsUrl !== env.LEGAL_TERMS_URL) {
    errors.push("Mini Program terms URL must equal LEGAL_TERMS_URL");
  }
  if (!consentVersion || consentVersion !== env.LEGAL_CONSENT_VERSION) {
    errors.push("Mini Program consent version must equal LEGAL_CONSENT_VERSION");
  }
  return errors;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: node scripts/deployment-preflight.mjs <environment-file>");
    process.exit(2);
  }
  const env = parseEnv(readFileSync(resolve(path), "utf8"));
  const repositoryRoot = resolve(fileURLToPath(import.meta.url), "../../../..");
  const miniProgramConfig = readFileSync(resolve(repositoryRoot, "frontend/miniprogram/utils/config.ts"), "utf8");
  const errors = [
    ...validateDeploymentConfig(env),
    ...validateMiniProgramReleaseConfig(env, miniProgramConfig)
  ];
  if (errors.length) {
    console.error(`Deployment preflight failed with ${errors.length} issue(s):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`Deployment preflight passed for ${env.APP_ENV} (secret values not printed)`);
}
