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
    expect(env.SMS_PROVIDER).toBe("none");
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
    expect(() => validateEnvironment({ NODE_ENV: "production" })).toThrow("CORS_ORIGINS");
  });

  it("accepts production when CORS origins are explicit", () => {
    const env = validateEnvironment({
      NODE_ENV: "production",
      CORS_ORIGINS: "https://api.talkandtalk.example"
    });

    expect(env.NODE_ENV).toBe("production");
    expect(env.CORS_ORIGINS).toEqual(["https://api.talkandtalk.example"]);
  });

  it("validates URL-shaped environment values", () => {
    expect(() => validateEnvironment({ DEEPSEEK_URL: "not-a-url" })).toThrow("DEEPSEEK_URL");
  });
});
