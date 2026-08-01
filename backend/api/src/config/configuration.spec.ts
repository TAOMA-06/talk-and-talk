import { validateEnvironment } from "./configuration";
import transactionalTemplateManifest = require("../../config/transactional-template-manifest.js");

describe("validateEnvironment", () => {
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
  const productionEnv = {
    NODE_ENV: "production",
    APP_ENV: "production",
    CORS_ORIGINS: "https://api.talkandtalk.example",
    DATABASE_URL: "postgresql://talk:strong-password@db:5432/talk_and_talk",
    REDIS_URL: "rediss://redis:6379",
    JWT_ACCESS_SECRET: "a".repeat(32),
    JWT_REFRESH_SECRET: "b".repeat(32),
    REVIEW_JWT_ACCESS_SECRET: "c".repeat(32),
    REVIEW_JWT_REFRESH_SECRET: "d".repeat(32),
    METRICS_TOKEN: "m".repeat(32),
    STAFF_TOTP_ENCRYPTION_KEY: "t".repeat(32),
    REVIEW_TOTP_ENCRYPTION_KEY: "r".repeat(32),
    AUTH_IDENTITY_TOMBSTONE_HMAC_KEYS: JSON.stringify({
      "prod-v1": Buffer.from("auth-tombstone-test-key-material-0001", "utf8").toString("base64")
    }),
    AUTH_IDENTITY_TOMBSTONE_ACTIVE_KEY_ID: "prod-v1",
    AUTH_IDENTITY_REREGISTRATION_POLICY: "after_tombstone_expiry",
    EXTERNAL_AI_USER_CONTENT_ENABLED: "false",
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
    REFUND_POLICY_VERSION: "2026.08-v1",
    REFUND_POLICY_APPROVED: "true",
    REFUND_POLICY_APPROVAL_REFERENCE: "legal:refund-policy-2026-08",
    REFUND_REQUEST_WINDOW_HOURS: "72",
    REFUND_REVIEW_SLA_HOURS: "24",
    REFUND_RESOLUTION_SLA_HOURS: "72",
    ORDER_RESPONSE_WINDOW_MINUTES: "10",
    ORDER_CHAT_PRE_SERVICE_WINDOW_MINUTES: "15",
    ORDER_CHAT_POST_SERVICE_WINDOW_MINUTES: "15",
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
    SUPPORT_PUBLIC_SERVICE_HOURS: "每天 09:00-21:00（北京时间）",
    SUPPORT_PUBLIC_STATUS_URL: "https://status.talkandtalk.example",
    DATA_EXPORT_DELIVERY_BASE_URL: "https://vault.talkandtalk.example",
    DATA_EXPORT_DELIVERY_API_KEY: "v".repeat(32),
    DATA_EXPORT_DELIVERY_TIMEOUT_MS: "10000",
    DATA_EXPORT_MAX_BYTES: String(50 * 1024 * 1024),
    COMPANION_APPEAL_SUBMISSION_DAYS: "30",
    COMPANION_APPEAL_RESPONSE_HOURS: "72",
    NOTIFICATION_DELIVERY_ENABLED: "true",
    WECHAT_SUBSCRIBE_MESSAGES_ENABLED: "true",
    WECHAT_SUBSCRIBE_TEMPLATES_JSON: JSON.stringify(transactionalTemplateManifest.map(({ key, defaultPage }) => ({
      key,
      templateId: `TEMPLATE_${key}_123456`,
      page: defaultPage,
      data: { thing1: "{{title}}" }
    }))),
    LEGAL_CONSENT_VERSION: "2.2-2026-08-01",
    LEGAL_OPERATOR_NAME: "上海示例网络科技有限公司",
    LEGAL_CONTACT_EMAIL: "privacy@example.com",
    LEGAL_CONTACT_PHONE: "021-12345678",
    LEGAL_COMPLAINT_CHANNEL: "小程序内客服工单",
    LEGAL_CONSENT_EFFECTIVE_DATE: "2026-08-01",
    LEGAL_PLATFORM_RULES_URL: "https://api.talkandtalk.example/api/v1/legal/platform-rules",
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
    WECHAT_PAY_COMPLAINT_BATCH_SIZE: "50"
  };

  it("applies defaults", () => {
    const env = validateEnvironment({});

    expect(env.PORT).toBe(3000);
    expect(env.HOST).toBe("127.0.0.1");
    expect(env.API_PREFIX).toBe("api/v1");
    expect(env.APP_VERSION).toBe("0.1.0");
    expect(env.CORS_ORIGINS).toContain("http://localhost:3000");
    expect(env.EXTERNAL_AI_USER_CONTENT_ENABLED).toBe(false);
    expect(env.MEDIA_FEATURE_ENABLED).toBe(false);
    expect(env.MEDIA_PROVIDER).toBe("disabled");
    expect(env.TRTC_ENABLED).toBe(false);
    expect(env.TRTC_SDK_APP_ID).toBe(0);
    expect(env.TRTC_PRIVATE_MAP_KEY_ENABLED).toBe(false);
    expect(env.TRTC_USER_SIG_TTL_SECONDS).toBe(300);
    expect(env.TRTC_PRIVACY_DISCLOSURE_APPROVED).toBe(false);
    expect(env.TRTC_PRIVACY_DISCLOSURE_REFERENCE).toBe("");
    expect(env.TRTC_ROOM_CONTROL_ENABLED).toBe(false);
    expect(env.TRTC_EMERGENCY_STOP_ENABLED).toBe(false);
    expect(env.TRTC_CONTROL_REGION).toBe("ap-guangzhou");
    expect(env.TRTC_CONTROL_TIMEOUT_MS).toBe(5_000);
    expect(env.TRTC_ROOM_CONTROL_INTERVAL_SECONDS).toBe(15);
    expect(env.TRTC_ROOM_CONTROL_BATCH_SIZE).toBe(10);
    expect(env.APP_ENV).toBe("development");
    expect(env.SMS_PROVIDER).toBe("mock");
    expect(env.STAFF_TOTP_ENCRYPTION_KEY).toContain("development-staff-totp-key");
    expect(env.REVIEW_TOTP_ENCRYPTION_KEY).toContain("development-review-totp-key");
    expect(env.REVIEW_JWT_ACCESS_TTL).toBe("15m");
    expect(env.REVIEW_JWT_REFRESH_TTL).toBe("8h");
    expect(JSON.parse(env.AUTH_IDENTITY_TOMBSTONE_HMAC_KEYS)).toHaveProperty("dev-v1");
    expect(env.AUTH_IDENTITY_TOMBSTONE_ACTIVE_KEY_ID).toBe("dev-v1");
    expect(env.AUTH_IDENTITY_REREGISTRATION_POLICY).toBe("after_tombstone_expiry");
    expect(env.SEED_ON_STARTUP).toBe(false);
    expect(env.PAYMENT_RECONCILIATION_ENABLED).toBe(true);
    expect(env.PAYMENT_RECONCILIATION_INTERVAL_SECONDS).toBe(60);
    expect(env.PAYMENT_RECONCILIATION_BATCH_SIZE).toBe(50);
    expect(env.WECHAT_DAILY_BILL_RECONCILIATION_ENABLED).toBe(false);
    expect(env.WECHAT_DAILY_BILL_RECONCILIATION_APPROVED).toBe(false);
    expect(env.WECHAT_DAILY_BILL_RECONCILIATION_APPROVAL_REFERENCE).toBe("");
    expect(env.WECHAT_DAILY_BILL_RECONCILIATION_START_DATE).toBe("");
    expect(env.WECHAT_DAILY_BILL_RECONCILIATION_HOUR).toBe(10);
    expect(env.WECHAT_DAILY_BILL_RECONCILIATION_BATCH_SIZE).toBe(4);
    expect(env.ORDER_RESCHEDULE_EXPIRY_ENABLED).toBe(true);
    expect(env.ORDER_RESCHEDULE_EXPIRY_INTERVAL_SECONDS).toBe(60);
    expect(env.ORDER_RESCHEDULE_EXPIRY_BATCH_SIZE).toBe(50);
    expect(env.METRICS_TOKEN).toBe("");
    expect(env.LEGAL_CONSENT_VERSION).toBe("2.2-2026-08-01");
    expect(env.LEGAL_CONSENT_EFFECTIVE_DATE).toBe("2026-08-01");
    expect(env.LEGAL_PRIVACY_URL).toBe("https://api.talkandtalk.app/legal/privacy.html");
    expect(env.LEGAL_TERMS_URL).toBe("https://api.talkandtalk.app/legal/terms.html");
    expect(env.ACCOUNT_DELETION_RETENTION_POLICY_APPROVED).toBe(false);
    expect(env.ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE).toBe("");
    expect(env.ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_APPROVED).toBe(false);
    expect(env.ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_VERSION).toBe("");
    expect(env.ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_APPROVAL_REFERENCE).toBe("");
    expect(env.ACCOUNT_DATA_RETENTION_LEGAL_HOLD_REASON_CODES_JSON).toBe("[]");
    expect(env.CRISIS_RESOURCES_APPROVED).toBe(false);
    expect(env.CRISIS_RESOURCES_APPROVAL_REFERENCE).toBe("");
    expect(env.COMMERCIAL_RELEASE_MODE).toBe("internal");
    expect(env.COMPANION_VOICE_EVIDENCE_VIEWER_URL).toBe("");
    expect(env.COMPANION_VOICE_EVIDENCE_SIGNING_SECRET).toBe("");
    expect(env.COMPANION_VOICE_EVIDENCE_URL_TTL_SECONDS).toBe(300);
    expect(env.PLATFORM_FEE_BPS).toBe(0);
    expect(env.REFUND_POLICY_VERSION).toBe("development-v1");
    expect(env.REFUND_POLICY_APPROVED).toBe(false);
    expect(env.REFUND_POLICY_APPROVAL_REFERENCE).toBe("");
    expect(env.ORDER_RESPONSE_WINDOW_MINUTES).toBe(10);
    expect(env.ORDER_CHAT_PRE_SERVICE_WINDOW_MINUTES).toBe(15);
    expect(env.ORDER_CHAT_POST_SERVICE_WINDOW_MINUTES).toBe(15);
    expect(env.ORDER_RESCHEDULE_RESPONSE_WINDOW_MINUTES).toBe(720);
    expect(env.ORDER_MAX_SCHEDULE_DAYS).toBe(30);
    expect(env.SUPPORT_MAX_OPEN_PER_USER).toBe(5);
    expect(env.SUPPORT_PUBLIC_SERVICE_HOURS).toBe("工作日 09:00-18:00（北京时间）");
    expect(env.SUPPORT_PUBLIC_STATUS_URL).toBe("");
    expect(env.DATA_EXPORT_DELIVERY_BASE_URL).toBe("");
    expect(env.DATA_EXPORT_DELIVERY_API_KEY).toBe("");
    expect(env.DATA_EXPORT_DELIVERY_TIMEOUT_MS).toBe(10_000);
    expect(env.DATA_EXPORT_MAX_BYTES).toBe(50 * 1024 * 1024);
    expect(env.COMPANION_APPEAL_SUBMISSION_DAYS).toBe(30);
    expect(env.COMPANION_APPEAL_RESPONSE_HOURS).toBe(72);
    expect(env.ORDER_INTAKE_ENABLED).toBe(true);
    expect(env.ORDER_MAX_OPEN_TOTAL).toBe(500);
    expect(env.ORDER_MAX_OPEN_PER_USER).toBe(3);
    expect(env.PAYOUT_CLAIMS_ENABLED).toBe(true);
    expect(env.REFUND_REQUEST_WINDOW_HOURS).toBe(72);
    expect(env.REFUND_REVIEW_SLA_HOURS).toBe(24);
    expect(env.REFUND_RESOLUTION_SLA_HOURS).toBe(72);
    expect(env.WECHAT_SUBSCRIBE_MESSAGES_ENABLED).toBe(false);
    expect(env.AVAILABILITY_REMINDER_PREPARATION_ENABLED).toBe(false);
    expect(env.AVAILABILITY_REMINDER_PREPARATION_INTERVAL_SECONDS).toBe(60);
    expect(env.AVAILABILITY_REMINDER_PREPARATION_BATCH_SIZE).toBe(20);
    expect(env.AVAILABILITY_REMINDER_FANOUT_BATCH_SIZE).toBe(200);
    expect(env.AVAILABILITY_REMINDER_FANOUT_BATCHES_PER_RUN).toBe(20);
    expect(env.AVAILABILITY_REMINDER_FANOUT_LEASE_SECONDS).toBe(120);
    expect(env.AVAILABILITY_REMINDER_FANOUT_MAX_FAILURES).toBe(8);
    expect(env.AVAILABILITY_REMINDER_FANOUT_RETRY_BASE_SECONDS).toBe(30);
    expect(env.AVAILABILITY_REMINDER_DELIVERY_ENABLED).toBe(false);
    expect(env.AVAILABILITY_REMINDER_DELIVERY_INTERVAL_SECONDS).toBe(60);
    expect(env.AVAILABILITY_REMINDER_DELIVERY_BATCH_SIZE).toBe(20);
  });

  it("validates the login-independent support disclosure", () => {
    const configured = validateEnvironment({
      SUPPORT_PUBLIC_SERVICE_HOURS: "每天 09:00-21:00（北京时间）",
      SUPPORT_PUBLIC_STATUS_URL: "https://status.talkandtalk.example"
    });

    expect(configured.SUPPORT_PUBLIC_SERVICE_HOURS).toBe("每天 09:00-21:00（北京时间）");
    expect(configured.SUPPORT_PUBLIC_STATUS_URL).toBe("https://status.talkandtalk.example");
    expect(() => validateEnvironment({
      SUPPORT_PUBLIC_STATUS_URL: "http://status.talkandtalk.example"
    })).toThrow("SUPPORT_PUBLIC_STATUS_URL");
    expect(() => validateEnvironment({
      SUPPORT_PUBLIC_SERVICE_HOURS: "a".repeat(121)
    })).toThrow("SUPPORT_PUBLIC_SERVICE_HOURS");
  });

  it("validates secure data-export delivery bounds and HTTPS origin", () => {
    const configured = validateEnvironment({
      DATA_EXPORT_DELIVERY_BASE_URL: "https://vault.example.com/root/",
      DATA_EXPORT_DELIVERY_API_KEY: "test-provider-key",
      DATA_EXPORT_DELIVERY_TIMEOUT_MS: "5000",
      DATA_EXPORT_MAX_BYTES: "1048576"
    });

    expect(configured.DATA_EXPORT_DELIVERY_BASE_URL).toBe("https://vault.example.com/root/");
    expect(configured.DATA_EXPORT_DELIVERY_TIMEOUT_MS).toBe(5000);
    expect(configured.DATA_EXPORT_MAX_BYTES).toBe(1048576);
    expect(() => validateEnvironment({
      DATA_EXPORT_DELIVERY_BASE_URL: "http://vault.example.com"
    })).toThrow("DATA_EXPORT_DELIVERY_BASE_URL");
    expect(() => validateEnvironment({
      DATA_EXPORT_DELIVERY_TIMEOUT_MS: "999"
    })).toThrow("DATA_EXPORT_DELIVERY_TIMEOUT_MS");
    expect(() => validateEnvironment({
      DATA_EXPORT_MAX_BYTES: "101"
    })).toThrow("DATA_EXPORT_MAX_BYTES");
  });

  it("bounds companion appeal submission and response commitments", () => {
    const configured = validateEnvironment({
      COMPANION_APPEAL_SUBMISSION_DAYS: "45",
      COMPANION_APPEAL_RESPONSE_HOURS: "48"
    });

    expect(configured.COMPANION_APPEAL_SUBMISSION_DAYS).toBe(45);
    expect(configured.COMPANION_APPEAL_RESPONSE_HOURS).toBe(48);
    expect(() => validateEnvironment({
      COMPANION_APPEAL_SUBMISSION_DAYS: "0"
    })).toThrow("COMPANION_APPEAL_SUBMISSION_DAYS");
    expect(() => validateEnvironment({
      COMPANION_APPEAL_RESPONSE_HOURS: "721"
    })).toThrow("COMPANION_APPEAL_RESPONSE_HOURS");
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

    const fanout = validateEnvironment({
      AVAILABILITY_REMINDER_FANOUT_BATCH_SIZE: "1000",
      AVAILABILITY_REMINDER_FANOUT_BATCHES_PER_RUN: "100",
      AVAILABILITY_REMINDER_FANOUT_LEASE_SECONDS: "900",
      AVAILABILITY_REMINDER_FANOUT_MAX_FAILURES: "50",
      AVAILABILITY_REMINDER_FANOUT_RETRY_BASE_SECONDS: "900"
    });
    expect(fanout.AVAILABILITY_REMINDER_FANOUT_BATCH_SIZE).toBe(1000);
    expect(fanout.AVAILABILITY_REMINDER_FANOUT_BATCHES_PER_RUN).toBe(100);
    expect(fanout.AVAILABILITY_REMINDER_FANOUT_LEASE_SECONDS).toBe(900);
    expect(fanout.AVAILABILITY_REMINDER_FANOUT_MAX_FAILURES).toBe(50);
    expect(fanout.AVAILABILITY_REMINDER_FANOUT_RETRY_BASE_SECONDS).toBe(900);
    expect(() => validateEnvironment({ AVAILABILITY_REMINDER_FANOUT_BATCH_SIZE: "1001" }))
      .toThrow("AVAILABILITY_REMINDER_FANOUT_BATCH_SIZE");
    expect(() => validateEnvironment({ AVAILABILITY_REMINDER_FANOUT_LEASE_SECONDS: "29" }))
      .toThrow("AVAILABILITY_REMINDER_FANOUT_LEASE_SECONDS");
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
      JWT_REFRESH_SECRET: "staging-refresh",
      REVIEW_JWT_ACCESS_SECRET: "staging-review-access",
      REVIEW_JWT_REFRESH_SECRET: "staging-review-refresh"
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

  it("keeps all user-authored content local-only and rejects stale DeepSeek credentials", () => {
    expect(() => validateEnvironment({
      ...productionEnv,
      EXTERNAL_AI_USER_CONTENT_ENABLED: ""
    })).toThrow("must be explicitly configured");
    expect(() => validateEnvironment({
      ...productionEnv,
      EXTERNAL_AI_USER_CONTENT_ENABLED: "true"
    })).toThrow("user-authored content must remain local-only");
    expect(() => validateEnvironment({
      ...productionEnv,
      DEEPSEEK_API_KEY: "deepseek-production-key-1234567890"
    })).toThrow("generic DeepSeek service is not approved");
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

  it("requires independent review-department secrets in production", () => {
    expect(() => validateEnvironment({
      ...productionEnv,
      REVIEW_JWT_ACCESS_SECRET: ""
    })).toThrow("REVIEW_JWT_ACCESS_SECRET");
    expect(() => validateEnvironment({
      ...productionEnv,
      REVIEW_TOTP_ENCRYPTION_KEY: productionEnv.STAFF_TOTP_ENCRYPTION_KEY
    })).toThrow("REVIEW_TOTP_ENCRYPTION_KEY must not reuse STAFF_TOTP_ENCRYPTION_KEY");
    expect(() => validateEnvironment({
      ...productionEnv,
      REVIEW_JWT_ACCESS_SECRET: productionEnv.JWT_ACCESS_SECRET
    })).toThrow("Review JWT secrets must not reuse consumer JWT secrets");
  });

  it("keeps media closed by default and rejects an unregistered production media provider", () => {
    const development = validateEnvironment({ MEDIA_FEATURE_ENABLED: "true", MEDIA_PROVIDER: "mock" });
    expect(development.MEDIA_FEATURE_ENABLED).toBe(true);
    expect(() => validateEnvironment({ ...productionEnv, MEDIA_FEATURE_ENABLED: "true", MEDIA_PROVIDER: "mock" }))
      .toThrow("MEDIA_FEATURE_ENABLED");
    expect(() => validateEnvironment({ MEDIA_PROVIDER: "unknown" }))
      .toThrow("MEDIA_PROVIDER");
  });

  it("requires a restricted, server-side TRTC signing configuration before enabling real-time voice", () => {
    expect(() => validateEnvironment({ TRTC_ENABLED: "true" }))
      .toThrow("TRTC_ENABLED=true requires");
    expect(() => validateEnvironment({
      TRTC_ENABLED: "true",
      TRTC_SDK_APP_ID: "1400000001",
      TRTC_SDK_SECRET_KEY: "too-short",
      TRTC_CALLBACK_SIGNING_KEY: "CallbackKey1234567890",
      TRTC_PRIVATE_MAP_KEY_ENABLED: "true",
      TRTC_PRIVACY_DISCLOSURE_APPROVED: "true",
      TRTC_PRIVACY_DISCLOSURE_REFERENCE: "legal:trtc-disclosure-2026-08"
    })).toThrow("TRTC_SDK_SECRET_KEY");
    expect(() => validateEnvironment({ TRTC_USER_SIG_TTL_SECONDS: "59" }))
      .toThrow("TRTC_USER_SIG_TTL_SECONDS");
    expect(() => validateEnvironment({ TRTC_ROOM_CONTROL_ENABLED: "true" }))
      .toThrow("TRTC_ROOM_CONTROL_ENABLED=true requires");
    expect(() => validateEnvironment({ TRTC_EMERGENCY_STOP_ENABLED: "true" }))
      .toThrow("TRTC_EMERGENCY_STOP_ENABLED=true requires");

    const enabled = validateEnvironment({
      TRTC_ENABLED: "true",
      TRTC_SDK_APP_ID: "1400000001",
      TRTC_SDK_SECRET_KEY: "trtc-test-secret-key-material",
      TRTC_CALLBACK_SIGNING_KEY: "CallbackKey1234567890",
      TRTC_PRIVATE_MAP_KEY_ENABLED: "true",
      TRTC_USER_SIG_TTL_SECONDS: "600",
      TRTC_PRIVACY_DISCLOSURE_APPROVED: "true",
      TRTC_PRIVACY_DISCLOSURE_REFERENCE: "legal:trtc-disclosure-2026-08",
      TRTC_ROOM_CONTROL_ENABLED: "true",
      TRTC_CONTROL_REGION: "ap-beijing",
      TRTC_CONTROL_TIMEOUT_MS: "8000",
      TRTC_ROOM_CONTROL_INTERVAL_SECONDS: "20",
      TRTC_ROOM_CONTROL_BATCH_SIZE: "5",
      TENCENTCLOUD_SECRET_ID: "AKID_test_voice_control",
      TENCENTCLOUD_SECRET_KEY: "tencent-cloud-control-secret-material"
    });
    expect(enabled.TRTC_ENABLED).toBe(true);
    expect(enabled.TRTC_SDK_APP_ID).toBe(1400000001);
    expect(enabled.TRTC_CALLBACK_SIGNING_KEY).toBe("CallbackKey1234567890");
    expect(enabled.TRTC_USER_SIG_TTL_SECONDS).toBe(600);
    expect(enabled.TRTC_PRIVACY_DISCLOSURE_APPROVED).toBe(true);
    expect(enabled.TRTC_PRIVACY_DISCLOSURE_REFERENCE).toBe("legal:trtc-disclosure-2026-08");
    expect(enabled.TRTC_ROOM_CONTROL_ENABLED).toBe(true);
    expect(enabled.TRTC_EMERGENCY_STOP_ENABLED).toBe(false);
    expect(enabled.TRTC_CONTROL_REGION).toBe("ap-beijing");
    expect(enabled.TRTC_ROOM_CONTROL_INTERVAL_SECONDS).toBe(20);

    const emergencyDrain = validateEnvironment({
      TRTC_ENABLED: "true",
      TRTC_SDK_APP_ID: "1400000001",
      TRTC_SDK_SECRET_KEY: "trtc-test-secret-key-material",
      TRTC_CALLBACK_SIGNING_KEY: "CallbackKey1234567890",
      TRTC_PRIVATE_MAP_KEY_ENABLED: "true",
      TRTC_PRIVACY_DISCLOSURE_APPROVED: "true",
      TRTC_PRIVACY_DISCLOSURE_REFERENCE: "legal:trtc-disclosure-2026-08",
      TRTC_ROOM_CONTROL_ENABLED: "true",
      TENCENTCLOUD_SECRET_ID: "AKID_test_voice_control",
      TENCENTCLOUD_SECRET_KEY: "tencent-cloud-control-secret-material",
      TRTC_EMERGENCY_STOP_ENABLED: "true"
    });
    expect(emergencyDrain.TRTC_EMERGENCY_STOP_ENABLED).toBe(true);
  });

  it("provides JWT defaults in development", () => {
    const env = validateEnvironment({});
    expect(env.JWT_ACCESS_SECRET).toBe("dev-access-secret");
    expect(env.JWT_REFRESH_SECRET).toBe("dev-refresh-secret");
    expect(env.JWT_ACCESS_TTL).toBe("15m");
    expect(env.JWT_REFRESH_TTL).toBe("30d");
  });

  it("accepts canonical consumer JWT TTLs at their supported boundaries", () => {
    const minimums = validateEnvironment({
      JWT_ACCESS_TTL: "300s",
      JWT_REFRESH_TTL: "1h"
    });
    expect(minimums.JWT_ACCESS_TTL).toBe("300s");
    expect(minimums.JWT_REFRESH_TTL).toBe("1h");

    const maximums = validateEnvironment({
      JWT_ACCESS_TTL: "60m",
      JWT_REFRESH_TTL: "90d"
    });
    expect(maximums.JWT_ACCESS_TTL).toBe("60m");
    expect(maximums.JWT_REFRESH_TTL).toBe("90d");

    const trimmed = validateEnvironment({
      JWT_ACCESS_TTL: " 15m ",
      JWT_REFRESH_TTL: " 30d "
    });
    expect(trimmed.JWT_ACCESS_TTL).toBe("15m");
    expect(trimmed.JWT_REFRESH_TTL).toBe("30d");
  });

  it("rejects malformed, unsafe, or inverted consumer JWT TTLs during startup", () => {
    for (const value of ["0m", "01m", "15", "1.5h", "15M", "unlimited"]) {
      expect(() => validateEnvironment({ JWT_ACCESS_TTL: value }))
        .toThrow("JWT_ACCESS_TTL");
    }
    expect(() => validateEnvironment({ JWT_ACCESS_TTL: "299s" }))
      .toThrow("between 5 minutes and 1 hour");
    expect(() => validateEnvironment({ JWT_ACCESS_TTL: "61m" }))
      .toThrow("between 5 minutes and 1 hour");
    expect(() => validateEnvironment({ JWT_REFRESH_TTL: "59m" }))
      .toThrow("between 1 hour and 90 days");
    expect(() => validateEnvironment({ JWT_REFRESH_TTL: "91d" }))
      .toThrow("between 1 hour and 90 days");
    expect(() => validateEnvironment({ JWT_ACCESS_TTL: "1h", JWT_REFRESH_TTL: "1h" }))
      .toThrow("JWT_REFRESH_TTL must be greater than JWT_ACCESS_TTL");
  });

  it("requires JWT secrets in production", () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: "production",
        CORS_ORIGINS: "https://app.example.com",
        AUTH_IDENTITY_TOMBSTONE_HMAC_KEYS: productionEnv.AUTH_IDENTITY_TOMBSTONE_HMAC_KEYS,
        AUTH_IDENTITY_TOMBSTONE_ACTIVE_KEY_ID: productionEnv.AUTH_IDENTITY_TOMBSTONE_ACTIVE_KEY_ID,
        AUTH_IDENTITY_REREGISTRATION_POLICY: "after_tombstone_expiry"
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

  it("requires external legal approval before production account-deletion retention is enabled", () => {
    expect(() => validateEnvironment({
      ...productionEnv,
      ACCOUNT_DELETION_RETENTION_POLICY_APPROVED: "false",
      ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE: ""
    })).toThrow("approved retention policy and approval reference");
    expect(() => validateEnvironment({
      ...productionEnv,
      ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE: ""
    })).toThrow("APPROVED=true requires");
    expect(() => validateEnvironment({
      ...productionEnv,
      ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE: "raw secret with spaces"
    })).toThrow("6-160 character non-secret reference");
  });

  it("keeps production legal holds blocked until a controlled policy catalog is approved", () => {
    expect(() => validateEnvironment({
      ...productionEnv,
      ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_APPROVED: "false"
    })).toThrow("Production data-retention legal holds require");
    expect(() => validateEnvironment({
      ...productionEnv,
      ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_APPROVAL_REFERENCE: ""
    })).toThrow("APPROVED=true requires");
    expect(() => validateEnvironment({
      ...productionEnv,
      ACCOUNT_DATA_RETENTION_LEGAL_HOLD_REASON_CODES_JSON: "[]"
    })).toThrow("non-empty reason catalog");
    expect(() => validateEnvironment({
      ...productionEnv,
      ACCOUNT_DATA_RETENTION_LEGAL_HOLD_REASON_CODES_JSON: "not-json"
    })).toThrow("must be valid JSON");
  });

  it("keeps crisis-resource commercial release fail closed until approval is recorded", () => {
    expect(() => validateEnvironment({
      ...productionEnv,
      CRISIS_RESOURCES_APPROVED: "false",
      CRISIS_RESOURCES_APPROVAL_REFERENCE: ""
    })).toThrow("approved crisis resources");
    expect(() => validateEnvironment({
      ...productionEnv,
      CRISIS_RESOURCES_APPROVAL_REFERENCE: ""
    })).toThrow("APPROVED=true requires CRISIS_RESOURCES_APPROVAL_REFERENCE");
    expect(() => validateEnvironment({
      ...productionEnv,
      CRISIS_RESOURCES_APPROVAL_REFERENCE: "raw secret with spaces"
    })).toThrow("6-160 character non-secret reference");
  });

  it("keeps WeChat T+1 daily bill reconciliation fail closed and bounded", () => {
    expect(() => validateEnvironment({
      ...productionEnv,
      WECHAT_DAILY_BILL_RECONCILIATION_ENABLED: "false"
    })).toThrow("enabled and approved WeChat T+1 daily bill reconciliation");
    expect(() => validateEnvironment({
      ...productionEnv,
      WECHAT_DAILY_BILL_RECONCILIATION_APPROVED: "false",
      WECHAT_DAILY_BILL_RECONCILIATION_APPROVAL_REFERENCE: ""
    })).toThrow("enabled and approved WeChat T+1 daily bill reconciliation");
    expect(() => validateEnvironment({
      ...productionEnv,
      WECHAT_DAILY_BILL_RECONCILIATION_APPROVAL_REFERENCE: ""
    })).toThrow("APPROVED=true requires WECHAT_DAILY_BILL_RECONCILIATION_APPROVAL_REFERENCE");
    expect(() => validateEnvironment({
      ...productionEnv,
      WECHAT_DAILY_BILL_RECONCILIATION_APPROVAL_REFERENCE: "raw secret with spaces"
    })).toThrow("6-160 character non-secret reference");
    expect(() => validateEnvironment({
      ...productionEnv,
      WECHAT_DAILY_BILL_RECONCILIATION_START_DATE: ""
    })).toThrow("WECHAT_DAILY_BILL_RECONCILIATION_START_DATE");
    expect(() => validateEnvironment({
      ...productionEnv,
      WECHAT_DAILY_BILL_RECONCILIATION_START_DATE: "2026-02-31"
    })).toThrow("valid calendar date");
    expect(() => validateEnvironment({ WECHAT_DAILY_BILL_RECONCILIATION_HOUR: "9" }))
      .toThrow("WECHAT_DAILY_BILL_RECONCILIATION_HOUR");
    expect(() => validateEnvironment({ WECHAT_DAILY_BILL_RECONCILIATION_HOUR: "24" }))
      .toThrow("WECHAT_DAILY_BILL_RECONCILIATION_HOUR");
    expect(() => validateEnvironment({ WECHAT_DAILY_BILL_RECONCILIATION_BATCH_SIZE: "0" }))
      .toThrow("WECHAT_DAILY_BILL_RECONCILIATION_BATCH_SIZE");
    expect(() => validateEnvironment({ WECHAT_DAILY_BILL_RECONCILIATION_BATCH_SIZE: "17" }))
      .toThrow("WECHAT_DAILY_BILL_RECONCILIATION_BATCH_SIZE");
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

  it("requires a controlled and approved refund policy in commercial mode", () => {
    const configured = validateEnvironment({
      REFUND_POLICY_VERSION: "2026.08-v2",
      REFUND_POLICY_APPROVED: "true",
      REFUND_POLICY_APPROVAL_REFERENCE: "legal:refund-policy-2026-08"
    });
    expect(configured.REFUND_POLICY_VERSION).toBe("2026.08-v2");
    expect(configured.REFUND_POLICY_APPROVED).toBe(true);

    expect(() => validateEnvironment({
      COMMERCIAL_RELEASE_MODE: "commercial",
      REFUND_POLICY_VERSION: "2026.08-v2",
      REFUND_POLICY_APPROVED: "false"
    })).toThrow("requires an approved refund policy version");
    expect(() => validateEnvironment({
      REFUND_POLICY_APPROVED: "true",
      REFUND_POLICY_APPROVAL_REFERENCE: ""
    })).toThrow("REFUND_POLICY_APPROVAL_REFERENCE");
    expect(() => validateEnvironment({ REFUND_POLICY_VERSION: "current policy" }))
      .toThrow("controlled 3-64 character version identifier");
    expect(() => validateEnvironment({ REFUND_REQUEST_WINDOW_HOURS: "0" }))
      .toThrow("between 1 and 720");
    expect(() => validateEnvironment({ REFUND_REQUEST_WINDOW_HOURS: "721" }))
      .toThrow("between 1 and 720");
  });

  it("requires an explicit commercial mode in production", () => {
    expect(() => validateEnvironment({
      ...productionEnv,
      COMMERCIAL_RELEASE_MODE: "internal"
    })).toThrow("COMMERCIAL_RELEASE_MODE=commercial");
  });

  it("validates the optional controlled voice-evidence viewer as one secure configuration", () => {
    const configured = validateEnvironment({
      COMPANION_VOICE_EVIDENCE_VIEWER_URL: "https://evidence.example.com/listen",
      COMPANION_VOICE_EVIDENCE_SIGNING_SECRET: "development-viewer-secret",
      COMPANION_VOICE_EVIDENCE_URL_TTL_SECONDS: "60"
    });

    expect(configured.COMPANION_VOICE_EVIDENCE_VIEWER_URL).toBe("https://evidence.example.com/listen");
    expect(configured.COMPANION_VOICE_EVIDENCE_SIGNING_SECRET).toBe("development-viewer-secret");
    expect(configured.COMPANION_VOICE_EVIDENCE_URL_TTL_SECONDS).toBe(60);
    expect(() => validateEnvironment({
      COMPANION_VOICE_EVIDENCE_VIEWER_URL: "http://evidence.example.com/listen",
      COMPANION_VOICE_EVIDENCE_SIGNING_SECRET: "development-viewer-secret"
    })).toThrow("absolute HTTPS");
    expect(() => validateEnvironment({
      COMPANION_VOICE_EVIDENCE_VIEWER_URL: "https://evidence.example.com/listen"
    })).toThrow("configured together");
    expect(() => validateEnvironment({
      COMPANION_VOICE_EVIDENCE_URL_TTL_SECONDS: "59"
    })).toThrow("between 60 and 900");
    expect(() => validateEnvironment({
      COMPANION_VOICE_EVIDENCE_URL_TTL_SECONDS: "901"
    })).toThrow("between 60 and 900");
    expect(() => validateEnvironment({
      ...productionEnv,
      COMPANION_VOICE_EVIDENCE_VIEWER_URL: "https://evidence.example.com/listen",
      COMPANION_VOICE_EVIDENCE_SIGNING_SECRET: "too-short"
    })).toThrow("at least 32");
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
    expect(() => validateEnvironment({ ...productionEnv, ORDER_CHAT_POST_SERVICE_WINDOW_MINUTES: "" }))
      .toThrow("ORDER_CHAT_POST_SERVICE_WINDOW_MINUTES");
    expect(() => validateEnvironment({ ORDER_CHAT_PRE_SERVICE_WINDOW_MINUTES: "1441" }))
      .toThrow("ORDER_CHAT_PRE_SERVICE_WINDOW_MINUTES");
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
