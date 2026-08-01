ALTER TABLE "AccountDataRetentionRecord"
ADD COLUMN "expiryAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "expiryNextAttemptAt" TIMESTAMP(3),
ADD COLUMN "expiryLastErrorCode" TEXT;

DROP INDEX IF EXISTS "AccountDataRetentionRecord_disposition_retentionEndsAt_expiryProcessedAt_idx";
CREATE INDEX "AccountDataRetentionRecord_disposition_retentionEndsAt_expiryProcessedAt_idx"
ON "AccountDataRetentionRecord"("disposition", "retentionEndsAt", "expiryProcessedAt");
CREATE INDEX "AccountDataRetentionRecord_disposition_expiryNextAttemptAt_retentionEndsAt_idx"
ON "AccountDataRetentionRecord"("disposition", "expiryNextAttemptAt", "retentionEndsAt");

ALTER TABLE "AccountDataRetentionRecord"
DROP CONSTRAINT "AccountDataRetentionRecord_disposition_check";
UPDATE "AccountDataRetentionRecord"
SET "disposition" = 'pseudonymized'
WHERE "disposition" = 'anonymized';
ALTER TABLE "AccountDataRetentionRecord"
ADD CONSTRAINT "AccountDataRetentionRecord_disposition_check"
CHECK ("disposition" IN ('deleted', 'retainedRestricted', 'pseudonymized'));
ALTER TABLE "AccountDataRetentionRecord"
ADD CONSTRAINT "AccountDataRetentionRecord_expiry_attempt_count_check"
CHECK ("expiryAttemptCount" >= 0);
ALTER TABLE "AccountDataRetentionRecord"
ADD CONSTRAINT "AccountDataRetentionRecord_expiry_outcome_check"
CHECK (
  ("disposition" = 'deleted' AND "expiryProcessedAt" IS NOT NULL)
  OR ("disposition" = 'retainedRestricted' AND "expiryProcessedAt" IS NULL)
  OR ("disposition" = 'pseudonymized' AND "expiryProcessedAt" IS NOT NULL)
);

CREATE OR REPLACE FUNCTION "prevent_retention_ledger_evidence_rewrite"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."deletionRequestId" IS DISTINCT FROM OLD."deletionRequestId"
    OR NEW."userId" IS DISTINCT FROM OLD."userId"
    OR NEW."category" IS DISTINCT FROM OLD."category"
    OR NEW."legalBasisCode" IS DISTINCT FROM OLD."legalBasisCode"
    OR NEW."policyVersion" IS DISTINCT FROM OLD."policyVersion"
    OR NEW."policyApprovalStatus" IS DISTINCT FROM OLD."policyApprovalStatus"
    OR NEW."policyApprovalReference" IS DISTINCT FROM OLD."policyApprovalReference"
    OR NEW."recordCount" IS DISTINCT FROM OLD."recordCount"
    OR NEW."processingRestrictedAt" IS DISTINCT FROM OLD."processingRestrictedAt"
    OR NEW."retentionEndsAt" IS DISTINCT FROM OLD."retentionEndsAt"
    OR NEW."details" IS DISTINCT FROM OLD."details"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'retention ledger evidence is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."disposition" IS DISTINCT FROM OLD."disposition"
    AND NOT (
      OLD."disposition" = 'retainedRestricted'
      AND NEW."disposition" = 'pseudonymized'
    )
  THEN
    RAISE EXCEPTION 'retention ledger disposition transition is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."expiryProcessedAt" IS NOT NULL
    AND (
      NEW."expiryProcessedAt" IS DISTINCT FROM OLD."expiryProcessedAt"
      OR NEW."expiryAttemptCount" IS DISTINCT FROM OLD."expiryAttemptCount"
      OR NEW."expiryNextAttemptAt" IS DISTINCT FROM OLD."expiryNextAttemptAt"
      OR NEW."expiryLastErrorCode" IS DISTINCT FROM OLD."expiryLastErrorCode"
      OR NEW."disposition" IS DISTINCT FROM OLD."disposition"
    )
  THEN
    RAISE EXCEPTION 'processed retention ledger outcome is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."expiryAttemptCount" < OLD."expiryAttemptCount"
    OR NEW."expiryAttemptCount" < 0
  THEN
    RAISE EXCEPTION 'retention ledger attempt count cannot decrease'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
      (NEW."disposition" = 'deleted' AND NEW."expiryProcessedAt" IS NOT NULL)
      OR (NEW."disposition" = 'retainedRestricted' AND NEW."expiryProcessedAt" IS NULL)
      OR (NEW."disposition" = 'pseudonymized' AND NEW."expiryProcessedAt" IS NOT NULL)
    )
  THEN
    RAISE EXCEPTION 'retention ledger processed outcome is inconsistent'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AccountDataRetentionRecord_evidence_immutable"
BEFORE UPDATE ON "AccountDataRetentionRecord"
FOR EACH ROW
EXECUTE FUNCTION "prevent_retention_ledger_evidence_rewrite"();
