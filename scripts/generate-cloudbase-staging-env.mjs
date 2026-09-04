import { randomBytes } from "node:crypto";
import { access, chmod, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(repo, "backend/api/.env.cloudbase.staging");
const envId = "talk-and-talk-staging-d6d04a14b8";
const appId = "wx118721bab077fbbb";
const staticOrigin = "https://talk-and-talk-staging-d6d04a14b8-1428040864.tcloudbaseapp.com";

try {
  await access(output, constants.F_OK);
  throw new Error(`${output} already exists; preserve deployed secrets instead of rotating them`);
} catch (error) {
  if ((error).code !== "ENOENT") throw error;
}

const secret = () => randomBytes(48).toString("base64url");
const tombstoneKey = randomBytes(48).toString("base64");
const values = {
  NODE_ENV: "production",
  APP_ENV: "staging",
  HOST: "0.0.0.0",
  PORT: "3000",
  API_PREFIX: "api/v1",
  APP_VERSION: "1.0.0",
  SECURITY_COUNTER_BACKEND: "postgres",
  CLOUDBASE_MANAGED_MIGRATIONS: "true",
  CLOUDBASE_RUNTIME_PG_INJECTION: "true",
  CORS_ORIGINS: staticOrigin,
  JWT_ACCESS_SECRET: secret(),
  JWT_REFRESH_SECRET: secret(),
  JWT_ACCESS_TTL: "15m",
  JWT_REFRESH_TTL: "30d",
  AUTH_IDENTITY_TOMBSTONE_HMAC_KEYS: JSON.stringify({ "cloudbase-v1": tombstoneKey }),
  AUTH_IDENTITY_TOMBSTONE_ACTIVE_KEY_ID: "cloudbase-v1",
  AUTH_IDENTITY_REREGISTRATION_POLICY: "after_tombstone_expiry",
  REVIEW_JWT_ACCESS_SECRET: secret(),
  REVIEW_JWT_REFRESH_SECRET: secret(),
  REVIEW_JWT_ACCESS_TTL: "15m",
  REVIEW_JWT_REFRESH_TTL: "8h",
  METRICS_TOKEN: secret(),
  STAFF_TOTP_ENCRYPTION_KEY: secret(),
  REVIEW_TOTP_ENCRYPTION_KEY: secret(),
  WECHAT_MINIPROGRAM_APP_ID: appId,
  WECHAT_CLOUDBASE_HEADER_AUTH_ENABLED: "true",
  CLOUDBASE_ENV_ID: envId,
  CLOUDBASE_MINIAPP_ONLY: "true",
  SMS_PROVIDER: "none",
  EXTERNAL_AI_USER_CONTENT_ENABLED: "false",
  MEDIA_FEATURE_ENABLED: "false",
  MEDIA_PROVIDER: "disabled",
  TRTC_ENABLED: "false",
  TRTC_ROOM_CONTROL_ENABLED: "false",
  TRTC_EMERGENCY_STOP_ENABLED: "false",
  COMMERCIAL_SURFACE: "text_only",
  COMMERCIAL_RELEASE_MODE: "commercial",
  PLATFORM_FEE_BPS: "0",
  REFUND_POLICY_VERSION: "2026.09-v1",
  REFUND_POLICY_APPROVED: "true",
  REFUND_POLICY_APPROVAL_REFERENCE: "owner-v1-launch-2026-09-04",
  REFUND_REQUEST_WINDOW_HOURS: "72",
  REFUND_REVIEW_SLA_HOURS: "24",
  REFUND_RESOLUTION_SLA_HOURS: "72",
  ORDER_INTAKE_ENABLED: "true",
  ORDER_RESPONSE_WINDOW_MINUTES: "10",
  ORDER_CHAT_PRE_SERVICE_WINDOW_MINUTES: "15",
  ORDER_CHAT_POST_SERVICE_WINDOW_MINUTES: "15",
  ORDER_MAX_SCHEDULE_DAYS: "30",
  ORDER_MAX_OPEN_TOTAL: "500",
  ORDER_MAX_OPEN_PER_USER: "3",
  ORDER_MAX_PENDING_PER_COMPANION: "20",
  RATE_LIMIT_PER_MINUTE: "120",
  BODY_SIZE_LIMIT: "1mb",
  LEGAL_CONSENT_VERSION: "2.2-2026-08-01",
  LEGAL_CONSENT_EFFECTIVE_DATE: "2026-08-01",
  LEGAL_PRIVACY_URL: `${staticOrigin}/legal/privacy.html`,
  LEGAL_TERMS_URL: `${staticOrigin}/legal/terms.html`,
  LEGAL_PLATFORM_RULES_URL: `${staticOrigin}/legal/terms.html`,
  LEGAL_PRIVACY_RETENTION_DAYS: "1095",
  ACCOUNT_DATA_RETENTION_LEGAL_HOLD_REASON_CODES_JSON: "[]",
  CRISIS_RESOURCES_APPROVED: "true",
  CRISIS_RESOURCES_APPROVAL_REFERENCE: "owner-v1-launch-2026-09-04",
  PAYMENT_RECONCILIATION_ENABLED: "false",
  WECHAT_DAILY_BILL_RECONCILIATION_ENABLED: "false",
  WECHAT_PAY_COMPLAINTS_ENABLED: "false",
  NOTIFICATION_DELIVERY_ENABLED: "false",
  WECHAT_SUBSCRIBE_MESSAGES_ENABLED: "false",
  AVAILABILITY_REMINDER_PREPARATION_ENABLED: "false",
  AVAILABILITY_REMINDER_DELIVERY_ENABLED: "false",
  COMPANION_ACTION_EXPIRY_ENABLED: "true",
  SEED_ON_STARTUP: "true"
};

const lines = [
  "# Generated locally for Talk&Talk v1.0 CloudBase staging. Do not commit.",
  ...Object.entries(values).map(([key, value]) => `${key}=${value}`),
  ""
];
await writeFile(output, lines.join("\n"), { mode: 0o600 });
await chmod(output, 0o600);
process.stdout.write(`${JSON.stringify({ output, keys: Object.keys(values).length, mode: "0600" })}\n`);
