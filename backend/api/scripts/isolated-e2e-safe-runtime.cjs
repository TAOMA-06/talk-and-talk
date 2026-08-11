"use strict";

const { appendFileSync } = require("node:fs");

// This is deliberately an allowlist of application configuration rather than
// a best-effort list of known credentials. Keep it shared by the local runner
// and the direct E2E entrypoint so a hostile inherited shell fails before
// Prisma, Nest, or any provider client can start.
const ISOLATED_E2E_SAFETY_OVERRIDES = Object.freeze({
  APP_ENV: "development",
  NODE_ENV: "test",
  COMMERCIAL_RELEASE_MODE: "internal",
  COMMERCIAL_SURFACE: "text_only",
  CORS_ORIGINS: "http://localhost:3000",
  JWT_ACCESS_SECRET: "isolated-e2e-access-secret",
  JWT_REFRESH_SECRET: "isolated-e2e-refresh-secret",
  REVIEW_JWT_ACCESS_SECRET: "isolated-e2e-review-access-secret",
  REVIEW_JWT_REFRESH_SECRET: "isolated-e2e-review-refresh-secret",
  MOCK_WECHAT_NOTIFY_SECRET: "isolated-e2e-mock-wechat-notify-secret-32b",
  SMS_PROVIDER: "mock",
  SEED_ON_STARTUP: "false",
  EXTERNAL_AI_USER_CONTENT_ENABLED: "false",
  DEEPSEEK_API_KEY: "",
  MEDIA_FEATURE_ENABLED: "false",
  MEDIA_PROVIDER: "disabled",
  WECHAT_SUBSCRIBE_MESSAGES_ENABLED: "false",
  WECHAT_SUBSCRIBE_TEMPLATES_JSON: "",
  NOTIFICATION_DELIVERY_ENABLED: "false",
  AVAILABILITY_REMINDER_PREPARATION_ENABLED: "false",
  AVAILABILITY_REMINDER_DELIVERY_ENABLED: "false",
  PAYMENT_RECONCILIATION_ENABLED: "false",
  WECHAT_DAILY_BILL_RECONCILIATION_ENABLED: "false",
  WECHAT_DAILY_BILL_RECONCILIATION_APPROVED: "false",
  WECHAT_DAILY_BILL_RECONCILIATION_APPROVAL_REFERENCE: "",
  WECHAT_DAILY_BILL_RECONCILIATION_START_DATE: "",
  WECHAT_PAY_COMPLAINTS_ENABLED: "false",
  PAYOUT_CLAIMS_ENABLED: "false",
  ORDER_RESCHEDULE_EXPIRY_ENABLED: "false",
  WECHAT_MINIPROGRAM_APP_ID: "",
  WECHAT_MINIPROGRAM_APP_SECRET: "",
  WECHAT_PAY_APP_ID: "",
  WECHAT_PAY_MCH_ID: "",
  WECHAT_PAY_API_V3_KEY: "",
  WECHAT_PAY_PRIVATE_KEY: "",
  WECHAT_PAY_PRIVATE_KEY_PATH: "",
  WECHAT_PAY_CERT_SERIAL_NO: "",
  WECHAT_PAY_NOTIFY_BASE_URL: "",
  TENCENTCLOUD_SECRET_ID: "",
  TENCENTCLOUD_SECRET_KEY: "",
  TENCENTCLOUD_SECURITY_TOKEN: "",
  TRTC_ENABLED: "false",
  TRTC_PRIVATE_MAP_KEY_ENABLED: "false",
  TRTC_PRIVACY_DISCLOSURE_APPROVED: "false",
  TRTC_PRIVACY_DISCLOSURE_REFERENCE: "",
  TRTC_ROOM_CONTROL_ENABLED: "false",
  TRTC_EMERGENCY_STOP_ENABLED: "false",
  TRTC_SDK_APP_ID: "0",
  TRTC_SDK_SECRET_KEY: "",
  TRTC_CALLBACK_SIGNING_KEY: "",
  APPLE_SIGN_IN_BUNDLE_ID: "",
  DATA_EXPORT_DELIVERY_API_KEY: "",
  DATA_EXPORT_DELIVERY_BASE_URL: "",
  COMPANION_VOICE_EVIDENCE_SIGNING_SECRET: "",
  COMPANION_VOICE_EVIDENCE_VIEWER_URL: "",
  STAFF_TOTP_ENCRYPTION_KEY: "",
  REVIEW_TOTP_ENCRYPTION_KEY: "",
  AUTH_IDENTITY_TOMBSTONE_HMAC_KEYS: "",
  AUTH_IDENTITY_TOMBSTONE_ACTIVE_KEY_ID: "",
  METRICS_TOKEN: "",
  SHADOW_DATABASE_URL: ""
});

function assertIsolatedE2eSafeRuntime(env = process.env) {
  const unsafe = Object.entries(ISOLATED_E2E_SAFETY_OVERRIDES)
    .filter(([key, expected]) => String(env[key] ?? "") !== expected)
    .map(([key]) => key);
  if (unsafe.length) {
    throw new Error(
      `Isolated E2E requires its sealed safe runtime values; refusing inherited configuration: ${unsafe.join(", ")}`
    );
  }
}

function githubEnvironmentLines() {
  return Object.entries(ISOLATED_E2E_SAFETY_OVERRIDES)
    .map(([key, value]) => `${key}=${value}`);
}

function appendGitHubEnvironment(file = process.env.GITHUB_ENV) {
  if (!file) {
    throw new Error("GITHUB_ENV is required to append isolated E2E runtime values");
  }
  appendFileSync(file, `${githubEnvironmentLines().join("\n")}\n`, "utf8");
}

module.exports = {
  appendGitHubEnvironment,
  assertIsolatedE2eSafeRuntime,
  githubEnvironmentLines,
  ISOLATED_E2E_SAFETY_OVERRIDES
};

if (require.main === module) {
  try {
    if (process.argv[2] === "--append-github-env") {
      appendGitHubEnvironment();
      console.info("Isolated E2E safe runtime appended to GitHub Actions environment");
    } else if (process.argv[2] === undefined) {
      assertIsolatedE2eSafeRuntime();
      console.info("Isolated E2E safe runtime accepted");
    } else {
      throw new Error("Expected no argument or --append-github-env");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Isolated E2E safe runtime rejected");
    process.exitCode = 1;
  }
}
