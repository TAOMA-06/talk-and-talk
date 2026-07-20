-- Preserve the exact identity and signed-service-agreement evidence references
-- that were valid when each order was formed. Profile resubmission must never
-- erase the audit trail for an existing commercial transaction.
ALTER TABLE "Order"
  ADD COLUMN "identityEvidenceRefSnapshot" TEXT,
  ADD COLUMN "serviceAgreementEvidenceRefSnapshot" TEXT;

ALTER TABLE "CompanionEarning"
  ADD COLUMN "identityEvidenceRefSnapshot" TEXT,
  ADD COLUMN "serviceAgreementEvidenceRefSnapshot" TEXT;
