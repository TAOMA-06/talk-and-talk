/**
 * Production API endpoint. Staging builds should replace this constant through the
 * build script before upload; both hosts must be configured in Mini Program server domains.
 */
export const API_BASE_URL = "https://api.talkandtalk.app/api/v1";

export const LEGAL_URLS = {
  privacy: "https://api.talkandtalk.app/legal/privacy.html",
  terms: "https://api.talkandtalk.app/legal/terms.html"
} as const;

export const LEGAL_CONSENT_VERSION = "1.0-2026-07-19";
