import { validateEnvironment } from "./configuration";

describe("validateEnvironment", () => {
  it("applies defaults", () => {
    const env = validateEnvironment({});

    expect(env.PORT).toBe(3000);
    expect(env.API_PREFIX).toBe("api/v1");
    expect(env.APP_VERSION).toBe("0.1.0");
    expect(env.CORS_ORIGINS).toContain("http://localhost:3000");
    expect(env.DEEPSEEK_URL).toBe("https://api.deepseek.com");
    expect(env.DEEPSEEK_MODEL).toBe("deepseek-chat");
    expect(env.APP_ENV).toBe("development");
    expect(env.SMS_PROVIDER).toBe("mock");
    expect(env.SEED_ON_STARTUP).toBe(false);
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
        NODE_ENV: "production",
        APP_ENV: "production",
        CORS_ORIGINS: "https://api.example.com",
        JWT_ACCESS_SECRET: "prod-access",
        JWT_REFRESH_SECRET: "prod-refresh",
        SMS_PROVIDER: "mock"
      })
    ).toThrow("SMS_PROVIDER=mock");
  });

  it("rejects demo seed in production app env", () => {
    expect(() => validateEnvironment({
      NODE_ENV: "production",
      APP_ENV: "production",
      CORS_ORIGINS: "https://api.example.com",
      JWT_ACCESS_SECRET: "prod-access",
      JWT_REFRESH_SECRET: "prod-refresh",
      SMS_PROVIDER: "none",
      SEED_ON_STARTUP: "true"
    })).toThrow("SEED_ON_STARTUP");
  });

  it("rejects invalid ports", () => {
    expect(() => validateEnvironment({ PORT: "nope" })).toThrow("PORT");
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
    const env = validateEnvironment({
      NODE_ENV: "production",
      CORS_ORIGINS: "https://api.talkandtalk.example",
      JWT_ACCESS_SECRET: "prod-access",
      JWT_REFRESH_SECRET: "prod-refresh"
    });

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

  it("requires WeChat Mini Program credentials to be configured together", () => {
    expect(() => validateEnvironment({ WECHAT_MINIPROGRAM_APP_ID: "wx123" }))
      .toThrow("WECHAT_MINIPROGRAM_APP_ID");
  });
});
