import assert from "node:assert/strict";
import test from "node:test";

import transactionalTemplateManifest from "../config/transactional-template-manifest.js";
import {
  parseEnv,
  REQUIRED_TRANSACTIONAL_TEMPLATE_KEYS,
  validateDeploymentConfig,
  validateMiniProgramReleaseConfig
} from "./deployment-preflight.mjs";

const legalHoldReasonCatalog = JSON.stringify([{
  code: "LITIGATION_NOTICE",
  actions: ["placement", "release"],
  categories: [
    "identity_authentication_profile",
    "preferences_behavior_notifications",
    "public_user_content",
    "transactions_tax_invoices",
    "support_disputes_safety",
    "consent_rights_account_governance",
    "deletion_audit_evidence"
  ]
}]);

function validProduction() {
  return {
    NODE_ENV: "production",
    APP_ENV: "production",
    API_PREFIX: "api/v1",
    DATABASE_URL: "postgresql://talk:strong-password@10.0.0.10:5432/talk_and_talk",
    REDIS_URL: "rediss://:strong-password@10.0.0.11:6379",
    CORS_ORIGINS: "https://api.talkandtalk.app",
    JWT_ACCESS_SECRET: "access-secret-that-is-longer-than-32-characters",
    JWT_REFRESH_SECRET: "refresh-secret-that-is-longer-than-32-characters",
    JWT_ACCESS_TTL: "15m",
    JWT_REFRESH_TTL: "30d",
    AUTH_IDENTITY_TOMBSTONE_HMAC_KEYS: JSON.stringify({
      "production-v1": Buffer.from("production-auth-tombstone-key-with-32-plus-bytes").toString("base64")
    }),
    AUTH_IDENTITY_TOMBSTONE_ACTIVE_KEY_ID: "production-v1",
    AUTH_IDENTITY_REREGISTRATION_POLICY: "after_tombstone_expiry",
    REVIEW_JWT_ACCESS_SECRET: "review-access-secret-that-is-longer-than-32-characters",
    REVIEW_JWT_REFRESH_SECRET: "review-refresh-secret-that-is-longer-than-32-characters",
    METRICS_TOKEN: "metrics-token-that-is-longer-than-32-characters",
    STAFF_TOTP_ENCRYPTION_KEY: "staff-totp-key-that-is-longer-than-32-characters",
    REVIEW_TOTP_ENCRYPTION_KEY: "review-totp-key-that-is-longer-than-32-characters",
    EXTERNAL_AI_USER_CONTENT_ENABLED: "false",
    WECHAT_MINIPROGRAM_APP_ID: "wx1234567890abcdef",
    WECHAT_MINIPROGRAM_APP_SECRET: "0123456789abcdef0123456789abcdef",
    WECHAT_PAY_APP_ID: "wx1234567890abcdef",
    WECHAT_PAY_MCH_ID: "1900000001",
    WECHAT_PAY_API_V3_KEY: "0123456789abcdef0123456789abcdef",
    WECHAT_PAY_PRIVATE_KEY_PATH: "/run/secrets/wechat_private_key.pem",
    WECHAT_PAY_CERT_SERIAL_NO: "ABCDEF123456",
    WECHAT_PAY_NOTIFY_BASE_URL: "https://api.talkandtalk.app",
    SMS_PROVIDER: "none",
    SEED_ON_STARTUP: "false",
    COMMERCIAL_RELEASE_MODE: "commercial",
    COMPANION_VOICE_EVIDENCE_VIEWER_URL: "https://evidence.talkandtalk.app/voice-intro",
    COMPANION_VOICE_EVIDENCE_SIGNING_SECRET: "voice-evidence-secret-that-is-longer-than-32-characters",
    COMPANION_VOICE_EVIDENCE_URL_TTL_SECONDS: "300",
    PLATFORM_FEE_BPS: "1200",
    COMPANION_SETTLEMENT_HOLD_HOURS: "96",
    REFUND_POLICY_VERSION: "2026.08-v1",
    REFUND_POLICY_APPROVED: "true",
    REFUND_POLICY_APPROVAL_REFERENCE: "legal:refund-policy-2026-08",
    REFUND_REQUEST_WINDOW_HOURS: "72",
    ORDER_RESPONSE_WINDOW_MINUTES: "10",
    ORDER_MAX_SCHEDULE_DAYS: "30",
    ORDER_INTAKE_ENABLED: "true",
    ORDER_MAX_OPEN_TOTAL: "500",
    ORDER_MAX_OPEN_PER_USER: "3",
    ORDER_MAX_PENDING_PER_COMPANION: "20",
    PAYOUT_CLAIMS_ENABLED: "true",
    SUPPORT_RESPONSE_HOURS: "24",
    SUPPORT_MAX_OPEN_PER_USER: "5",
    NOTIFICATION_DELIVERY_ENABLED: "true",
    WECHAT_SUBSCRIBE_MESSAGES_ENABLED: "true",
    WECHAT_SUBSCRIBE_TEMPLATES_JSON: JSON.stringify(transactionalTemplateManifest.map(({ key, defaultPage }) => ({
      key,
      templateId: `TEMPLATE_${key}_123456`,
      page: defaultPage,
      data: { thing1: "{{title}}" }
    }))),
    LEGAL_OPERATOR_NAME: "上海示例网络科技有限公司",
    LEGAL_CONSENT_VERSION: "2.2-2026-08-01",
    LEGAL_CONTACT_EMAIL: "privacy@talkandtalk.test",
    LEGAL_CONTACT_PHONE: "021-12345678",
    LEGAL_COMPLAINT_CHANNEL: "小程序内客服工单",
    LEGAL_PRIVACY_URL: "https://api.talkandtalk.app/legal/privacy.html",
    LEGAL_TERMS_URL: "https://api.talkandtalk.app/legal/terms.html",
    LEGAL_PLATFORM_RULES_URL: "https://api.talkandtalk.app/api/v1/legal/platform-rules",
    LEGAL_CONSENT_EFFECTIVE_DATE: "2026-08-01",
    LEGAL_PRIVACY_RETENTION_DAYS: "1095",
    ACCOUNT_DELETION_RETENTION_POLICY_APPROVED: "true",
    ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE: "legal:retention-approval-2026",
    ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_APPROVED: "true",
    ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_VERSION: "2026.08-v1",
    ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_APPROVAL_REFERENCE:
      "legal:retention-hold-policy-2026-08",
    ACCOUNT_DATA_RETENTION_LEGAL_HOLD_REASON_CODES_JSON: legalHoldReasonCatalog,
    CRISIS_RESOURCES_APPROVED: "true",
    CRISIS_RESOURCES_APPROVAL_REFERENCE: "safety:crisis-resources-2026-08-01",
    PAYMENT_RECONCILIATION_ENABLED: "true",
    WECHAT_DAILY_BILL_RECONCILIATION_ENABLED: "true",
    WECHAT_DAILY_BILL_RECONCILIATION_APPROVED: "true",
    WECHAT_DAILY_BILL_RECONCILIATION_APPROVAL_REFERENCE: "finance:wechat-daily-bill-sop-2026-08",
    WECHAT_DAILY_BILL_RECONCILIATION_START_DATE: "2026-07-01",
    WECHAT_DAILY_BILL_RECONCILIATION_HOUR: "10",
    WECHAT_DAILY_BILL_RECONCILIATION_BATCH_SIZE: "4",
    WECHAT_PAY_COMPLAINTS_ENABLED: "true",
    WECHAT_PAY_COMPLAINT_POLL_INTERVAL_SECONDS: "300",
    WECHAT_PAY_COMPLAINT_BATCH_SIZE: "50",
    TRTC_ENABLED: "false"
  };
}

test("parses quoted env values without exposing comments", () => {
  assert.deepEqual(parseEnv("# comment\nAPP_ENV='production'\nexport API_PREFIX=api/v1\n"), {
    APP_ENV: "production",
    API_PREFIX: "api/v1"
  });
});

test("accepts a complete production Mini Program deployment", () => {
  assert.deepEqual(validateDeploymentConfig(validProduction()), []);
});

test("fails closed when commercial refund policy approval or bounds are invalid", () => {
  assert.match(
    validateDeploymentConfig({
      ...validProduction(),
      REFUND_POLICY_APPROVED: "false",
      REFUND_POLICY_APPROVAL_REFERENCE: ""
    }).join("\n"),
    /COMMERCIAL_RELEASE_MODE=commercial requires REFUND_POLICY_APPROVED=true/
  );
  assert.match(
    validateDeploymentConfig({
      ...validProduction(),
      REFUND_POLICY_APPROVAL_REFERENCE: ""
    }).join("\n"),
    /REFUND_POLICY_APPROVED=true requires REFUND_POLICY_APPROVAL_REFERENCE/
  );
  assert.match(
    validateDeploymentConfig({
      ...validProduction(),
      REFUND_POLICY_VERSION: "current policy"
    }).join("\n"),
    /controlled 3-64 character version identifier/
  );
  assert.match(
    validateDeploymentConfig({
      ...validProduction(),
      REFUND_REQUEST_WINDOW_HOURS: "721"
    }).join("\n"),
    /must be between 1 and 720/
  );
});

test("uses the authoritative 16-key transactional template manifest", () => {
  assert.equal(REQUIRED_TRANSACTIONAL_TEMPLATE_KEYS.length, 16);
  assert.deepEqual(
    REQUIRED_TRANSACTIONAL_TEMPLATE_KEYS,
    transactionalTemplateManifest.map(({ key }) => key)
  );
  assert.ok(REQUIRED_TRANSACTIONAL_TEMPLATE_KEYS.includes("messageReceived"));
  assert.ok(REQUIRED_TRANSACTIONAL_TEMPLATE_KEYS.includes("rescheduleCancelled"));
});

test("keeps production No-Go until account-deletion retention has external legal approval", () => {
  assert.match(
    validateDeploymentConfig({
      ...validProduction(),
      ACCOUNT_DELETION_RETENTION_POLICY_APPROVED: "false",
      ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE: ""
    }).join("\n"),
    /must be true in production after external legal approval/
  );
  assert.match(
    validateDeploymentConfig({
      ...validProduction(),
      ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE: ""
    }).join("\n"),
    /APPROVED=true requires ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE/
  );
  assert.match(
    validateDeploymentConfig({
      ...validProduction(),
      ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE: "raw secret with spaces"
    }).join("\n"),
    /6-160 character non-secret reference/
  );
});

test("keeps production No-Go until legal-hold policy reasons are externally approved", () => {
  assert.match(
    validateDeploymentConfig({
      ...validProduction(),
      ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_APPROVED: "false"
    }).join("\n"),
    /must be true in production after external legal approval/
  );
  assert.match(
    validateDeploymentConfig({
      ...validProduction(),
      ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_APPROVAL_REFERENCE: ""
    }).join("\n"),
    /APPROVED=true requires a controlled version, approval reference and non-empty reason catalog/
  );
  assert.match(
    validateDeploymentConfig({
      ...validProduction(),
      ACCOUNT_DATA_RETENTION_LEGAL_HOLD_REASON_CODES_JSON: "[]"
    }).join("\n"),
    /non-empty reason catalog/
  );
  assert.match(
    validateDeploymentConfig({
      ...validProduction(),
      ACCOUNT_DATA_RETENTION_LEGAL_HOLD_REASON_CODES_JSON: JSON.stringify([{
        code: "LITIGATION_NOTICE",
        actions: ["placement"],
        categories: ["unknown_category"]
      }])
    }).join("\n"),
    /unique controlled reasons, actions and retention categories/
  );
});

test("fails closed for an invalid auth-identity tombstone keyring or re-registration policy", () => {
  assert.match(
    validateDeploymentConfig({
      ...validProduction(),
      AUTH_IDENTITY_TOMBSTONE_HMAC_KEYS: JSON.stringify({ weak: "d2Vhaw==" }),
      AUTH_IDENTITY_TOMBSTONE_ACTIVE_KEY_ID: "missing",
      AUTH_IDENTITY_REREGISTRATION_POLICY: "immediate"
    }).join("\n"),
    /at least 32 bytes/
  );
  assert.match(
    validateDeploymentConfig({
      ...validProduction(),
      AUTH_IDENTITY_TOMBSTONE_HMAC_KEYS: JSON.stringify({ weak: "d2Vhaw==" }),
      AUTH_IDENTITY_TOMBSTONE_ACTIVE_KEY_ID: "missing"
    }).join("\n"),
    /ACTIVE_KEY_ID must exist/
  );
  assert.match(
    validateDeploymentConfig({
      ...validProduction(),
      AUTH_IDENTITY_REREGISTRATION_POLICY: "immediate"
    }).join("\n"),
    /must be after_tombstone_expiry/
  );
});

test("keeps production No-Go until the crisis resource catalog is approved", () => {
  assert.match(
    validateDeploymentConfig({
      ...validProduction(),
      CRISIS_RESOURCES_APPROVED: "false",
      CRISIS_RESOURCES_APPROVAL_REFERENCE: ""
    }).join("\n"),
    /must be true in production after safety and operations approval/
  );
  assert.match(
    validateDeploymentConfig({
      ...validProduction(),
      CRISIS_RESOURCES_APPROVAL_REFERENCE: ""
    }).join("\n"),
    /APPROVED=true requires CRISIS_RESOURCES_APPROVAL_REFERENCE/
  );
  assert.match(
    validateDeploymentConfig({
      ...validProduction(),
      CRISIS_RESOURCES_APPROVAL_REFERENCE: "raw secret with spaces"
    }).join("\n"),
    /6-160 character non-secret reference/
  );
});

test("keeps production No-Go until daily WeChat bills are approved and bounded", () => {
  assert.match(
    validateDeploymentConfig({
      ...validProduction(),
      WECHAT_DAILY_BILL_RECONCILIATION_START_DATE: ""
    }).join("\n"),
    /WECHAT_DAILY_BILL_RECONCILIATION_START_DATE/
  );
  assert.match(
    validateDeploymentConfig({
      ...validProduction(),
      WECHAT_DAILY_BILL_RECONCILIATION_START_DATE: "2026-02-31"
    }).join("\n"),
    /must be a valid YYYY-MM-DD date/
  );
  assert.match(
    validateDeploymentConfig({
      ...validProduction(),
      WECHAT_DAILY_BILL_RECONCILIATION_ENABLED: "false"
    }).join("\n"),
    /WECHAT_DAILY_BILL_RECONCILIATION_ENABLED must be true in production/
  );
  assert.match(
    validateDeploymentConfig({
      ...validProduction(),
      WECHAT_DAILY_BILL_RECONCILIATION_APPROVED: "false",
      WECHAT_DAILY_BILL_RECONCILIATION_APPROVAL_REFERENCE: ""
    }).join("\n"),
    /WECHAT_DAILY_BILL_RECONCILIATION_APPROVED must be true in production after finance approval/
  );
  assert.match(
    validateDeploymentConfig({
      ...validProduction(),
      WECHAT_DAILY_BILL_RECONCILIATION_APPROVAL_REFERENCE: "raw secret with spaces"
    }).join("\n"),
    /6-160 character non-secret reference/
  );
  assert.match(
    validateDeploymentConfig({
      ...validProduction(),
      WECHAT_DAILY_BILL_RECONCILIATION_HOUR: "9"
    }).join("\n"),
    /must be between 10 and 23/
  );
  assert.match(
    validateDeploymentConfig({
      ...validProduction(),
      WECHAT_DAILY_BILL_RECONCILIATION_BATCH_SIZE: "17"
    }).join("\n"),
    /must be between 1 and 16/
  );
});

test("rejects missing, malformed, out-of-range, or inverted consumer JWT TTLs", () => {
  assert.match(
    validateDeploymentConfig({ ...validProduction(), JWT_ACCESS_TTL: "" }).join("\n"),
    /JWT_ACCESS_TTL is required/
  );
  assert.match(
    validateDeploymentConfig({ ...validProduction(), JWT_ACCESS_TTL: "15M" }).join("\n"),
    /positive integer followed by s, m, h, or d/
  );
  assert.match(
    validateDeploymentConfig({ ...validProduction(), JWT_ACCESS_TTL: "2h" }).join("\n"),
    /between 5 minutes and 1 hour/
  );
  assert.match(
    validateDeploymentConfig({ ...validProduction(), JWT_REFRESH_TTL: "91d" }).join("\n"),
    /between 1 hour and 90 days/
  );
  assert.match(
    validateDeploymentConfig({ ...validProduction(), JWT_ACCESS_TTL: "1h", JWT_REFRESH_TTL: "1h" }).join("\n"),
    /JWT_REFRESH_TTL must be greater than JWT_ACCESS_TTL/
  );
});

test("requires restricted TRTC signing inputs only when real-time voice is enabled", () => {
  const enabled = { ...validProduction(), COMMERCIAL_SURFACE: "full", TRTC_ENABLED: "true" };
  assert.match(validateDeploymentConfig(enabled).join("\n"), /TRTC_SDK_APP_ID is required/);

  Object.assign(enabled, {
    TRTC_SDK_APP_ID: "1400000001",
    TRTC_SDK_SECRET_KEY: "trtc-production-secret-material",
    TRTC_CALLBACK_SIGNING_KEY: "CallbackKey1234567890",
    TRTC_PRIVATE_MAP_KEY_ENABLED: "true",
    TRTC_USER_SIG_TTL_SECONDS: "300",
    TRTC_PRIVACY_DISCLOSURE_APPROVED: "true",
    TRTC_PRIVACY_DISCLOSURE_REFERENCE: "legal:trtc-disclosure-2026-08",
    TRTC_ROOM_CONTROL_ENABLED: "true",
    TRTC_CONTROL_REGION: "ap-guangzhou",
    TRTC_CONTROL_TIMEOUT_MS: "5000",
    TRTC_ROOM_CONTROL_INTERVAL_SECONDS: "15",
    TRTC_ROOM_CONTROL_BATCH_SIZE: "10",
    TENCENTCLOUD_SECRET_ID: "AKID_test_voice_control",
    TENCENTCLOUD_SECRET_KEY: "tencent-cloud-control-secret-material"
  });
  assert.deepEqual(validateDeploymentConfig(enabled), []);
  assert.match(
    validateDeploymentConfig({ ...validProduction(), COMMERCIAL_SURFACE: "text_only", TRTC_ENABLED: "true" }).join("\n"),
    /COMMERCIAL_SURFACE=text_only forbids TRTC_ENABLED=true/
  );
  assert.match(
    validateDeploymentConfig({ ...enabled, TRTC_PRIVACY_DISCLOSURE_APPROVED: "false" }).join("\n"),
    /TRTC_PRIVACY_DISCLOSURE_APPROVED must be true/
  );
  assert.match(
    validateDeploymentConfig({ ...enabled, TRTC_PRIVACY_DISCLOSURE_REFERENCE: "" }).join("\n"),
    /TRTC_PRIVACY_DISCLOSURE_REFERENCE is required/
  );
  assert.deepEqual(validateDeploymentConfig({ ...enabled, TRTC_EMERGENCY_STOP_ENABLED: "true" }), []);
  assert.match(
    validateDeploymentConfig({ ...enabled, TRTC_PRIVATE_MAP_KEY_ENABLED: "false" }).join("\n"),
    /TRTC_PRIVATE_MAP_KEY_ENABLED must be true/
  );
  assert.match(
    validateDeploymentConfig({ ...enabled, TRTC_USER_SIG_TTL_SECONDS: "901" }).join("\n"),
    /TRTC_USER_SIG_TTL_SECONDS/
  );
  assert.match(
    validateDeploymentConfig({ ...enabled, TRTC_ROOM_CONTROL_ENABLED: "false" }).join("\n"),
    /TRTC_ROOM_CONTROL_ENABLED must be true/
  );
  assert.match(
    validateDeploymentConfig({ ...enabled, TRTC_ENABLED: "false", TRTC_EMERGENCY_STOP_ENABLED: "true" }).join("\n"),
    /TRTC_EMERGENCY_STOP_ENABLED=true requires/
  );
  assert.match(
    validateDeploymentConfig({ ...enabled, TRTC_CONTROL_REGION: "ap-shanghai" }).join("\n"),
    /TRTC_CONTROL_REGION must be ap-beijing or ap-guangzhou/
  );
});

test("requires a live availability-reminder template only when the default-off delivery runner is explicitly enabled", () => {
  const enabled = {
    ...validProduction(),
    AVAILABILITY_REMINDER_DELIVERY_ENABLED: "true"
  };
  assert.match(
    validateDeploymentConfig(enabled).join("\n"),
    /requires an availabilityReminder subscribe template/
  );

  const templates = JSON.parse(enabled.WECHAT_SUBSCRIBE_TEMPLATES_JSON);
  templates.push({
    key: "availabilityReminder",
    templateId: "TEMPLATE_availabilityReminder_123456",
    page: "pages/companions/index",
    data: { thing1: "{{title}}" }
  });
  enabled.WECHAT_SUBSCRIBE_TEMPLATES_JSON = JSON.stringify(templates);
  enabled.AVAILABILITY_REMINDER_DELIVERY_INTERVAL_SECONDS = "15";
  enabled.AVAILABILITY_REMINDER_DELIVERY_BATCH_SIZE = "100";
  assert.deepEqual(validateDeploymentConfig(enabled), []);

  assert.match(
    validateDeploymentConfig({
      ...enabled,
      WECHAT_SUBSCRIBE_MESSAGES_ENABLED: "false"
    }).join("\n"),
    /AVAILABILITY_REMINDER_DELIVERY_ENABLED requires WECHAT_SUBSCRIBE_MESSAGES_ENABLED=true/
  );
  assert.match(
    validateDeploymentConfig({
      ...enabled,
      AVAILABILITY_REMINDER_DELIVERY_INTERVAL_SECONDS: "14",
      AVAILABILITY_REMINDER_DELIVERY_BATCH_SIZE: "101"
    }).join("\n"),
    /AVAILABILITY_REMINDER_DELIVERY_INTERVAL_SECONDS must be an integer between 15 and 3600/
  );
  assert.match(
    validateDeploymentConfig({
      ...enabled,
      AVAILABILITY_REMINDER_DELIVERY_ENABLED: "yes"
    }).join("\n"),
    /AVAILABILITY_REMINDER_DELIVERY_ENABLED must be true or false when configured/
  );
});

test("rejects external transmission and stale DeepSeek credentials", () => {
  const missing = validProduction();
  delete missing.EXTERNAL_AI_USER_CONTENT_ENABLED;
  assert.match(validateDeploymentConfig(missing).join("\n"), /EXTERNAL_AI_USER_CONTENT_ENABLED is required/);
  assert.match(
    validateDeploymentConfig({ ...validProduction(), EXTERNAL_AI_USER_CONTENT_ENABLED: "true" }).join("\n"),
    /must remain false/
  );
  assert.match(
    validateDeploymentConfig({ ...validProduction(), DEEPSEEK_API_KEY: "stale-production-key" }).join("\n"),
    /must be unset/
  );
});

test("fails commercial preflight when the controlled voice-evidence viewer is missing or unsafe", () => {
  const missing = validProduction();
  delete missing.COMPANION_VOICE_EVIDENCE_VIEWER_URL;
  delete missing.COMPANION_VOICE_EVIDENCE_SIGNING_SECRET;
  assert.match(
    validateDeploymentConfig(missing).join("\n"),
    /COMPANION_VOICE_EVIDENCE_VIEWER_URL is required/
  );

  assert.match(
    validateDeploymentConfig({
      ...validProduction(),
      COMPANION_VOICE_EVIDENCE_VIEWER_URL: "http://evidence.talkandtalk.app/voice-intro"
    }).join("\n"),
    /must be an HTTPS base URL/
  );
  assert.match(
    validateDeploymentConfig({
      ...validProduction(),
      COMPANION_VOICE_EVIDENCE_SIGNING_SECRET: "short"
    }).join("\n"),
    /must be at least 32 characters/
  );
  assert.match(
    validateDeploymentConfig({
      ...validProduction(),
      COMPANION_VOICE_EVIDENCE_URL_TTL_SECONDS: "901"
    }).join("\n"),
    /integer between 60 and 900/
  );
});

test("rejects Mini Program release backend or legal constants that drift from production", () => {
  const env = validProduction();
  const validSource = `
    const HTTPS_BACKENDS = { release: "https://api.talkandtalk.app/api/v1" };
    export const LEGAL_URLS = {
      privacy: "https://api.talkandtalk.app/legal/privacy.html",
      terms: "https://api.talkandtalk.app/legal/terms.html"
    };
    export const LEGAL_CONSENT_VERSION = "2.2-2026-08-01";
  `;
  assert.deepEqual(validateMiniProgramReleaseConfig(env, validSource), []);
  assert.match(
    validateMiniProgramReleaseConfig(env, validSource.replace("2.2-2026-08-01", "stale-version")).join("\n"),
    /consent version/
  );
});

test("accepts a CloudBase production deployment with an inline PEM private key", () => {
  const env = validProduction();
  env.WECHAT_PAY_PRIVATE_KEY_PATH = "";
  env.WECHAT_PAY_PRIVATE_KEY =
    "-----BEGIN PRIVATE KEY-----\\nprivate-key-material\\n-----END PRIVATE KEY-----";
  assert.deepEqual(validateDeploymentConfig(env), []);
});

test("does not require historical iOS configuration for a Mini Program release", () => {
  const env = validProduction();
  delete env.APPLE_SIGN_IN_BUNDLE_ID;
  assert.deepEqual(validateDeploymentConfig(env), []);
});

test("rejects placeholders, shared JWT secrets, insecure Redis, and missing payment fields", () => {
  const env = validProduction();
  env.DATABASE_URL = "postgresql://talk:CHANGE_ME@postgres:5432/talk_and_talk";
  env.REDIS_URL = "redis://redis:6379";
  env.JWT_REFRESH_SECRET = env.JWT_ACCESS_SECRET;
  env.REVIEW_JWT_ACCESS_SECRET = env.JWT_ACCESS_SECRET;
  env.REVIEW_TOTP_ENCRYPTION_KEY = env.STAFF_TOTP_ENCRYPTION_KEY;
  env.WECHAT_PAY_MCH_ID = "";
  env.SEED_ON_STARTUP = "true";

  const errors = validateDeploymentConfig(env).join("\n");
  assert.match(errors, /DATABASE_URL still contains a placeholder/);
  assert.match(errors, /production REDIS_URL must include a password/);
  assert.match(errors, /JWT access and refresh secrets must be different/);
  assert.match(errors, /review JWT secrets must not reuse consumer JWT secrets/);
  assert.match(errors, /review TOTP encryption key must not reuse staff TOTP encryption key/);
  assert.match(errors, /WECHAT_PAY_MCH_ID is required/);
  assert.match(errors, /production SEED_ON_STARTUP must be false/);
});

test("rejects an unbounded commercial booking horizon", () => {
  const errors = validateDeploymentConfig({
    ...validProduction(),
    ORDER_MAX_SCHEDULE_DAYS: "366"
  }).join("\n");
  assert.match(errors, /ORDER_MAX_SCHEDULE_DAYS must be between 1 and 365/);
});

test("allows staging Mock payment only when all real payment fields are empty", () => {
  const env = validProduction();
  env.APP_ENV = "staging";
  env.SMS_PROVIDER = "mock";
  env.SEED_ON_STARTUP = "true";
  for (const key of Object.keys(env).filter((key) => key.startsWith("WECHAT_PAY_"))) env[key] = "";

  assert.deepEqual(validateDeploymentConfig(env), []);
  env.WECHAT_PAY_APP_ID = "wx1234567890abcdef";
  assert.match(validateDeploymentConfig(env).join("\n"), /all together or all left empty/);
});
