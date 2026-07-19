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
  if (production) required.push(...PAY_REQUIRED_FIELDS, "METRICS_TOKEN", "STAFF_TOTP_ENCRYPTION_KEY");

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

  for (const key of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"]) {
    if (env[key] && env[key].length < 32) errors.push(`${key} must be at least 32 characters`);
  }
  for (const key of ["METRICS_TOKEN", "STAFF_TOTP_ENCRYPTION_KEY"]) {
    if (production && env[key] && env[key].length < 32) errors.push(`${key} must be at least 32 characters`);
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
  if (env.WECHAT_MINIPROGRAM_APP_SECRET && env.WECHAT_MINIPROGRAM_APP_SECRET.length < 16) {
    errors.push("WECHAT_MINIPROGRAM_APP_SECRET is unexpectedly short");
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

  if (production && env.SEED_ON_STARTUP !== "false") errors.push("production SEED_ON_STARTUP must be false");
  if (production && env.SMS_PROVIDER === "mock") errors.push("production SMS_PROVIDER cannot be mock");

  return [...new Set(errors)];
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: node scripts/deployment-preflight.mjs <environment-file>");
    process.exit(2);
  }
  const env = parseEnv(readFileSync(resolve(path), "utf8"));
  const errors = validateDeploymentConfig(env);
  if (errors.length) {
    console.error(`Deployment preflight failed with ${errors.length} issue(s):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`Deployment preflight passed for ${env.APP_ENV} (secret values not printed)`);
}
