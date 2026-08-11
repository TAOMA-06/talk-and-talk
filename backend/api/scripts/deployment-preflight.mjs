#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import transactionalTemplateManifest from "../config/transactional-template-manifest.js";

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
const LEGAL_REQUIRED_FIELDS = [
  "LEGAL_CONSENT_VERSION",
  "LEGAL_CONSENT_EFFECTIVE_DATE",
  "LEGAL_OPERATOR_NAME",
  "LEGAL_CONTACT_EMAIL",
  "LEGAL_CONTACT_PHONE",
  "LEGAL_COMPLAINT_CHANNEL",
  "LEGAL_PRIVACY_URL",
  "LEGAL_TERMS_URL",
  "LEGAL_PLATFORM_RULES_URL",
  "LEGAL_PRIVACY_RETENTION_DAYS",
  "ACCOUNT_DELETION_RETENTION_POLICY_APPROVED",
  "ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE",
  "ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_APPROVED",
  "ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_VERSION",
  "ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_APPROVAL_REFERENCE",
  "ACCOUNT_DATA_RETENTION_LEGAL_HOLD_REASON_CODES_JSON"
];
const LEGAL_HOLD_ACTIONS = new Set(["placement", "release"]);
const LEGAL_HOLD_RETENTION_CATEGORIES = new Set([
  "identity_authentication_profile",
  "preferences_behavior_notifications",
  "public_user_content",
  "transactions_tax_invoices",
  "support_disputes_safety",
  "consent_rights_account_governance",
  "deletion_audit_evidence"
]);
const CRISIS_RELEASE_REQUIRED_FIELDS = [
  "CRISIS_RESOURCES_APPROVED",
  "CRISIS_RESOURCES_APPROVAL_REFERENCE"
];
export const REQUIRED_TRANSACTIONAL_TEMPLATE_KEYS = transactionalTemplateManifest.map(({ key }) => key);
const AVAILABILITY_REMINDER_TEMPLATE_KEY = "availabilityReminder";
const JWT_TTL_MULTIPLIERS = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

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

function parseJwtTtlMs(value) {
  const match = value?.match(/^([1-9]\d*)(s|m|h|d)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  const ttlMs = amount * JWT_TTL_MULTIPLIERS[match[2]];
  return Number.isSafeInteger(amount) && Number.isSafeInteger(ttlMs) ? ttlMs : null;
}

export function validateDeploymentConfig(env) {
  const errors = [];
  const production = env.APP_ENV === "production";
  const availabilityReminderDeliveryEnabled = env.AVAILABILITY_REMINDER_DELIVERY_ENABLED === "true";
  const trtcEnabled = env.TRTC_ENABLED === "true";
  const trtcRoomControlEnabled = env.TRTC_ROOM_CONTROL_ENABLED === "true";
  const trtcEmergencyStopEnabled = env.TRTC_EMERGENCY_STOP_ENABLED === "true";
  const required = [
    "NODE_ENV", "APP_ENV", "API_PREFIX", "DATABASE_URL", "REDIS_URL", "CORS_ORIGINS",
    "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "JWT_ACCESS_TTL", "JWT_REFRESH_TTL",
    "AUTH_IDENTITY_TOMBSTONE_HMAC_KEYS", "AUTH_IDENTITY_TOMBSTONE_ACTIVE_KEY_ID",
    "AUTH_IDENTITY_REREGISTRATION_POLICY",
    "REVIEW_JWT_ACCESS_SECRET", "REVIEW_JWT_REFRESH_SECRET", "WECHAT_MINIPROGRAM_APP_ID",
    "WECHAT_MINIPROGRAM_APP_SECRET"
  ];
  if (production) {
    required.push(
      ...PAY_REQUIRED_FIELDS,
      ...LEGAL_REQUIRED_FIELDS,
      ...CRISIS_RELEASE_REQUIRED_FIELDS,
      "METRICS_TOKEN",
      "STAFF_TOTP_ENCRYPTION_KEY",
      "REVIEW_TOTP_ENCRYPTION_KEY",
      "EXTERNAL_AI_USER_CONTENT_ENABLED",
      "COMMERCIAL_RELEASE_MODE",
      "COMPANION_VOICE_EVIDENCE_VIEWER_URL",
      "COMPANION_VOICE_EVIDENCE_SIGNING_SECRET",
      "COMPANION_VOICE_EVIDENCE_URL_TTL_SECONDS",
      "PLATFORM_FEE_BPS",
      "COMPANION_SETTLEMENT_HOLD_HOURS",
      "REFUND_POLICY_VERSION",
      "REFUND_POLICY_APPROVED",
      "REFUND_POLICY_APPROVAL_REFERENCE",
      "REFUND_REQUEST_WINDOW_HOURS",
      "ORDER_RESPONSE_WINDOW_MINUTES",
      "ORDER_MAX_SCHEDULE_DAYS",
      "ORDER_INTAKE_ENABLED",
      "ORDER_MAX_OPEN_TOTAL",
      "ORDER_MAX_OPEN_PER_USER",
      "ORDER_MAX_PENDING_PER_COMPANION",
      "PAYOUT_CLAIMS_ENABLED",
      "SUPPORT_RESPONSE_HOURS",
      "SUPPORT_MAX_OPEN_PER_USER",
      "NOTIFICATION_DELIVERY_ENABLED",
      "WECHAT_SUBSCRIBE_MESSAGES_ENABLED",
      "WECHAT_SUBSCRIBE_TEMPLATES_JSON",
      "PAYMENT_RECONCILIATION_ENABLED",
      "WECHAT_DAILY_BILL_RECONCILIATION_ENABLED",
      "WECHAT_DAILY_BILL_RECONCILIATION_APPROVED",
      "WECHAT_DAILY_BILL_RECONCILIATION_APPROVAL_REFERENCE",
      "WECHAT_DAILY_BILL_RECONCILIATION_START_DATE",
      "WECHAT_DAILY_BILL_RECONCILIATION_HOUR",
      "WECHAT_DAILY_BILL_RECONCILIATION_BATCH_SIZE",
      "WECHAT_PAY_COMPLAINTS_ENABLED",
      "WECHAT_PAY_COMPLAINT_POLL_INTERVAL_SECONDS",
      "WECHAT_PAY_COMPLAINT_BATCH_SIZE",
      "TRTC_ENABLED"
    );
  }

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
  if (env.EXTERNAL_AI_USER_CONTENT_ENABLED && env.EXTERNAL_AI_USER_CONTENT_ENABLED !== "false") {
    errors.push("EXTERNAL_AI_USER_CONTENT_ENABLED must remain false; user-authored content is local-only");
  }
  if (env.DEEPSEEK_API_KEY?.trim()) {
    errors.push("DEEPSEEK_API_KEY must be unset because the generic DeepSeek service is not approved for user-authored content");
  }
  const voiceEvidenceViewerUrl = env.COMPANION_VOICE_EVIDENCE_VIEWER_URL?.trim() ?? "";
  const voiceEvidenceSigningSecret = env.COMPANION_VOICE_EVIDENCE_SIGNING_SECRET?.trim() ?? "";
  if (Boolean(voiceEvidenceViewerUrl) !== Boolean(voiceEvidenceSigningSecret)) {
    errors.push(
      "COMPANION_VOICE_EVIDENCE_VIEWER_URL and COMPANION_VOICE_EVIDENCE_SIGNING_SECRET must be configured together"
    );
  }
  if (voiceEvidenceViewerUrl) {
    try {
      const viewer = new URL(voiceEvidenceViewerUrl);
      if (
        viewer.protocol !== "https:"
        || viewer.username
        || viewer.password
        || viewer.search
        || viewer.hash
      ) {
        errors.push(
          "COMPANION_VOICE_EVIDENCE_VIEWER_URL must be an HTTPS base URL without credentials, query or fragment"
        );
      }
    } catch {
      errors.push("COMPANION_VOICE_EVIDENCE_VIEWER_URL must be an absolute HTTPS URL");
    }
  }
  if (voiceEvidenceSigningSecret && voiceEvidenceSigningSecret.length < 32) {
    errors.push("COMPANION_VOICE_EVIDENCE_SIGNING_SECRET must be at least 32 characters");
  }
  if (
    env.COMPANION_VOICE_EVIDENCE_URL_TTL_SECONDS
    && (
      !/^\d+$/.test(env.COMPANION_VOICE_EVIDENCE_URL_TTL_SECONDS)
      || Number(env.COMPANION_VOICE_EVIDENCE_URL_TTL_SECONDS) < 60
      || Number(env.COMPANION_VOICE_EVIDENCE_URL_TTL_SECONDS) > 900
    )
  ) {
    errors.push("COMPANION_VOICE_EVIDENCE_URL_TTL_SECONDS must be an integer between 60 and 900");
  }

  for (const key of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "REVIEW_JWT_ACCESS_SECRET", "REVIEW_JWT_REFRESH_SECRET"]) {
    if (env[key] && env[key].length < 32) errors.push(`${key} must be at least 32 characters`);
  }
  for (const key of ["METRICS_TOKEN", "STAFF_TOTP_ENCRYPTION_KEY", "REVIEW_TOTP_ENCRYPTION_KEY"]) {
    if (production && env[key] && env[key].length < 32) errors.push(`${key} must be at least 32 characters`);
  }
  if (env.JWT_ACCESS_SECRET && env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    errors.push("JWT access and refresh secrets must be different");
  }
  const jwtAccessTtlMs = parseJwtTtlMs(env.JWT_ACCESS_TTL);
  const jwtRefreshTtlMs = parseJwtTtlMs(env.JWT_REFRESH_TTL);
  if (env.JWT_ACCESS_TTL && jwtAccessTtlMs === null) {
    errors.push("JWT_ACCESS_TTL must use a positive integer followed by s, m, h, or d (for example 15m)");
  } else if (jwtAccessTtlMs !== null && (jwtAccessTtlMs < 5 * 60_000 || jwtAccessTtlMs > 60 * 60_000)) {
    errors.push("JWT_ACCESS_TTL must be between 5 minutes and 1 hour");
  }
  if (env.JWT_REFRESH_TTL && jwtRefreshTtlMs === null) {
    errors.push("JWT_REFRESH_TTL must use a positive integer followed by s, m, h, or d (for example 30d)");
  } else if (jwtRefreshTtlMs !== null && (jwtRefreshTtlMs < 60 * 60_000 || jwtRefreshTtlMs > 90 * 24 * 60 * 60_000)) {
    errors.push("JWT_REFRESH_TTL must be between 1 hour and 90 days");
  }
  if (jwtAccessTtlMs !== null && jwtRefreshTtlMs !== null && jwtRefreshTtlMs <= jwtAccessTtlMs) {
    errors.push("JWT_REFRESH_TTL must be greater than JWT_ACCESS_TTL");
  }
  if (env.REVIEW_JWT_ACCESS_SECRET && env.REVIEW_JWT_ACCESS_SECRET === env.REVIEW_JWT_REFRESH_SECRET) {
    errors.push("review JWT access and refresh secrets must be different");
  }
  if (production && (
    (env.REVIEW_JWT_ACCESS_SECRET && env.JWT_ACCESS_SECRET && env.REVIEW_JWT_ACCESS_SECRET === env.JWT_ACCESS_SECRET) ||
    (env.REVIEW_JWT_REFRESH_SECRET && env.JWT_REFRESH_SECRET && env.REVIEW_JWT_REFRESH_SECRET === env.JWT_REFRESH_SECRET)
  )) {
    errors.push("review JWT secrets must not reuse consumer JWT secrets");
  }
  if (production && env.REVIEW_TOTP_ENCRYPTION_KEY && env.STAFF_TOTP_ENCRYPTION_KEY && env.REVIEW_TOTP_ENCRYPTION_KEY === env.STAFF_TOTP_ENCRYPTION_KEY) {
    errors.push("review TOTP encryption key must not reuse staff TOTP encryption key");
  }

  for (const origin of (env.CORS_ORIGINS ?? "").split(",").map((item) => item.trim()).filter(Boolean)) {
    if (!validUrl(origin, ["https:"])) errors.push("every deployed CORS_ORIGINS entry must use HTTPS");
  }

  if (env.WECHAT_MINIPROGRAM_APP_ID && !/^wx[0-9a-zA-Z]{10,}$/.test(env.WECHAT_MINIPROGRAM_APP_ID)) {
    errors.push("WECHAT_MINIPROGRAM_APP_ID must look like a WeChat AppID");
  }
  if (production && env.WECHAT_PAY_APP_ID && !/^wx[0-9a-zA-Z]{10,}$/.test(env.WECHAT_PAY_APP_ID)) {
    errors.push("WECHAT_PAY_APP_ID must look like a WeChat AppID");
  }
  if (env.WECHAT_MINIPROGRAM_APP_SECRET && env.WECHAT_MINIPROGRAM_APP_SECRET.length < 16) {
    errors.push("WECHAT_MINIPROGRAM_APP_SECRET is unexpectedly short");
  }
  if (production && env.WECHAT_PAY_MCH_ID && !/^\d{6,32}$/.test(env.WECHAT_PAY_MCH_ID)) {
    errors.push("WECHAT_PAY_MCH_ID must contain 6-32 digits");
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

  for (const key of ["LEGAL_PRIVACY_URL", "LEGAL_TERMS_URL", "LEGAL_PLATFORM_RULES_URL"]) {
    if (env[key] && !validUrl(env[key], ["https:"])) errors.push(`${key} must use HTTPS`);
  }
  if (env.LEGAL_CONTACT_EMAIL && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.LEGAL_CONTACT_EMAIL)) {
    errors.push("LEGAL_CONTACT_EMAIL must be a valid email address");
  }
  if (env.LEGAL_CONSENT_EFFECTIVE_DATE && (!/^\d{4}-\d{2}-\d{2}$/.test(env.LEGAL_CONSENT_EFFECTIVE_DATE) || Number.isNaN(Date.parse(`${env.LEGAL_CONSENT_EFFECTIVE_DATE}T00:00:00Z`)))) {
    errors.push("LEGAL_CONSENT_EFFECTIVE_DATE must use YYYY-MM-DD");
  }
  const retentionPolicyApproved = env.ACCOUNT_DELETION_RETENTION_POLICY_APPROVED;
  const retentionPolicyApprovalReference = env.ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE?.trim() ?? "";
  if (retentionPolicyApproved && !["true", "false"].includes(retentionPolicyApproved)) {
    errors.push("ACCOUNT_DELETION_RETENTION_POLICY_APPROVED must be true or false");
  }
  if (
    retentionPolicyApprovalReference
    && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,159}$/.test(retentionPolicyApprovalReference)
  ) {
    errors.push(
      "ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE must be a 6-160 character non-secret reference"
    );
  }
  if (retentionPolicyApproved === "true" && !retentionPolicyApprovalReference) {
    errors.push(
      "ACCOUNT_DELETION_RETENTION_POLICY_APPROVED=true requires ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE"
    );
  }
  if (production && retentionPolicyApproved !== "true") {
    errors.push("ACCOUNT_DELETION_RETENTION_POLICY_APPROVED must be true in production after external legal approval");
  }
  const legalHoldPolicyApproved = env.ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_APPROVED;
  const legalHoldPolicyVersion = env.ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_VERSION?.trim() ?? "";
  const legalHoldPolicyApprovalReference =
    env.ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_APPROVAL_REFERENCE?.trim() ?? "";
  if (legalHoldPolicyApproved && !["true", "false"].includes(legalHoldPolicyApproved)) {
    errors.push("ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_APPROVED must be true or false");
  }
  if (
    legalHoldPolicyVersion
    && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,63}$/.test(legalHoldPolicyVersion)
  ) {
    errors.push(
      "ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_VERSION must be a controlled 3-64 character version identifier"
    );
  }
  if (
    legalHoldPolicyApprovalReference
    && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,159}$/.test(legalHoldPolicyApprovalReference)
  ) {
    errors.push(
      "ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_APPROVAL_REFERENCE must be a 6-160 character non-secret reference"
    );
  }
  let legalHoldReasonCatalog = null;
  try {
    legalHoldReasonCatalog = JSON.parse(
      env.ACCOUNT_DATA_RETENTION_LEGAL_HOLD_REASON_CODES_JSON || ""
    );
  } catch {
    errors.push("ACCOUNT_DATA_RETENTION_LEGAL_HOLD_REASON_CODES_JSON must be valid JSON");
  }
  let legalHoldReasonCatalogValid = Array.isArray(legalHoldReasonCatalog);
  if (legalHoldReasonCatalogValid) {
    const seenCodes = new Set();
    for (const item of legalHoldReasonCatalog) {
      const actions = item?.actions;
      const categories = item?.categories;
      const valid = item && typeof item === "object"
        && typeof item.code === "string"
        && /^[A-Z][A-Z0-9_]{2,63}$/.test(item.code)
        && !seenCodes.has(item.code)
        && Array.isArray(actions)
        && actions.length > 0
        && actions.every((action) => LEGAL_HOLD_ACTIONS.has(action))
        && new Set(actions).size === actions.length
        && Array.isArray(categories)
        && categories.length > 0
        && categories.every((category) => LEGAL_HOLD_RETENTION_CATEGORIES.has(category))
        && new Set(categories).size === categories.length;
      if (!valid) {
        legalHoldReasonCatalogValid = false;
        break;
      }
      seenCodes.add(item.code);
    }
  }
  if (legalHoldReasonCatalog !== null && !legalHoldReasonCatalogValid) {
    errors.push(
      "ACCOUNT_DATA_RETENTION_LEGAL_HOLD_REASON_CODES_JSON must contain unique controlled reasons, actions and retention categories"
    );
  }
  if (
    legalHoldPolicyApproved === "true"
    && (
      !legalHoldPolicyVersion
      || !legalHoldPolicyApprovalReference
      || !legalHoldReasonCatalogValid
      || legalHoldReasonCatalog.length === 0
    )
  ) {
    errors.push(
      "ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_APPROVED=true requires a controlled version, approval reference and non-empty reason catalog"
    );
  }
  if (production && legalHoldPolicyApproved !== "true") {
    errors.push(
      "ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_APPROVED must be true in production after external legal approval"
    );
  }
  let tombstoneKeys = {};
  try {
    const parsed = JSON.parse(env.AUTH_IDENTITY_TOMBSTONE_HMAC_KEYS || "");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) tombstoneKeys = parsed;
  } catch {
    tombstoneKeys = {};
  }
  if (!Object.keys(tombstoneKeys).length) {
    errors.push("AUTH_IDENTITY_TOMBSTONE_HMAC_KEYS must be a non-empty JSON keyring");
  }
  for (const [keyId, encoded] of Object.entries(tombstoneKeys)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(keyId) || typeof encoded !== "string") {
      errors.push("AUTH_IDENTITY_TOMBSTONE_HMAC_KEYS contains an invalid key id or value");
      continue;
    }
    const key = Buffer.from(encoded, "base64");
    if (key.length < 32
      || key.toString("base64").replace(/=+$/u, "") !== encoded.replace(/=+$/u, "")) {
      errors.push("Each auth identity tombstone HMAC key must be valid base64 for at least 32 bytes");
    }
    if (production && (PLACEHOLDER.test(encoded) || PLACEHOLDER.test(key.toString("utf8")))) {
      errors.push(`AUTH_IDENTITY_TOMBSTONE_HMAC_KEYS key ${keyId} still contains a placeholder`);
    }
  }
  if (!Object.prototype.hasOwnProperty.call(
    tombstoneKeys,
    env.AUTH_IDENTITY_TOMBSTONE_ACTIVE_KEY_ID || ""
  )) {
    errors.push("AUTH_IDENTITY_TOMBSTONE_ACTIVE_KEY_ID must exist in the configured keyring");
  }
  if (env.AUTH_IDENTITY_REREGISTRATION_POLICY !== "after_tombstone_expiry") {
    errors.push("AUTH_IDENTITY_REREGISTRATION_POLICY must be after_tombstone_expiry");
  }
  const crisisResourcesApproved = env.CRISIS_RESOURCES_APPROVED;
  const crisisResourcesApprovalReference = env.CRISIS_RESOURCES_APPROVAL_REFERENCE?.trim() ?? "";
  if (crisisResourcesApproved && !["true", "false"].includes(crisisResourcesApproved)) {
    errors.push("CRISIS_RESOURCES_APPROVED must be true or false");
  }
  if (
    crisisResourcesApprovalReference
    && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,159}$/.test(crisisResourcesApprovalReference)
  ) {
    errors.push("CRISIS_RESOURCES_APPROVAL_REFERENCE must be a 6-160 character non-secret reference");
  }
  if (crisisResourcesApproved === "true" && !crisisResourcesApprovalReference) {
    errors.push("CRISIS_RESOURCES_APPROVED=true requires CRISIS_RESOURCES_APPROVAL_REFERENCE");
  }
  if (production && crisisResourcesApproved !== "true") {
    errors.push("CRISIS_RESOURCES_APPROVED must be true in production after safety and operations approval");
  }
  const refundPolicyVersion = env.REFUND_POLICY_VERSION?.trim() ?? "";
  const refundPolicyApproved = env.REFUND_POLICY_APPROVED;
  const refundPolicyApprovalReference = env.REFUND_POLICY_APPROVAL_REFERENCE?.trim() ?? "";
  if (refundPolicyVersion && !/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(refundPolicyVersion)) {
    errors.push("REFUND_POLICY_VERSION must be a controlled 3-64 character version identifier");
  }
  if (refundPolicyApproved && !["true", "false"].includes(refundPolicyApproved)) {
    errors.push("REFUND_POLICY_APPROVED must be true or false");
  }
  if (
    refundPolicyApprovalReference
    && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,159}$/.test(refundPolicyApprovalReference)
  ) {
    errors.push("REFUND_POLICY_APPROVAL_REFERENCE must be a 6-160 character non-secret reference");
  }
  if (refundPolicyApproved === "true" && !refundPolicyApprovalReference) {
    errors.push("REFUND_POLICY_APPROVED=true requires REFUND_POLICY_APPROVAL_REFERENCE");
  }
  if (env.COMMERCIAL_RELEASE_MODE === "commercial" && refundPolicyApproved !== "true") {
    errors.push("COMMERCIAL_RELEASE_MODE=commercial requires REFUND_POLICY_APPROVED=true");
  }
  const commercialSurface = (env.COMMERCIAL_SURFACE || "text_only").trim().toLowerCase();
  if (!["text_only", "text-only", "full"].includes(commercialSurface)) {
    errors.push("COMMERCIAL_SURFACE must be text_only or full");
  }
  const firstReleaseCandidate = env.APP_ENV === "staging" || env.APP_ENV === "production";
  if (firstReleaseCandidate && env.COMMERCIAL_SURFACE !== "text_only") {
    errors.push("First-release staging/production requires COMMERCIAL_SURFACE=text_only");
  }
  const personalizationFlag = (env.RECOMMENDATION_PERSONALIZATION_ENABLED || "").trim().toLowerCase();
  if (firstReleaseCandidate && !["", "false"].includes(personalizationFlag)) {
    errors.push("First-release staging/production requires RECOMMENDATION_PERSONALIZATION_ENABLED to be unset or false pending PERSONALIZATION-R01");
  }
  if ((commercialSurface === "text_only" || commercialSurface === "text-only") && env.TRTC_ENABLED === "true") {
    errors.push("COMMERCIAL_SURFACE=text_only forbids TRTC_ENABLED=true");
  }
  if ((commercialSurface === "text_only" || commercialSurface === "text-only") && env.MEDIA_FEATURE_ENABLED === "true") {
    errors.push("COMMERCIAL_SURFACE=text_only forbids MEDIA_FEATURE_ENABLED=true");
  }
  for (const key of ["LEGAL_PRIVACY_RETENTION_DAYS", "PLATFORM_FEE_BPS", "COMPANION_SETTLEMENT_HOLD_HOURS", "REFUND_REQUEST_WINDOW_HOURS", "ORDER_RESPONSE_WINDOW_MINUTES", "ORDER_MAX_SCHEDULE_DAYS", "ORDER_MAX_OPEN_TOTAL", "ORDER_MAX_OPEN_PER_USER", "ORDER_MAX_PENDING_PER_COMPANION", "SUPPORT_RESPONSE_HOURS", "SUPPORT_MAX_OPEN_PER_USER"]) {
    if (env[key] && !/^\d+$/.test(env[key])) errors.push(`${key} must be an integer`);
  }
  for (const key of ["ORDER_MAX_OPEN_TOTAL", "ORDER_MAX_OPEN_PER_USER", "ORDER_MAX_PENDING_PER_COMPANION", "SUPPORT_MAX_OPEN_PER_USER"]) {
    if (env[key] && /^\d+$/.test(env[key]) && Number(env[key]) < 1) errors.push(`${key} must be at least 1`);
  }
  if (
    env.ORDER_MAX_SCHEDULE_DAYS && /^\d+$/.test(env.ORDER_MAX_SCHEDULE_DAYS) &&
    (Number(env.ORDER_MAX_SCHEDULE_DAYS) < 1 || Number(env.ORDER_MAX_SCHEDULE_DAYS) > 365)
  ) {
    errors.push("ORDER_MAX_SCHEDULE_DAYS must be between 1 and 365");
  }
  if (env.PLATFORM_FEE_BPS && (Number(env.PLATFORM_FEE_BPS) < 0 || Number(env.PLATFORM_FEE_BPS) > 10000)) {
    errors.push("PLATFORM_FEE_BPS must be between 0 and 10000");
  }
  if (
    env.REFUND_REQUEST_WINDOW_HOURS
    && /^\d+$/.test(env.REFUND_REQUEST_WINDOW_HOURS)
    && (Number(env.REFUND_REQUEST_WINDOW_HOURS) < 1 || Number(env.REFUND_REQUEST_WINDOW_HOURS) > 720)
  ) {
    errors.push("REFUND_REQUEST_WINDOW_HOURS must be between 1 and 720");
  }
  if (
    env.COMMERCIAL_RELEASE_MODE === "commercial" &&
    Number(env.COMPANION_SETTLEMENT_HOLD_HOURS) < Number(env.REFUND_REQUEST_WINDOW_HOURS) + 24
  ) {
    errors.push("COMPANION_SETTLEMENT_HOLD_HOURS must be at least REFUND_REQUEST_WINDOW_HOURS + 24");
  }
  if (production && env.COMMERCIAL_RELEASE_MODE !== "commercial") {
    errors.push("COMMERCIAL_RELEASE_MODE must be commercial in production");
  }
  for (const key of ["ORDER_INTAKE_ENABLED", "PAYOUT_CLAIMS_ENABLED"]) {
    if (production && !["true", "false"].includes(env[key])) errors.push(`${key} must be true or false in production`);
  }
  if (production && env.NOTIFICATION_DELIVERY_ENABLED !== "true") {
    errors.push("NOTIFICATION_DELIVERY_ENABLED must be true in production");
  }
  if (production && env.WECHAT_SUBSCRIBE_MESSAGES_ENABLED !== "true") {
    errors.push("WECHAT_SUBSCRIBE_MESSAGES_ENABLED must be true in production");
  }
  if (production && env.PAYMENT_RECONCILIATION_ENABLED !== "true") {
    errors.push("PAYMENT_RECONCILIATION_ENABLED must be true in production");
  }
  const dailyBillEnabled = env.WECHAT_DAILY_BILL_RECONCILIATION_ENABLED;
  const dailyBillApproved = env.WECHAT_DAILY_BILL_RECONCILIATION_APPROVED;
  const dailyBillApprovalReference = env.WECHAT_DAILY_BILL_RECONCILIATION_APPROVAL_REFERENCE?.trim() ?? "";
  const dailyBillStartDate = env.WECHAT_DAILY_BILL_RECONCILIATION_START_DATE?.trim() ?? "";
  for (const [name, value] of [
    ["WECHAT_DAILY_BILL_RECONCILIATION_ENABLED", dailyBillEnabled],
    ["WECHAT_DAILY_BILL_RECONCILIATION_APPROVED", dailyBillApproved]
  ]) {
    if (value && !["true", "false"].includes(value)) errors.push(`${name} must be true or false`);
  }
  if (
    dailyBillApprovalReference
    && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,159}$/.test(dailyBillApprovalReference)
  ) {
    errors.push(
      "WECHAT_DAILY_BILL_RECONCILIATION_APPROVAL_REFERENCE must be a 6-160 character non-secret reference"
    );
  }
  if (dailyBillApproved === "true" && !dailyBillApprovalReference) {
    errors.push(
      "WECHAT_DAILY_BILL_RECONCILIATION_APPROVED=true requires WECHAT_DAILY_BILL_RECONCILIATION_APPROVAL_REFERENCE"
    );
  }
  if (dailyBillStartDate) {
    const parsed = new Date(`${dailyBillStartDate}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dailyBillStartDate)
      || Number.isNaN(parsed.getTime())
      || parsed.toISOString().slice(0, 10) !== dailyBillStartDate) {
      errors.push("WECHAT_DAILY_BILL_RECONCILIATION_START_DATE must be a valid YYYY-MM-DD date");
    }
  }
  if (dailyBillEnabled === "true" && !dailyBillStartDate) {
    errors.push(
      "WECHAT_DAILY_BILL_RECONCILIATION_ENABLED=true requires WECHAT_DAILY_BILL_RECONCILIATION_START_DATE"
    );
  }
  if (production && dailyBillEnabled !== "true") {
    errors.push("WECHAT_DAILY_BILL_RECONCILIATION_ENABLED must be true in production");
  }
  if (production && dailyBillApproved !== "true") {
    errors.push("WECHAT_DAILY_BILL_RECONCILIATION_APPROVED must be true in production after finance approval");
  }
  if (env.WECHAT_DAILY_BILL_RECONCILIATION_HOUR && (
    !/^\d+$/.test(env.WECHAT_DAILY_BILL_RECONCILIATION_HOUR)
    || Number(env.WECHAT_DAILY_BILL_RECONCILIATION_HOUR) < 10
    || Number(env.WECHAT_DAILY_BILL_RECONCILIATION_HOUR) > 23
  )) {
    errors.push("WECHAT_DAILY_BILL_RECONCILIATION_HOUR must be between 10 and 23");
  }
  if (env.WECHAT_DAILY_BILL_RECONCILIATION_BATCH_SIZE && (
    !/^\d+$/.test(env.WECHAT_DAILY_BILL_RECONCILIATION_BATCH_SIZE)
    || Number(env.WECHAT_DAILY_BILL_RECONCILIATION_BATCH_SIZE) < 1
    || Number(env.WECHAT_DAILY_BILL_RECONCILIATION_BATCH_SIZE) > 16
  )) {
    errors.push("WECHAT_DAILY_BILL_RECONCILIATION_BATCH_SIZE must be between 1 and 16");
  }
  if (production && env.WECHAT_PAY_COMPLAINTS_ENABLED !== "true") {
    errors.push("WECHAT_PAY_COMPLAINTS_ENABLED must be true in production");
  }
  if (env.WECHAT_PAY_COMPLAINT_POLL_INTERVAL_SECONDS && (
    !/^\d+$/.test(env.WECHAT_PAY_COMPLAINT_POLL_INTERVAL_SECONDS)
    || Number(env.WECHAT_PAY_COMPLAINT_POLL_INTERVAL_SECONDS) < 60
    || Number(env.WECHAT_PAY_COMPLAINT_POLL_INTERVAL_SECONDS) > 3600
  )) {
    errors.push("WECHAT_PAY_COMPLAINT_POLL_INTERVAL_SECONDS must be between 60 and 3600");
  }
  if (env.WECHAT_PAY_COMPLAINT_BATCH_SIZE && (
    !/^\d+$/.test(env.WECHAT_PAY_COMPLAINT_BATCH_SIZE)
    || Number(env.WECHAT_PAY_COMPLAINT_BATCH_SIZE) < 1
    || Number(env.WECHAT_PAY_COMPLAINT_BATCH_SIZE) > 200
  )) {
    errors.push("WECHAT_PAY_COMPLAINT_BATCH_SIZE must be between 1 and 200");
  }
  if (env.TRTC_ENABLED && !["true", "false"].includes(env.TRTC_ENABLED)) {
    errors.push("TRTC_ENABLED must be true or false when configured");
  }
  if (trtcEnabled) {
    for (const key of [
      "TRTC_SDK_APP_ID",
      "TRTC_SDK_SECRET_KEY",
      "TRTC_CALLBACK_SIGNING_KEY",
      "TRTC_PRIVATE_MAP_KEY_ENABLED",
      "TRTC_PRIVACY_DISCLOSURE_REFERENCE",
      "TRTC_ROOM_CONTROL_ENABLED",
      "TENCENTCLOUD_SECRET_ID",
      "TENCENTCLOUD_SECRET_KEY"
    ]) {
      const value = env[key]?.trim() ?? "";
      if (!value) errors.push(`${key} is required when TRTC_ENABLED=true`);
      else if (PLACEHOLDER.test(value)) errors.push(`${key} still contains a placeholder`);
    }
    if (env.TRTC_SDK_APP_ID && (!/^\d+$/.test(env.TRTC_SDK_APP_ID) || Number(env.TRTC_SDK_APP_ID) < 1 || Number(env.TRTC_SDK_APP_ID) > 2_147_483_647)) {
      errors.push("TRTC_SDK_APP_ID must be a positive 32-bit integer");
    }
    if (env.TRTC_SDK_SECRET_KEY && env.TRTC_SDK_SECRET_KEY.length < 16) {
      errors.push("TRTC_SDK_SECRET_KEY is unexpectedly short");
    }
    if (env.TRTC_CALLBACK_SIGNING_KEY && !/^[A-Za-z0-9]{16,32}$/.test(env.TRTC_CALLBACK_SIGNING_KEY)) {
      errors.push("TRTC_CALLBACK_SIGNING_KEY must contain 16 to 32 ASCII letters or digits");
    }
    if (env.TRTC_PRIVATE_MAP_KEY_ENABLED !== "true") {
      errors.push("TRTC_PRIVATE_MAP_KEY_ENABLED must be true when TRTC_ENABLED=true");
    }
    if (env.TRTC_PRIVACY_DISCLOSURE_APPROVED !== "true") {
      errors.push("TRTC_PRIVACY_DISCLOSURE_APPROVED must be true when TRTC_ENABLED=true");
    }
    if (
      env.TRTC_PRIVACY_DISCLOSURE_REFERENCE
      && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,159}$/.test(env.TRTC_PRIVACY_DISCLOSURE_REFERENCE)
    ) {
      errors.push("TRTC_PRIVACY_DISCLOSURE_REFERENCE must be a 6-160 character non-secret reference");
    }
    if (env.TRTC_ROOM_CONTROL_ENABLED !== "true") {
      errors.push("TRTC_ROOM_CONTROL_ENABLED must be true when TRTC_ENABLED=true");
    }
  }
  if (
    env.TRTC_PRIVACY_DISCLOSURE_APPROVED
    && !["true", "false"].includes(env.TRTC_PRIVACY_DISCLOSURE_APPROVED)
  ) {
    errors.push("TRTC_PRIVACY_DISCLOSURE_APPROVED must be true or false when configured");
  }
  if (env.TRTC_ROOM_CONTROL_ENABLED && !["true", "false"].includes(env.TRTC_ROOM_CONTROL_ENABLED)) {
    errors.push("TRTC_ROOM_CONTROL_ENABLED must be true or false when configured");
  }
  if (env.TRTC_EMERGENCY_STOP_ENABLED && !["true", "false"].includes(env.TRTC_EMERGENCY_STOP_ENABLED)) {
    errors.push("TRTC_EMERGENCY_STOP_ENABLED must be true or false when configured");
  }
  if (trtcRoomControlEnabled && !trtcEnabled) {
    errors.push("TRTC_ROOM_CONTROL_ENABLED=true requires TRTC_ENABLED=true");
  }
  if (trtcEmergencyStopEnabled && (!trtcEnabled || !trtcRoomControlEnabled)) {
    errors.push("TRTC_EMERGENCY_STOP_ENABLED=true requires TRTC_ENABLED=true and TRTC_ROOM_CONTROL_ENABLED=true");
  }
  if (trtcRoomControlEnabled) {
    if (env.TRTC_CONTROL_REGION && !["ap-beijing", "ap-guangzhou"].includes(env.TRTC_CONTROL_REGION)) {
      errors.push("TRTC_CONTROL_REGION must be ap-beijing or ap-guangzhou");
    }
    for (const [key, minimum, maximum] of [
      ["TRTC_CONTROL_TIMEOUT_MS", 1000, 10000],
      ["TRTC_ROOM_CONTROL_INTERVAL_SECONDS", 10, 300],
      ["TRTC_ROOM_CONTROL_BATCH_SIZE", 1, 10]
    ]) {
      const value = env[key]?.trim();
      if (!value) continue;
      if (!/^\d+$/.test(value) || Number(value) < minimum || Number(value) > maximum) {
        errors.push(`${key} must be an integer between ${minimum} and ${maximum}`);
      }
    }
  }
  if (env.TRTC_USER_SIG_TTL_SECONDS) {
    const ttl = env.TRTC_USER_SIG_TTL_SECONDS;
    if (!/^\d+$/.test(ttl) || Number(ttl) < 60 || Number(ttl) > 900) {
      errors.push("TRTC_USER_SIG_TTL_SECONDS must be an integer between 60 and 900");
    }
  }
  if (
    env.AVAILABILITY_REMINDER_DELIVERY_ENABLED
    && !["true", "false"].includes(env.AVAILABILITY_REMINDER_DELIVERY_ENABLED)
  ) {
    errors.push("AVAILABILITY_REMINDER_DELIVERY_ENABLED must be true or false when configured");
  }
  for (const [key, minimum, maximum] of [
    ["AVAILABILITY_REMINDER_DELIVERY_INTERVAL_SECONDS", 15, 60 * 60],
    ["AVAILABILITY_REMINDER_DELIVERY_BATCH_SIZE", 1, 100]
  ]) {
    const value = env[key]?.trim();
    if (!value) continue;
    if (!/^\d+$/.test(value) || Number(value) < minimum || Number(value) > maximum) {
      errors.push(`${key} must be an integer between ${minimum} and ${maximum}`);
    }
  }
  const configuredSubscribeTemplateKeys = new Set();
  if (env.WECHAT_SUBSCRIBE_TEMPLATES_JSON) {
    try {
      const templates = JSON.parse(env.WECHAT_SUBSCRIBE_TEMPLATES_JSON);
      if (!Array.isArray(templates) || templates.length === 0) {
        errors.push("WECHAT_SUBSCRIBE_TEMPLATES_JSON must be a non-empty JSON array");
      } else {
        const keys = new Set();
        const templateIds = new Set();
        let validTemplateMap = true;
        for (const template of templates) {
          if (!template || typeof template !== "object" || !template.key || !template.templateId || !template.data || typeof template.data !== "object") {
            errors.push("WECHAT_SUBSCRIBE_TEMPLATES_JSON contains an invalid template");
            validTemplateMap = false;
            break;
          }
          if (keys.has(template.key)) {
            errors.push("WECHAT_SUBSCRIBE_TEMPLATES_JSON template keys must be unique");
            validTemplateMap = false;
            break;
          }
          if (templateIds.has(template.templateId)) {
            errors.push("WECHAT_SUBSCRIBE_TEMPLATES_JSON template IDs must be unique");
            validTemplateMap = false;
            break;
          }
          keys.add(template.key);
          templateIds.add(template.templateId);
        }
        if (validTemplateMap) {
          for (const key of keys) configuredSubscribeTemplateKeys.add(key);
        }
        if (production) {
          const missing = REQUIRED_TRANSACTIONAL_TEMPLATE_KEYS.filter((key) => !keys.has(key));
          if (missing.length) errors.push(`WECHAT_SUBSCRIBE_TEMPLATES_JSON is missing event keys: ${missing.join(", ")}`);
        }
      }
    } catch {
      errors.push("WECHAT_SUBSCRIBE_TEMPLATES_JSON must be valid JSON");
    }
  }
  if (availabilityReminderDeliveryEnabled) {
    if (env.WECHAT_SUBSCRIBE_MESSAGES_ENABLED !== "true") {
      errors.push("AVAILABILITY_REMINDER_DELIVERY_ENABLED requires WECHAT_SUBSCRIBE_MESSAGES_ENABLED=true");
    }
    if (!configuredSubscribeTemplateKeys.has(AVAILABILITY_REMINDER_TEMPLATE_KEY)) {
      errors.push("AVAILABILITY_REMINDER_DELIVERY_ENABLED requires an availabilityReminder subscribe template");
    }
  }

  if (production && env.SEED_ON_STARTUP !== "false") errors.push("production SEED_ON_STARTUP must be false");
  if (production && env.SMS_PROVIDER === "mock") errors.push("production SMS_PROVIDER cannot be mock");

  return [...new Set(errors)];
}

function extractQuotedProperty(source, property) {
  const match = source.match(new RegExp(`${property}\\s*:\\s*["']([^"']+)["']`));
  return match?.[1] ?? "";
}

function extractExportedString(source, name) {
  const match = source.match(new RegExp(`export\\s+const\\s+${name}\\s*=\\s*["']([^"']+)["']`));
  return match?.[1] ?? "";
}

export function validateMiniProgramReleaseConfig(env, source) {
  if (env.APP_ENV !== "production") return [];
  const errors = [];
  const releaseBackend = extractQuotedProperty(source, "release");
  const privacyUrl = extractQuotedProperty(source, "privacy");
  const termsUrl = extractQuotedProperty(source, "terms");
  const consentVersion = extractExportedString(source, "LEGAL_CONSENT_VERSION");
  const expectedBackend = `${(env.WECHAT_PAY_NOTIFY_BASE_URL ?? "").replace(/\/+$/, "")}/${env.API_PREFIX ?? "api/v1"}`;
  if (!releaseBackend || releaseBackend !== expectedBackend) {
    errors.push(`Mini Program release backend must equal ${expectedBackend}`);
  }
  if (!privacyUrl || privacyUrl !== env.LEGAL_PRIVACY_URL) {
    errors.push("Mini Program privacy URL must equal LEGAL_PRIVACY_URL");
  }
  if (!termsUrl || termsUrl !== env.LEGAL_TERMS_URL) {
    errors.push("Mini Program terms URL must equal LEGAL_TERMS_URL");
  }
  if (!consentVersion || consentVersion !== env.LEGAL_CONSENT_VERSION) {
    errors.push("Mini Program consent version must equal LEGAL_CONSENT_VERSION");
  }
  return errors;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: node scripts/deployment-preflight.mjs <environment-file>");
    process.exit(2);
  }
  const env = parseEnv(readFileSync(resolve(path), "utf8"));
  const repositoryRoot = resolve(fileURLToPath(import.meta.url), "../../../..");
  const miniProgramConfig = readFileSync(resolve(repositoryRoot, "frontend/miniprogram/utils/config.ts"), "utf8");
  const errors = [
    ...validateDeploymentConfig(env),
    ...validateMiniProgramReleaseConfig(env, miniProgramConfig)
  ];
  if (errors.length) {
    console.error(`Deployment preflight failed with ${errors.length} issue(s):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`Deployment preflight passed for ${env.APP_ENV} (secret values not printed)`);
}
