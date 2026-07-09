type NodeEnv = "development" | "test" | "production";

interface Environment {
  NODE_ENV: NodeEnv;
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
  WECHAT_PAY_PRIVATE_KEY_PATH: string;
  WECHAT_PAY_CERT_SERIAL_NO: string;
  APPLE_SIGN_IN_BUNDLE_ID: string;
  SMS_PROVIDER: string;
}

const DEFAULT_DATABASE_URL = "postgres://talk:talk@localhost:5432/talk_and_talk";
const DEFAULT_REDIS_URL = "redis://localhost:6379";
const DEFAULT_DEEPSEEK_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
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

function parseNodeEnv(value: string | undefined): NodeEnv {
  const nodeEnv = value ?? "development";
  if (nodeEnv === "development" || nodeEnv === "test" || nodeEnv === "production") {
    return nodeEnv;
  }
  throw new Error("NODE_ENV must be development, test, or production");
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

function optionalString(value: string | undefined): string {
  return value?.trim() ?? "";
}

function parseCorsOrigins(value: string | undefined, nodeEnv: NodeEnv): string[] {
  const rawOrigins = value
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean) ?? [];

  if (rawOrigins.length > 0) {
    return [...new Set(rawOrigins)];
  }

  if (nodeEnv === "production") {
    throw new Error("CORS_ORIGINS must be explicitly configured in production");
  }

  return DEFAULT_DEVELOPMENT_CORS_ORIGINS;
}

export function validateEnvironment(raw: Record<string, unknown>): Environment {
  const env = raw as Record<string, string | undefined>;
  const nodeEnv = parseNodeEnv(env.NODE_ENV);
  const apiPrefix = env.API_PREFIX?.trim() || "api/v1";

  const jwtAccessSecret = env.JWT_ACCESS_SECRET?.trim() || (nodeEnv === "production" ? "" : "dev-access-secret");
  const jwtRefreshSecret = env.JWT_REFRESH_SECRET?.trim() || (nodeEnv === "production" ? "" : "dev-refresh-secret");

  if (nodeEnv === "production" && (!jwtAccessSecret || !jwtRefreshSecret)) {
    throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set in production");
  }

  return {
    NODE_ENV: nodeEnv,
    PORT: parsePort(env.PORT),
    API_PREFIX: apiPrefix.replace(/^\/+|\/+$/g, ""),
    APP_VERSION: env.APP_VERSION?.trim() || "0.1.0",
    DATABASE_URL: requiredUrl("DATABASE_URL", env.DATABASE_URL, DEFAULT_DATABASE_URL),
    REDIS_URL: requiredUrl("REDIS_URL", env.REDIS_URL, DEFAULT_REDIS_URL),
    CORS_ORIGINS: parseCorsOrigins(env.CORS_ORIGINS, nodeEnv),
    JWT_ACCESS_SECRET: jwtAccessSecret,
    JWT_REFRESH_SECRET: jwtRefreshSecret,
    JWT_ACCESS_TTL: env.JWT_ACCESS_TTL?.trim() || "15m",
    JWT_REFRESH_TTL: env.JWT_REFRESH_TTL?.trim() || "30d",
    SMS_CODE_TTL_SECONDS: parseInt(env.SMS_CODE_TTL_SECONDS ?? "300", 10),
    DEEPSEEK_API_KEY: optionalString(env.DEEPSEEK_API_KEY),
    DEEPSEEK_URL: requiredUrl("DEEPSEEK_URL", env.DEEPSEEK_URL, DEFAULT_DEEPSEEK_URL),
    DEEPSEEK_MODEL: env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL,
    WECHAT_PAY_APP_ID: optionalString(env.WECHAT_PAY_APP_ID),
    WECHAT_PAY_MCH_ID: optionalString(env.WECHAT_PAY_MCH_ID),
    WECHAT_PAY_API_V3_KEY: optionalString(env.WECHAT_PAY_API_V3_KEY),
    WECHAT_PAY_PRIVATE_KEY_PATH: optionalString(env.WECHAT_PAY_PRIVATE_KEY_PATH),
    WECHAT_PAY_CERT_SERIAL_NO: optionalString(env.WECHAT_PAY_CERT_SERIAL_NO),
    APPLE_SIGN_IN_BUNDLE_ID: optionalString(env.APPLE_SIGN_IN_BUNDLE_ID),
    SMS_PROVIDER: env.SMS_PROVIDER?.trim() || (nodeEnv === "production" ? "none" : "mock")
  };
}

export const configuration = () => validateEnvironment(process.env);
