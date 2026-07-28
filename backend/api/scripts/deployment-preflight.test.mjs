import assert from "node:assert/strict";
import test from "node:test";

import { parseEnv, validateDeploymentConfig, validateMiniProgramReleaseConfig } from "./deployment-preflight.mjs";

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
    REVIEW_JWT_ACCESS_SECRET: "review-access-secret-that-is-longer-than-32-characters",
    REVIEW_JWT_REFRESH_SECRET: "review-refresh-secret-that-is-longer-than-32-characters",
    METRICS_TOKEN: "metrics-token-that-is-longer-than-32-characters",
    STAFF_TOTP_ENCRYPTION_KEY: "staff-totp-key-that-is-longer-than-32-characters",
    REVIEW_TOTP_ENCRYPTION_KEY: "review-totp-key-that-is-longer-than-32-characters",
    DEEPSEEK_API_KEY: "deepseek-production-key-1234567890",
    DEEPSEEK_URL: "https://api.deepseek.com",
    DEEPSEEK_MODEL: "deepseek-chat",
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
    PLATFORM_FEE_BPS: "1200",
    COMPANION_SETTLEMENT_HOLD_HOURS: "96",
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
    WECHAT_SUBSCRIBE_TEMPLATES_JSON: JSON.stringify([
      "newOrder", "orderConfirmed", "orderRejected", "orderResponseExpired", "paymentSuccess",
      "serviceStarted", "serviceCompleted", "orderCancelled", "reservationExpired", "supportUpdate"
    ].map((key) => ({ key, templateId: `TEMPLATE_${key}_123456`, page: "pages/orders/index", data: { thing1: "{{title}}" } }))),
    LEGAL_OPERATOR_NAME: "上海示例网络科技有限公司",
    LEGAL_CONSENT_VERSION: "2.0-2026-07-20",
    LEGAL_CONTACT_EMAIL: "privacy@talkandtalk.test",
    LEGAL_CONTACT_PHONE: "021-12345678",
    LEGAL_COMPLAINT_CHANNEL: "小程序内客服工单",
    LEGAL_PRIVACY_URL: "https://api.talkandtalk.app/legal/privacy.html",
    LEGAL_TERMS_URL: "https://api.talkandtalk.app/legal/terms.html",
    LEGAL_PLATFORM_RULES_URL: "https://api.talkandtalk.app/api/v1/legal/platform-rules",
    LEGAL_CONSENT_EFFECTIVE_DATE: "2026-07-20",
    LEGAL_PRIVACY_RETENTION_DAYS: "1095",
    PAYMENT_RECONCILIATION_ENABLED: "true",
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

test("requires restricted TRTC signing inputs only when real-time voice is enabled", () => {
  const enabled = { ...validProduction(), TRTC_ENABLED: "true" };
  assert.match(validateDeploymentConfig(enabled).join("\n"), /TRTC_SDK_APP_ID is required/);

  Object.assign(enabled, {
    TRTC_SDK_APP_ID: "1400000001",
    TRTC_SDK_SECRET_KEY: "trtc-production-secret-material",
    TRTC_PRIVATE_MAP_KEY_ENABLED: "true",
    TRTC_USER_SIG_TTL_SECONDS: "300",
    TRTC_ROOM_CONTROL_ENABLED: "true",
    TRTC_CONTROL_REGION: "ap-guangzhou",
    TRTC_CONTROL_TIMEOUT_MS: "5000",
    TRTC_ROOM_CONTROL_INTERVAL_SECONDS: "15",
    TRTC_ROOM_CONTROL_BATCH_SIZE: "10",
    TENCENTCLOUD_SECRET_ID: "AKID_test_voice_control",
    TENCENTCLOUD_SECRET_KEY: "tencent-cloud-control-secret-material"
  });
  assert.deepEqual(validateDeploymentConfig(enabled), []);
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

test("rejects a production deployment without a real HTTPS moderation provider", () => {
  assert.match(validateDeploymentConfig({ ...validProduction(), DEEPSEEK_API_KEY: "" }).join("\n"), /DEEPSEEK_API_KEY is required/);
  assert.match(validateDeploymentConfig({ ...validProduction(), DEEPSEEK_API_KEY: "short" }).join("\n"), /at least 24 characters/);
  assert.match(validateDeploymentConfig({ ...validProduction(), DEEPSEEK_URL: "http:\/\/moderation.internal" }).join("\n"), /HTTPS URL/);
});

test("rejects Mini Program release backend or legal constants that drift from production", () => {
  const env = validProduction();
  const validSource = `
    const HTTPS_BACKENDS = { release: "https://api.talkandtalk.app/api/v1" };
    export const LEGAL_URLS = {
      privacy: "https://api.talkandtalk.app/legal/privacy.html",
      terms: "https://api.talkandtalk.app/legal/terms.html"
    };
    export const LEGAL_CONSENT_VERSION = "2.0-2026-07-20";
  `;
  assert.deepEqual(validateMiniProgramReleaseConfig(env, validSource), []);
  assert.match(
    validateMiniProgramReleaseConfig(env, validSource.replace("2.0-2026-07-20", "stale-version")).join("\n"),
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
