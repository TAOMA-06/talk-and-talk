CREATE TYPE "CompanionAdultEligibilityVerdict" AS ENUM (
  'pending',
  'adult',
  'ineligible'
);

ALTER TABLE "CompanionCommercialProfile"
ADD COLUMN "adultEligibilityVerdict" "CompanionAdultEligibilityVerdict" NOT NULL DEFAULT 'pending',
ADD COLUMN "adultEligibilityVerifiedAt" TIMESTAMP(3),
ADD COLUMN "adultEligibilityValidUntil" TIMESTAMP(3),
ADD COLUMN "adultEligibilityEvidenceRef" TEXT;

ALTER TABLE "Order"
ADD COLUMN "adultEligibilityVerdictSnapshot" "CompanionAdultEligibilityVerdict",
ADD COLUMN "adultEligibilityVerifiedAtSnapshot" TIMESTAMP(3),
ADD COLUMN "adultEligibilityValidUntilSnapshot" TIMESTAMP(3);

ALTER TABLE "Order"
ADD CONSTRAINT "Order_adult_eligibility_snapshot_check"
CHECK (
  ("adultEligibilityVerdictSnapshot" IS NULL
    AND "adultEligibilityVerifiedAtSnapshot" IS NULL
    AND "adultEligibilityValidUntilSnapshot" IS NULL)
  OR
  ("adultEligibilityVerdictSnapshot" = 'adult'
    AND "adultEligibilityVerifiedAtSnapshot" IS NOT NULL
    AND "adultEligibilityValidUntilSnapshot" IS NOT NULL
    AND "adultEligibilityValidUntilSnapshot" > "adultEligibilityVerifiedAtSnapshot")
);

ALTER TABLE "CompanionCommercialProfile"
ADD CONSTRAINT "CompanionCommercialProfile_adult_eligibility_window_check"
CHECK (
  ("adultEligibilityVerdict" = 'pending'
    AND "adultEligibilityVerifiedAt" IS NULL
    AND "adultEligibilityValidUntil" IS NULL
    AND "adultEligibilityEvidenceRef" IS NULL)
  OR
  ("adultEligibilityVerdict" IN ('adult', 'ineligible')
    AND "adultEligibilityVerifiedAt" IS NOT NULL
    AND "adultEligibilityValidUntil" IS NOT NULL
    AND "adultEligibilityValidUntil" > "adultEligibilityVerifiedAt"
    AND "adultEligibilityEvidenceRef" IS NOT NULL)
);

-- Existing approvals did not snapshot an explicit adult verdict and validity
-- window. They are deliberately returned to review and unpublished rather
-- than silently grandfathered into commercial eligibility.
UPDATE "CompanionProfile" AS companion
SET "isPublished" = false
FROM "CompanionCommercialProfile" AS commercial
WHERE commercial."companionId" = companion."id"
  AND commercial."status" = 'verified';

UPDATE "CompanionCommercialProfile"
SET
  "status" = 'pendingReview',
  "verifiedAt" = NULL,
  "verifiedById" = NULL,
  "nextReviewDueAt" = NULL
WHERE "status" = 'verified';

CREATE INDEX "CompanionCommercialProfile_status_adultEligibilityVerdict_adultEligibilityValidUntil_idx"
ON "CompanionCommercialProfile"(
  "status",
  "adultEligibilityVerdict",
  "adultEligibilityValidUntil"
);
