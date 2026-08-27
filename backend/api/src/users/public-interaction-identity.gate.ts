import { HttpStatus } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";

/**
 * Shared hard gate for new paid text interactions, public community posts and
 * real-time messaging. Orders and prepay use it because messaging is the only
 * delivery channel in the first-release commercial surface.
 *
 * IDENTITY-R01/R02: the legacy `profile.isVerified` boolean has no independently
 * retrievable authority binding. Until a real identity authority and lifecycle are
 * approved, it must not unlock public posting or real-time messaging. This does not
 * introduce a KYC vendor, collection field, or substitute adult eligibility.
 */
export const PUBLIC_INTERACTION_IDENTITY_REQUIRED = "PUBLIC_INTERACTION_IDENTITY_REQUIRED";
/** No approved, revocable authority-backed grant model exists in this release. */
export const PUBLIC_INTERACTION_IDENTITY_AUTHORITY_AVAILABLE = false;
/** Mini Program recovery entry for identity hard-gate refusals (not a raw API path). */
export const PUBLIC_INTERACTION_IDENTITY_RECOVERY_PATH = "/pages/profile/index";

export type PublicInteractionIdentityInput = {
  accountStatus?: string | null;
  profile?: { isVerified?: boolean | null } | null;
};

export type PublicInteractionIdentityStatus =
  | "verified"
  | "notVerified"
  | "accountUnavailable";

export function resolvePublicInteractionIdentityStatus(
  input: PublicInteractionIdentityInput
): PublicInteractionIdentityStatus {
  if (input.accountStatus != null && input.accountStatus !== "active") {
    return "accountUnavailable";
  }
  // Existing true values are deliberately ignored: the repository cannot prove
  // that every legacy row is bound to a current, revocable approval record.
  return "notVerified";
}

export function isPublicInteractionIdentityVerified(
  input: PublicInteractionIdentityInput
): boolean {
  return resolvePublicInteractionIdentityStatus(input) === "verified";
}

export function publicInteractionIdentityDetails(
  verificationStatus: Exclude<PublicInteractionIdentityStatus, "verified">
) {
  return {
    verificationStatus,
    recoveryPath: PUBLIC_INTERACTION_IDENTITY_RECOVERY_PATH,
    publicInteractionBlocked: true as const
  };
}

export function assertPublicInteractionIdentity(
  input: PublicInteractionIdentityInput
): void {
  const verificationStatus = resolvePublicInteractionIdentityStatus(input);
  if (verificationStatus === "verified") return;
  throw new AppException(
    PUBLIC_INTERACTION_IDENTITY_REQUIRED,
    "New paid text interactions, public posting and real-time messaging stay unavailable until identity verification has an approved authority",
    HttpStatus.FORBIDDEN,
    publicInteractionIdentityDetails(verificationStatus)
  );
}
