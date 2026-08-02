/**
 * Public, release-coupled definition of the documents a Web visitor accepts.
 *
 * These values are intentionally public because they are displayed before
 * sign-in. Before a production release they must exactly match the backend's
 * LEGAL_CONSENT_VERSION, LEGAL_PRIVACY_URL and LEGAL_TERMS_URL values.
 */
const configured = (value: string | undefined, fallback: string) => value?.trim() || fallback;

export const LEGAL_CONSENT_VERSION = configured(
  process.env.NEXT_PUBLIC_LEGAL_CONSENT_VERSION,
  "2.2-2026-08-01",
);

export const LEGAL_PRIVACY_URL = configured(
  process.env.NEXT_PUBLIC_LEGAL_PRIVACY_URL,
  "https://api.talkandtalk.app/legal/privacy.html",
);

export const LEGAL_TERMS_URL = configured(
  process.env.NEXT_PUBLIC_LEGAL_TERMS_URL,
  "https://api.talkandtalk.app/legal/terms.html",
);

export const legalConsentDefinition = {
  version: LEGAL_CONSENT_VERSION,
  privacyUrl: LEGAL_PRIVACY_URL,
  termsUrl: LEGAL_TERMS_URL,
} as const;
