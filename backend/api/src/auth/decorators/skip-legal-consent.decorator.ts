import { SetMetadata } from "@nestjs/common";

export const SKIP_LEGAL_CONSENT_KEY = "skipLegalConsent";

/** Allows authenticated users to establish or exercise rights before accepting current terms. */
export const SkipLegalConsent = () => SetMetadata(SKIP_LEGAL_CONSENT_KEY, true);
