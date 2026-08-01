ALTER TYPE "InvoiceRequestStatus" ADD VALUE IF NOT EXISTS 'cancelled';

ALTER TABLE "DataRightsRequest"
  ADD COLUMN "resolutionEvidenceReference" TEXT;

ALTER TABLE "DataRightsRequestFollowUp"
  ADD COLUMN "requestedInformation" TEXT;

UPDATE "DataRightsRequestFollowUp"
SET "requestedInformation" = 'Historical platform information request (original question was not retained)'
WHERE "requestedInformation" IS NULL;

ALTER TABLE "DataRightsRequestFollowUp"
  ALTER COLUMN "requestedInformation" SET NOT NULL;

ALTER TABLE "InvoiceRequest"
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "issuanceEvidenceReference" TEXT,
  ADD COLUMN "voidEvidenceReference" TEXT;
