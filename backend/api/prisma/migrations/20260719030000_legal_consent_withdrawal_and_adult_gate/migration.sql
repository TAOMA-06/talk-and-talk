-- A consent may be withdrawn and later accepted again. Preserve each acceptance
-- as a separate receipt instead of reviving the old immutable event.
ALTER TABLE "LegalConsentReceipt"
  ADD COLUMN "adultConfirmed" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "withdrawnAt" TIMESTAMP(3);

-- Earlier receipts did not contain an explicit adult confirmation. Preserve
-- them for audit, but withdraw them so users must complete the new gate.
UPDATE "LegalConsentReceipt"
SET "adultConfirmed" = TRUE,
    "withdrawnAt" = COALESCE("withdrawnAt", CURRENT_TIMESTAMP);

DROP INDEX IF EXISTS "LegalConsentReceipt_userId_version_key";
CREATE INDEX "LegalConsentReceipt_userId_version_consentedAt_idx"
  ON "LegalConsentReceipt"("userId", "version", "consentedAt");

ALTER TABLE "LegalConsentReceipt"
  ADD CONSTRAINT "LegalConsentReceipt_adult_confirmation_check"
  CHECK ("adultConfirmed" = TRUE);

ALTER TABLE "LegalConsentReceipt" ALTER COLUMN "adultConfirmed" DROP DEFAULT;
