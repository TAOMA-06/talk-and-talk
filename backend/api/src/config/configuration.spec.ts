import { validateEnvironment } from "./configuration";

describe("validateEnvironment", () => {
  const productionEnv = {
    NODE_ENV: "production",
    APP_ENV: "production",
    CORS_ORIGINS: "https://api.talkandtalk.example",
    DATABASE_URL: "postgresql://talk:strong-password@db:5432/talk_and_talk",
    REDIS_URL: "rediss://redis:6379",
    JWT_ACCESS_SECRET: "a".repeat(32),
    JWT_REFRESH_SECRET: "b".repeat(32),
    METRICS_TOKEN: "m".repeat(32),
    STAFF_TOTP_ENCRYPTION_KEY: "t".repeat(32),
    SMS_PROVIDER: "none",
    WECHAT_MINIPROGRAM_APP_ID: "wx-mini-app",
    WECHAT_MINIPROGRAM_APP_SECRET: "mini-secret",
    WECHAT_PAY_MCH_ID: "1900000000",
    WECHAT_PAY_API_V3_KEY: "k".repeat(32),
    WECHAT_PAY_PRIVATE_KEY_PATH: "/run/secrets/wechat-pay-key.pem",
    WECHAT_PAY_CERT_SERIAL_NO: "SERIAL1",
    WECHAT_PAY_NOTIFY_BASE_URL: "https://api.talkandtalk.example"
  };

  it("applies defaults", () => {
    const env = validateEnvironment({});

    expect(env.PORT).toBe(3000);
    expect(env.HOST).toBe("127.0.0.1");
    expect(env.API_PREFIX).toBe("api/v1");
    expect(env.APP_VERSION).toBe("0.1.0");
    expect(env.CORS_ORIGINS).toContain("http://localhost:3000");
    expect(env.DEEPSEEK_URL).toBe("https://api.deepseek.com");
    expect(env.DEEPSEEK_MODEL).toBe("deepseek-chat");
    expect(env.APP_ENV).toBe("development");
    expect(env.SMS_PROVIDER).toBe("mock");
    expect(env.STAFF_TOTP_ENCRYPTION_KEY).toContain("development-staff-totp-key");
    expect(env.SEED_ON_STARTUP).toBe(false);
    expect(env.METRICS_TOKEN).toBe("");
    expect(env.LEGAL_CONSENT_VERSION).toBe("1.0-2026-07-19");
    expect(env.LEGAL_PRIVACY_URL).toBe("https://api.talkandtalk.app/legal/privacy.html");
    expect(env.LEGAL_TERMS_URL).toBe("https://api.talkandtalk.app/legal/terms.html");
  });

  it("defaults staging app env and seed flag", () => {
    const env = validateEnvironment({
      NODE_ENV: "production",
      APP_ENV: "staging",
      CORS_ORIGINS: "https://api-staging.example.com",
      JWT_ACCESS_SECRET: "staging-access",
      JWT_REFRESH_SECRET: "staging-refresh"
    });

    expect(env.APP_ENV).toBe("staging");
    expect(env.SEED_ON_STARTUP).toBe(true);
    expect(env.SMS_PROVIDER).toBe("mock");
  });

  it("rejects mock sms in production app env", () => {
    expect(() =>
      validateEnvironment({
        ...productionEnv,
        SMS_PROVIDER: "mock"
      })
    ).toThrow("SMS_PROVIDER=mock");
  });

  it("rejects demo seed in production app env", () => {
    expect(() => validateEnvironment({
      ...productionEnv,
      SEED_ON_STARTUP: "true"
    })).toThrow("SEED_ON_STARTUP");
  });

  it("rejects invalid ports", () => {
    expect(() => validateEnvironment({ PORT: "nope" })).toThrow("PORT");
  });

  it("uses an explicit loopback host only outside production", () => {
    expect(validateEnvironment({ HOST: "::1" }).HOST).toBe("::1");
    expect(() => validateEnvironment({ ...productionEnv, HOST: "127.0.0.1" }))
      .toThrow("HOST must bind all interfaces");
    expect(() => validateEnvironment({ HOST: "example.test" })).toThrow("HOST must be one of");
  });

  it("normalizes api prefix slashes", () => {
    const env = validateEnvironment({ API_PREFIX: "/api/v1/" });

    expect(env.API_PREFIX).toBe("api/v1");
  });

  it("parses explicit CORS origins", () => {
    const env = validateEnvironment({
      CORS_ORIGINS: "https://admin.example.com, https://app.example.com, https://admin.example.com"
    });

    expect(env.CORS_ORIGINS).toEqual(["https://admin.example.com", "https://app.example.com"]);
  });

  it("requires explicit CORS origins in production", () => {
    expect(() => validateEnvironment({
      NODE_ENV: "production",
      JWT_ACCESS_SECRET: "prod-access",
      JWT_REFRESH_SECRET: "prod-refresh"
    })).toThrow("CORS_ORIGINS");
  });

  it("accepts production when CORS origins are explicit", () => {
    const env = validateEnvironment(productionEnv);

    expect(env.NODE_ENV).toBe("production");
    expect(env.CORS_ORIGINS).toEqual(["https://api.talkandtalk.example"]);
  });

  it("validates URL-shaped environment values", () => {
    expect(() => validateEnvironment({ DEEPSEEK_URL: "not-a-url" })).toThrow("DEEPSEEK_URL");
  });

  it("provides JWT defaults in development", () => {
    const env = validateEnvironment({});
    expect(env.JWT_ACCESS_SECRET).toBe("dev-access-secret");
    expect(env.JWT_REFRESH_SECRET).toBe("dev-refresh-secret");
    expect(env.JWT_ACCESS_TTL).toBe("15m");
    expect(env.JWT_REFRESH_TTL).toBe("30d");
  });

  it("requires JWT secrets in production", () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: "production",
        CORS_ORIGINS: "https://app.example.com"
      })
    ).toThrow("JWT_ACCESS_SECRET");
  });

  it("requires strong distinct JWT and metrics secrets in production", () => {
    expect(() => validateEnvironment({
      ...productionEnv,
      JWT_ACCESS_SECRET: "short"
    })).toThrow("at least 32");
    expect(() => validateEnvironment({
      ...productionEnv,
      JWT_REFRESH_SECRET: productionEnv.JWT_ACCESS_SECRET
    })).toThrow("must be different");
    expect(() => validateEnvironment({
      ...productionEnv,
      METRICS_TOKEN: "short"
    })).toThrow("METRICS_TOKEN");
    expect(() => validateEnvironment({
      ...productionEnv,
      STAFF_TOTP_ENCRYPTION_KEY: "short"
    })).toThrow("STAFF_TOTP_ENCRYPTION_KEY");
  });

  it("rejects production placeholder credentials even when they meet length requirements", () => {
    expect(() => validateEnvironment({
      ...productionEnv,
      JWT_ACCESS_SECRET: "CHANGE_ME_RANDOM_ACCESS_SECRET_32_CHARS_MINIMUM"
    })).toThrow("placeholder");
    expect(() => validateEnvironment({
      ...productionEnv,
      METRICS_TOKEN: "CHANGE_ME_RANDOM_METRICS_TOKEN_32_CHARS_MINIMUM"
    })).toThrow("placeholder");
    expect(() => validateEnvironment({
      ...productionEnv,
      DATABASE_URL: "postgresql://talk:CHANGE_ME@db:5432/talk_and_talk"
    })).toThrow("placeholder");
    expect(() => validateEnvironment({
      ...productionEnv,
      WECHAT_PAY_API_V3_KEY: "CHANGE_ME_1234567890123456789012"
    })).toThrow("placeholder");
  });

  it("requires HTTPS legal document URLs", () => {
    expect(() => validateEnvironment({ LEGAL_PRIVACY_URL: "http://api.example/privacy" }))
      .toThrow("LEGAL_PRIVACY_URL");
    expect(() => validateEnvironment({ LEGAL_TERMS_URL: "not-a-url" }))
      .toThrow("LEGAL_TERMS_URL");
  });

  it("requires explicit database and Redis URLs in production", () => {
    expect(() => validateEnvironment({
      ...productionEnv,
      DATABASE_URL: ""
    })).toThrow("DATABASE_URL and REDIS_URL");
  });

  it("rejects invalid dependency protocols and numeric limits", () => {
    expect(() => validateEnvironment({ DATABASE_URL: "https://db.example" })).toThrow("DATABASE_URL");
    expect(() => validateEnvironment({ REDIS_URL: "https://redis.example" })).toThrow("REDIS_URL");
    expect(() => validateEnvironment({ RATE_LIMIT_PER_MINUTE: "-1" })).toThrow("positive integer");
    expect(() => validateEnvironment({ SMS_CODE_TTL_SECONDS: "not-a-number" })).toThrow("positive integer");
  });

  it("requires WeChat Mini Program credentials to be configured together", () => {
    expect(() => validateEnvironment({ WECHAT_MINIPROGRAM_APP_ID: "wx123" }))
      .toThrow("WECHAT_MINIPROGRAM_APP_ID");
  });

  it("fails fast when production Mini Program payment configuration is incomplete", () => {
    expect(() => validateEnvironment({
      ...productionEnv,
      WECHAT_PAY_MCH_ID: ""
    })).toThrow("WECHAT_PAY_MCH_ID");
  });

  it("requires an absolute HTTPS WeChat notify base URL in production", () => {
    expect(() => validateEnvironment({
      ...productionEnv,
      WECHAT_PAY_NOTIFY_BASE_URL: "http://api.talkandtalk.example"
    })).toThrow("HTTPS");
  });

  it("requires a 32-character WeChat API v3 key in production", () => {
    expect(() => validateEnvironment({
      ...productionEnv,
      WECHAT_PAY_API_V3_KEY: "too-short"
    })).toThrow("32 characters");
  });
});
