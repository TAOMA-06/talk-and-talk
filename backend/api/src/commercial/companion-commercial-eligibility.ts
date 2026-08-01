import { HttpStatus } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";

export type CompanionCommercialEligibilityRecord = {
  status?: string | null;
  adultEligibilityVerdict?: string | null;
  adultEligibilityVerifiedAt?: Date | null;
  adultEligibilityValidUntil?: Date | null;
};

export type CurrentCompanionCommercialEligibility = {
  verifiedAt: Date;
  validUntil: Date;
};

type CompanionEligibilityDatabase = {
  companionCommercialProfile: {
    findUnique(input: Record<string, unknown>): Promise<CompanionCommercialEligibilityRecord | null>;
  };
};

/**
 * Reads the current commercial record after the caller has locked the owning
 * CompanionProfile row. That parent-row lock serializes this decision with
 * profile approval, suspension and adult-eligibility renewal.
 */
export async function assertCurrentCompanionCommercialEligibility(
  db: CompanionEligibilityDatabase,
  companionId: string,
  now: Date,
  requiredThrough: Date
): Promise<CurrentCompanionCommercialEligibility> {
  const profile = await db.companionCommercialProfile.findUnique({
    where: { companionId },
    select: {
      status: true,
      adultEligibilityVerdict: true,
      adultEligibilityVerifiedAt: true,
      adultEligibilityValidUntil: true
    }
  });
  if (profile?.status !== "verified") {
    throw new AppException(
      "COMPANION_COMMERCIAL_PROFILE_NOT_VERIFIED",
      "The companion commercial profile is not currently verified",
      HttpStatus.CONFLICT,
      { companionEligibilityStatus: "unavailable", existingOrderRightsRemainAvailable: true }
    );
  }

  if (
    profile.adultEligibilityVerdict !== "adult"
    || !(profile.adultEligibilityVerifiedAt instanceof Date)
    || !(profile.adultEligibilityValidUntil instanceof Date)
    || profile.adultEligibilityValidUntil.getTime() <= now.getTime()
  ) {
    throw new AppException(
      "COMPANION_ADULT_ELIGIBILITY_NOT_CURRENT",
      "The companion's adult eligibility is not current",
      HttpStatus.CONFLICT,
      { companionEligibilityStatus: "unavailable", existingOrderRightsRemainAvailable: true }
    );
  }

  if (
    Number.isNaN(requiredThrough.getTime())
    || profile.adultEligibilityValidUntil.getTime() < requiredThrough.getTime()
  ) {
    throw new AppException(
      "COMPANION_ADULT_ELIGIBILITY_VALIDITY_TOO_SHORT",
      "The companion's adult eligibility must remain current through the service end",
      HttpStatus.CONFLICT,
      {
        companionEligibilityStatus: "expiresBeforeServiceEnd",
        requiredThrough: Number.isNaN(requiredThrough.getTime()) ? null : requiredThrough.toISOString(),
        existingOrderRightsRemainAvailable: true
      }
    );
  }

  return {
    verifiedAt: profile.adultEligibilityVerifiedAt,
    validUntil: profile.adultEligibilityValidUntil
  };
}
