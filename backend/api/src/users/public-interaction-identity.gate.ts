import { HttpStatus } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";

/**
 * Shared hard gate for public community posts and real-time messaging.
 *
 * MP-D08: use the existing server identity signal (`profile.isVerified`) without
 * selecting a new KYC vendor or collection fields. Adult-eligibility remains a
 * separate commercial gate and must not be treated as public-interaction identity.
 */
export const PUBLIC_INTERACTION_IDENTITY_REQUIRED = "PUBLIC_INTERACTION_IDENTITY_REQUIRED";
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
  if (input.profile?.isVerified === true) {
    return "verified";
  }
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
    "A verified identity is required before public community posts or real-time messaging",
    HttpStatus.FORBIDDEN,
    publicInteractionIdentityDetails(verificationStatus)
  );
}
