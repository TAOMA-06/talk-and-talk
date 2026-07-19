import assert from "node:assert/strict";
import test from "node:test";

import { parseEnv, validateDeploymentConfig } from "./deployment-preflight.mjs";

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
    METRICS_TOKEN: "metrics-token-that-is-longer-than-32-characters",
    STAFF_TOTP_ENCRYPTION_KEY: "staff-totp-key-that-is-longer-than-32-characters",
    WECHAT_MINIPROGRAM_APP_ID: "wx1234567890abcdef",
    WECHAT_MINIPROGRAM_APP_SECRET: "0123456789abcdef0123456789abcdef",
    WECHAT_PAY_APP_ID: "wx1234567890abcdef",
    WECHAT_PAY_MCH_ID: "1900000001",
    WECHAT_PAY_API_V3_KEY: "0123456789abcdef0123456789abcdef",
    WECHAT_PAY_PRIVATE_KEY_PATH: "/run/secrets/wechat_private_key.pem",
    WECHAT_PAY_CERT_SERIAL_NO: "ABCDEF123456",
    WECHAT_PAY_NOTIFY_BASE_URL: "https://api.talkandtalk.app",
    SMS_PROVIDER: "none",
    SEED_ON_STARTUP: "false"
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
  env.WECHAT_PAY_MCH_ID = "";
  env.SEED_ON_STARTUP = "true";

  const errors = validateDeploymentConfig(env).join("\n");
  assert.match(errors, /DATABASE_URL still contains a placeholder/);
  assert.match(errors, /production REDIS_URL must include a password/);
  assert.match(errors, /JWT access and refresh secrets must be different/);
  assert.match(errors, /WECHAT_PAY_MCH_ID is required/);
  assert.match(errors, /production SEED_ON_STARTUP must be false/);
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
