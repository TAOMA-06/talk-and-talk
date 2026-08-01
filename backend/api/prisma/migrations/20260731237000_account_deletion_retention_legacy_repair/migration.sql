-- Migration 23500 could only observe that a legacy deletion request had been
-- marked completed. It could not prove that purpose-ended source rows had
-- actually been erased. Re-open only those narrowly identified legacy rows so
-- the application worker can erase and verify them before recording `deleted`.

BEGIN;

LOCK TABLE "AccountDataRetentionRecord" IN ACCESS EXCLUSIVE MODE;

ALTER TABLE "AccountDataRetentionRecord"
DROP CONSTRAINT "AccountDataRetentionRecord_disposition_check";
ALTER TABLE "AccountDataRetentionRecord"
DROP CONSTRAINT "AccountDataRetentionRecord_expiry_outcome_check";

ALTER TABLE "AccountDataRetentionRecord"
ADD CONSTRAINT "AccountDataRetentionRecord_disposition_check"
CHECK ("disposition" IN ('pendingErasure', 'deleted', 'retainedRestricted', 'pseudonymized'));
ALTER TABLE "AccountDataRetentionRecord"
ADD CONSTRAINT "AccountDataRetentionRecord_expiry_outcome_check"
CHECK (
  ("disposition" = 'pendingErasure' AND "expiryProcessedAt" IS NULL)
  OR ("disposition" = 'deleted' AND "expiryProcessedAt" IS NOT NULL)
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
    OR NEW."recordCount" IS DISTINCT FROM OLD."recordCount"
    OR NEW."processingRestrictedAt" IS DISTINCT FROM OLD."processingRestrictedAt"
    OR NEW."retentionEndsAt" IS DISTINCT FROM OLD."retentionEndsAt"
    OR NEW."details" IS DISTINCT FROM OLD."details"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'retention ledger evidence is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."policyApprovalStatus" IS DISTINCT FROM OLD."policyApprovalStatus"
    OR NEW."policyApprovalReference" IS DISTINCT FROM OLD."policyApprovalReference"
  THEN
    IF NOT (
      OLD."policyApprovalStatus" = 'pendingLegalApproval'
      AND NEW."policyApprovalStatus" = 'approved'
      AND length(btrim(COALESCE(NEW."policyApprovalReference", ''))) > 0
      AND (
        OLD."policyApprovalReference" IS NULL
        OR NEW."policyApprovalReference" = OLD."policyApprovalReference"
      )
    ) THEN
      RAISE EXCEPTION 'retention ledger approval transition is invalid'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."disposition" IS DISTINCT FROM OLD."disposition"
    AND NOT (
      (OLD."disposition" = 'retainedRestricted' AND NEW."disposition" = 'pseudonymized')
      OR (OLD."disposition" = 'pendingErasure' AND NEW."disposition" = 'deleted')
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
    (NEW."disposition" = 'pendingErasure' AND NEW."expiryProcessedAt" IS NULL)
    OR (NEW."disposition" = 'deleted' AND NEW."expiryProcessedAt" IS NOT NULL)
    OR (NEW."disposition" = 'retainedRestricted' AND NEW."expiryProcessedAt" IS NULL)
    OR (NEW."disposition" = 'pseudonymized' AND NEW."expiryProcessedAt" IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'retention ledger processed outcome is inconsistent'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The one-time legacy correction must bypass the old immutable-outcome trigger,
-- but that exception must not survive the migration transaction. The table is
-- already held under ACCESS EXCLUSIVE lock, so no concurrent writer can enter
-- while the named trigger is temporarily disabled.
ALTER TABLE "AccountDataRetentionRecord"
DISABLE TRIGGER "AccountDataRetentionRecord_evidence_immutable";

UPDATE "AccountDataRetentionRecord"
SET
  "disposition" = 'pendingErasure',
  "expiryProcessedAt" = NULL,
  "expiryNextAttemptAt" = CURRENT_TIMESTAMP,
  "expiryLastErrorCode" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'legacy-retention-' || md5("deletionRequestId" || ':' || "category")
  AND COALESCE("details"->>'legacyBackfill', 'false') = 'true'
  AND "policyVersion" = '2026.2-technical-baseline'
  AND "category" IN (
    'identity_authentication_profile',
    'preferences_behavior_notifications',
    'public_user_content'
  )
  AND "disposition" = 'deleted'
  AND "expiryProcessedAt" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "AccountDeletionRequest" request
    WHERE request."id" = "AccountDataRetentionRecord"."deletionRequestId"
      AND request."userId" = "AccountDataRetentionRecord"."userId"
      AND request."status" = 'completed'
  );

ALTER TABLE "AccountDataRetentionRecord"
ENABLE TRIGGER "AccountDataRetentionRecord_evidence_immutable";

-- Future calls to the legacy ledger repair function from an older application
-- binary are also made safe at insertion time.
CREATE OR REPLACE FUNCTION "mark_legacy_retention_for_verified_erasure"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."id" = 'legacy-retention-' || md5(NEW."deletionRequestId" || ':' || NEW."category")
    AND COALESCE(NEW."details"->>'legacyBackfill', 'false') = 'true'
    AND NEW."policyVersion" = '2026.2-technical-baseline'
    AND NEW."category" IN (
      'identity_authentication_profile',
      'preferences_behavior_notifications',
      'public_user_content'
    )
    AND NEW."disposition" = 'deleted'
  THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "AccountDeletionRequest" request
      WHERE request."id" = NEW."deletionRequestId"
        AND request."userId" = NEW."userId"
        AND request."status" = 'completed'
    ) THEN
      RAISE EXCEPTION 'legacy pending erasure provenance is invalid'
        USING ERRCODE = '23514';
    END IF;
    NEW."disposition" := 'pendingErasure';
    NEW."expiryProcessedAt" := NULL;
    NEW."expiryNextAttemptAt" := CURRENT_TIMESTAMP;
    NEW."expiryLastErrorCode" := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "AccountDataRetentionRecord_legacy_pending_erasure"
ON "AccountDataRetentionRecord";
CREATE TRIGGER "AccountDataRetentionRecord_legacy_pending_erasure"
BEFORE INSERT ON "AccountDataRetentionRecord"
FOR EACH ROW
EXECUTE FUNCTION "mark_legacy_retention_for_verified_erasure"();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "AccountDataRetentionRecord"
    WHERE "id" = 'legacy-retention-' || md5("deletionRequestId" || ':' || "category")
      AND COALESCE("details"->>'legacyBackfill', 'false') = 'true'
      AND "policyVersion" = '2026.2-technical-baseline'
      AND "category" IN (
        'identity_authentication_profile',
        'preferences_behavior_notifications',
        'public_user_content'
      )
      AND "disposition" <> 'pendingErasure'
  ) THEN
    RAISE EXCEPTION 'legacy deletion erasure repair is incomplete';
  END IF;
END;
$$;

COMMIT;
