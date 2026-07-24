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
    DEEPSEEK_API_KEY: "deepseek-production-key-1234567890",
    DEEPSEEK_URL: "https://api.deepseek.com",
    DEEPSEEK_MODEL: "deepseek-chat",
    SMS_PROVIDER: "none",
    WECHAT_MINIPROGRAM_APP_ID: "wx1234567890abcdef",
    WECHAT_MINIPROGRAM_APP_SECRET: "0123456789abcdef0123456789abcdef",
    WECHAT_PAY_APP_ID: "wx1234567890abcdef",
    WECHAT_PAY_MCH_ID: "1900000000",
    WECHAT_PAY_API_V3_KEY: "k".repeat(32),
    WECHAT_PAY_PRIVATE_KEY_PATH: "/run/secrets/wechat-pay-key.pem",
    WECHAT_PAY_CERT_SERIAL_NO: "SERIAL1",
    WECHAT_PAY_NOTIFY_BASE_URL: "https://api.talkandtalk.example",
    COMMERCIAL_RELEASE_MODE: "commercial",
    PLATFORM_FEE_BPS: "1200",
    COMPANION_SETTLEMENT_HOLD_HOURS: "96",
    REFUND_REQUEST_WINDOW_HOURS: "72",
    ORDER_RESPONSE_WINDOW_MINUTES: "10",
    ORDER_RESCHEDULE_RESPONSE_WINDOW_MINUTES: "720",
    ORDER_RESCHEDULE_EXPIRY_ENABLED: "true",
    ORDER_RESCHEDULE_EXPIRY_INTERVAL_SECONDS: "60",
    ORDER_RESCHEDULE_EXPIRY_BATCH_SIZE: "50",
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
      "serviceStarted", "serviceCompleted", "orderCancelled", "reservationExpired", "rescheduleRequested", "rescheduleAccepted", "rescheduleRejected", "rescheduleExpired", "rescheduleCancelled", "supportUpdate", "messageReceived"
    ].map((key) => ({ key, templateId: `TEMPLATE_${key}_123456`, page: "pages/orders/index", data: { thing1: "{{title}}" } }))),
    LEGAL_CONSENT_VERSION: "2.0-2026-07-20",
    LEGAL_OPERATOR_NAME: "上海示例网络科技有限公司",
    LEGAL_CONTACT_EMAIL: "privacy@example.com",
    LEGAL_CONTACT_PHONE: "021-12345678",
    LEGAL_COMPLAINT_CHANNEL: "小程序内客服工单",
    LEGAL_CONSENT_EFFECTIVE_DATE: "2026-07-20",
    LEGAL_PLATFORM_RULES_URL: "https://api.talkandtalk.example/api/v1/legal/platform-rules",
    LEGAL_PRIVACY_RETENTION_DAYS: "1095",
    PAYMENT_RECONCILIATION_ENABLED: "true"
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
    expect(env.MEDIA_FEATURE_ENABLED).toBe(false);
    expect(env.MEDIA_PROVIDER).toBe("disabled");
    expect(env.APP_ENV).toBe("development");
    expect(env.SMS_PROVIDER).toBe("mock");
    expect(env.STAFF_TOTP_ENCRYPTION_KEY).toContain("development-staff-totp-key");
    expect(env.SEED_ON_STARTUP).toBe(false);
    expect(env.PAYMENT_RECONCILIATION_ENABLED).toBe(true);
    expect(env.PAYMENT_RECONCILIATION_INTERVAL_SECONDS).toBe(60);
    expect(env.PAYMENT_RECONCILIATION_BATCH_SIZE).toBe(50);
    expect(env.ORDER_RESCHEDULE_EXPIRY_ENABLED).toBe(true);
    expect(env.ORDER_RESCHEDULE_EXPIRY_INTERVAL_SECONDS).toBe(60);
    expect(env.ORDER_RESCHEDULE_EXPIRY_BATCH_SIZE).toBe(50);
    expect(env.METRICS_TOKEN).toBe("");
    expect(env.LEGAL_CONSENT_VERSION).toBe("2.0-2026-07-20");
    expect(env.LEGAL_CONSENT_EFFECTIVE_DATE).toBe("2026-07-20");
    expect(env.LEGAL_PRIVACY_URL).toBe("https://api.talkandtalk.app/legal/privacy.html");
    expect(env.LEGAL_TERMS_URL).toBe("https://api.talkandtalk.app/legal/terms.html");
    expect(env.COMMERCIAL_RELEASE_MODE).toBe("internal");
    expect(env.PLATFORM_FEE_BPS).toBe(0);
    expect(env.ORDER_RESPONSE_WINDOW_MINUTES).toBe(10);
    expect(env.ORDER_RESCHEDULE_RESPONSE_WINDOW_MINUTES).toBe(720);
    expect(env.ORDER_MAX_SCHEDULE_DAYS).toBe(30);
    expect(env.SUPPORT_MAX_OPEN_PER_USER).toBe(5);
    expect(env.ORDER_INTAKE_ENABLED).toBe(true);
    expect(env.ORDER_MAX_OPEN_TOTAL).toBe(500);
    expect(env.ORDER_MAX_OPEN_PER_USER).toBe(3);
    expect(env.PAYOUT_CLAIMS_ENABLED).toBe(true);
    expect(env.REFUND_REQUEST_WINDOW_HOURS).toBe(72);
    expect(env.WECHAT_SUBSCRIBE_MESSAGES_ENABLED).toBe(false);
    expect(env.AVAILABILITY_REMINDER_PREPARATION_ENABLED).toBe(false);
    expect(env.AVAILABILITY_REMINDER_PREPARATION_INTERVAL_SECONDS).toBe(60);
    expect(env.AVAILABILITY_REMINDER_PREPARATION_BATCH_SIZE).toBe(20);
    expect(env.AVAILABILITY_REMINDER_DELIVERY_ENABLED).toBe(false);
    expect(env.AVAILABILITY_REMINDER_DELIVERY_INTERVAL_SECONDS).toBe(60);
    expect(env.AVAILABILITY_REMINDER_DELIVERY_BATCH_SIZE).toBe(20);
  });

  it("keeps availability-reminder preparation explicitly opt-in and bounds its internal work", () => {
    const enabled = validateEnvironment({
      AVAILABILITY_REMINDER_PREPARATION_ENABLED: "true",
      AVAILABILITY_REMINDER_PREPARATION_INTERVAL_SECONDS: "15",
      AVAILABILITY_REMINDER_PREPARATION_BATCH_SIZE: "100"
    });

    expect(enabled.AVAILABILITY_REMINDER_PREPARATION_ENABLED).toBe(true);
    expect(enabled.AVAILABILITY_REMINDER_PREPARATION_INTERVAL_SECONDS).toBe(15);
    expect(enabled.AVAILABILITY_REMINDER_PREPARATION_BATCH_SIZE).toBe(100);
    expect(() => validateEnvironment({ AVAILABILITY_REMINDER_PREPARATION_INTERVAL_SECONDS: "14" }))
      .toThrow("AVAILABILITY_REMINDER_PREPARATION_INTERVAL_SECONDS");
    expect(() => validateEnvironment({ AVAILABILITY_REMINDER_PREPARATION_BATCH_SIZE: "101" }))
      .toThrow("AVAILABILITY_REMINDER_PREPARATION_BATCH_SIZE");
  });

  it("keeps availability-reminder delivery explicitly opt-in and requires its live subscribe template", () => {
    const templates = JSON.stringify([
      {
        key: "availabilityReminder",
        templateId: "TEMPLATE_availabilityReminder_123456",
        page: "pages/companions/index",
        data: { thing1: "{{title}}" }
      }
    ]);
    const enabled = validateEnvironment({
      AVAILABILITY_REMINDER_DELIVERY_ENABLED: "true",
      AVAILABILITY_REMINDER_DELIVERY_INTERVAL_SECONDS: "15",
      AVAILABILITY_REMINDER_DELIVERY_BATCH_SIZE: "100",
      WECHAT_SUBSCRIBE_MESSAGES_ENABLED: "true",
      WECHAT_SUBSCRIBE_TEMPLATES_JSON: templates
    });

    expect(enabled.AVAILABILITY_REMINDER_DELIVERY_ENABLED).toBe(true);
    expect(enabled.AVAILABILITY_REMINDER_DELIVERY_INTERVAL_SECONDS).toBe(15);
    expect(enabled.AVAILABILITY_REMINDER_DELIVERY_BATCH_SIZE).toBe(100);
    expect(() => validateEnvironment({ AVAILABILITY_REMINDER_DELIVERY_INTERVAL_SECONDS: "14" }))
      .toThrow("AVAILABILITY_REMINDER_DELIVERY_INTERVAL_SECONDS");
    expect(() => validateEnvironment({ AVAILABILITY_REMINDER_DELIVERY_BATCH_SIZE: "101" }))
      .toThrow("AVAILABILITY_REMINDER_DELIVERY_BATCH_SIZE");
    expect(() => validateEnvironment({ AVAILABILITY_REMINDER_DELIVERY_ENABLED: "true" }))
      .toThrow("WECHAT_SUBSCRIBE_MESSAGES_ENABLED=true");
    expect(() => validateEnvironment({
      AVAILABILITY_REMINDER_DELIVERY_ENABLED: "true",
      WECHAT_SUBSCRIBE_MESSAGES_ENABLED: "true",
      WECHAT_SUBSCRIBE_TEMPLATES_JSON: JSON.stringify([
        { key: "newOrder", templateId: "TEMPLATE_newOrder_123456", data: { thing1: "{{title}}" } }
      ])
    })).toThrow("availabilityReminder subscribe template");
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

  it("cannot run production app policy under a test or development runtime", () => {
    expect(() => validateEnvironment({ ...productionEnv, NODE_ENV: "test" }))
      .toThrow("NODE_ENV=production");
    expect(() => validateEnvironment({ ...productionEnv, NODE_ENV: "development" }))
      .toThrow("NODE_ENV=production");
  });

  it("requires a concrete HTTPS content moderation provider in production", () => {
    expect(() => validateEnvironment({ ...productionEnv, DEEPSEEK_API_KEY: "" }))
      .toThrow("DEEPSEEK_API_KEY");
    expect(() => validateEnvironment({ ...productionEnv, DEEPSEEK_API_KEY: "too-short" }))
      .toThrow("at least 24");
    expect(() => validateEnvironment({ ...productionEnv, DEEPSEEK_URL: "" }))
      .toThrow("DEEPSEEK_URL");
    expect(() => validateEnvironment({ ...productionEnv, DEEPSEEK_MODEL: "" }))
      .toThrow("DEEPSEEK_MODEL");
    expect(() => validateEnvironment({ ...productionEnv, DEEPSEEK_API_KEY: "REPLACE_ME_WITH_PRODUCTION_KEY" }))
      .toThrow("placeholder");
    expect(() => validateEnvironment({ ...productionEnv, DEEPSEEK_URL: "http://moderation.internal" }))
      .toThrow("absolute HTTPS");
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

  it("keeps media closed by default and rejects an unregistered production media provider", () => {
    const development = validateEnvironment({ MEDIA_FEATURE_ENABLED: "true", MEDIA_PROVIDER: "mock" });
    expect(development.MEDIA_FEATURE_ENABLED).toBe(true);
    expect(() => validateEnvironment({ ...productionEnv, MEDIA_FEATURE_ENABLED: "true", MEDIA_PROVIDER: "mock" }))
      .toThrow("MEDIA_FEATURE_ENABLED");
    expect(() => validateEnvironment({ MEDIA_PROVIDER: "unknown" }))
      .toThrow("MEDIA_PROVIDER");
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

  it("blocks a production commercial release without concrete legal disclosures and transactional notifications", () => {
    expect(() => validateEnvironment({
      ...productionEnv,
      LEGAL_OPERATOR_NAME: ""
    })).toThrow("LEGAL_OPERATOR_NAME");
    expect(() => validateEnvironment({
      ...productionEnv,
      WECHAT_SUBSCRIBE_MESSAGES_ENABLED: "false"
    })).toThrow("Production commercial release requires");
  });

  it("keeps a 24-hour operational buffer after the production refund window", () => {
    expect(() => validateEnvironment({
      ...productionEnv,
      COMPANION_SETTLEMENT_HOLD_HOURS: "95"
    })).toThrow("REFUND_REQUEST_WINDOW_HOURS + 24");
  });

  it("requires an explicit commercial mode in production", () => {
    expect(() => validateEnvironment({
      ...productionEnv,
      COMMERCIAL_RELEASE_MODE: "internal"
    })).toThrow("COMMERCIAL_RELEASE_MODE=commercial");
  });

  it("requires the complete, non-duplicated transactional notification template map in production", () => {
    expect(() => validateEnvironment({
      ...productionEnv,
      WECHAT_SUBSCRIBE_TEMPLATES_JSON: JSON.stringify([
        { key: "orderConfirmed", templateId: "TEMPLATE_123456", page: "pages/orders/index", data: { thing1: "{{title}}" } }
      ])
    })).toThrow("missing event keys");
    expect(() => validateEnvironment({
      ...productionEnv,
      WECHAT_SUBSCRIBE_TEMPLATES_JSON: JSON.stringify([
        { key: "newOrder", templateId: "TEMPLATE_123456", page: "pages/orders/index", data: { thing1: "{{title}}" } },
        { key: "orderConfirmed", templateId: "TEMPLATE_123456", page: "pages/orders/index", data: { thing1: "{{title}}" } }
      ])
    })).toThrow("templateId is invalid");
  });

  it("requires explicit database and Redis URLs in production", () => {
    expect(() => validateEnvironment({
      ...productionEnv,
      DATABASE_URL: ""
    })).toThrow("DATABASE_URL and REDIS_URL");
  });

  it("requires explicit bounded order intake and payout controls in production", () => {
    expect(() => validateEnvironment({ ...productionEnv, ORDER_INTAKE_ENABLED: "" }))
      .toThrow("ORDER_INTAKE_ENABLED");
    expect(() => validateEnvironment({ ...productionEnv, ORDER_MAX_OPEN_PER_USER: "0" }))
      .toThrow("ORDER_MAX_OPEN_PER_USER");
    expect(() => validateEnvironment({ ...productionEnv, PAYOUT_CLAIMS_ENABLED: "" }))
      .toThrow("PAYOUT_CLAIMS_ENABLED");
    expect(() => validateEnvironment({ ...productionEnv, ORDER_RESCHEDULE_EXPIRY_ENABLED: "" }))
      .toThrow("ORDER_RESCHEDULE_EXPIRY_ENABLED");
  });

  it("rejects invalid dependency protocols and numeric limits", () => {
    expect(() => validateEnvironment({ DATABASE_URL: "https://db.example" })).toThrow("DATABASE_URL");
    expect(() => validateEnvironment({ REDIS_URL: "https://redis.example" })).toThrow("REDIS_URL");
    expect(() => validateEnvironment({ RATE_LIMIT_PER_MINUTE: "-1" })).toThrow("positive integer");
    expect(() => validateEnvironment({ SMS_CODE_TTL_SECONDS: "not-a-number" })).toThrow("positive integer");
    expect(() => validateEnvironment({ PAYMENT_RECONCILIATION_INTERVAL_SECONDS: "0" })).toThrow("positive integer");
    expect(() => validateEnvironment({ ORDER_RESCHEDULE_EXPIRY_INTERVAL_SECONDS: "0" })).toThrow("positive integer");
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

  it("rejects implausible production WeChat identity fields before serving traffic", () => {
    expect(() => validateEnvironment({ ...productionEnv, WECHAT_MINIPROGRAM_APP_ID: "wx-short" }))
      .toThrow("real WeChat AppID");
    expect(() => validateEnvironment({ ...productionEnv, WECHAT_MINIPROGRAM_APP_SECRET: "short" }))
      .toThrow("unexpectedly short");
    expect(() => validateEnvironment({ ...productionEnv, WECHAT_PAY_MCH_ID: "merchant" }))
      .toThrow("6-32 digits");
  });

  it("requires a WeChat payment app id in production", () => {
    expect(() => validateEnvironment({
      ...productionEnv,
      WECHAT_PAY_APP_ID: ""
    })).toThrow("WECHAT_PAY_APP_ID");
  });

  it("allows an inline CloudBase payment private key in production", () => {
    const env = validateEnvironment({
      ...productionEnv,
      WECHAT_PAY_PRIVATE_KEY_PATH: "",
      WECHAT_PAY_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nprivate-key-material\\n-----END PRIVATE KEY-----"
    });

    expect(env.WECHAT_PAY_PRIVATE_KEY).toContain("BEGIN PRIVATE KEY");
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
