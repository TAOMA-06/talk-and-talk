-- Bind object-storage deletion to the exact category-level retention ledger.
-- The binding is immutable: it is the durable join used to serialize a legal
-- hold placement against a storage delete claim.
ALTER TABLE "MediaAsset"
  ADD COLUMN "retentionExpiryRecordId" TEXT,
  ADD COLUMN "storageDeleteOutcomeUnknownAt" TIMESTAMP(3);

ALTER TABLE "AccountDataRetentionRecord"
  ADD COLUMN "mediaDeletionClaimedAt" TIMESTAMP(3);

ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "MediaAsset_retention_expiry_record_fkey"
    FOREIGN KEY ("retentionExpiryRecordId")
    REFERENCES "AccountDataRetentionRecord"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "MediaAsset_storage_delete_outcome_unknown_check"
    CHECK (
      "storageDeleteOutcomeUnknownAt" IS NULL
      OR (
        "storageDeletedAt" IS NULL
        AND "storageDeleteRequestedAt" IS NOT NULL
      )
    );

CREATE INDEX "MediaAsset_retention_expiry_barrier"
  ON "MediaAsset"(
    "retentionExpiryRecordId",
    "storageDeletedAt",
    "storageDeleteLeaseToken",
    "id"
  );

-- Bind historical rows before either side of the new barrier becomes active.
-- Controlled evidence ownership is uploader-bound by migrations 077/250200;
-- chat media is likewise authored by uploaderId, so the deleted user's exact
-- category ledger is the authoritative preservation scope.
WITH derived AS MATERIALIZED (
  SELECT asset."id" AS "assetId", record."id" AS "recordId"
  FROM "MediaAsset" AS asset
  JOIN LATERAL (
    SELECT retention."id"
    FROM "AccountDataRetentionRecord" AS retention
    WHERE retention."userId" = asset."uploaderId"
      AND retention."disposition" = 'retainedRestricted'
      AND retention."expiryProcessedAt" IS NULL
      AND retention."category" = CASE
        WHEN asset."purpose"::TEXT IN (
          'chatMessage',
          'orderSupportFact',
          'attendanceDisputeStatement',
          'companionIncidentReport'
        ) THEN 'support_disputes_safety'
        WHEN asset."purpose"::TEXT IN (
          'userAccountAppeal',
          'companionAccountAppeal'
        ) THEN 'consent_rights_account_governance'
        ELSE NULL
      END
    ORDER BY retention."createdAt" DESC, retention."id" DESC
    LIMIT 1
  ) AS record ON TRUE
  WHERE asset."retentionExpiryRecordId" IS NULL
)
UPDATE "MediaAsset" AS asset
SET "retentionExpiryRecordId" = derived."recordId",
    "updatedAt" = CURRENT_TIMESTAMP
FROM derived
WHERE asset."id" = derived."assetId";

WITH claimed AS MATERIALIZED (
  SELECT
    asset."retentionExpiryRecordId" AS "recordId",
    MIN(COALESCE(
      asset."storageDeleteRequestedAt",
      asset."storageDeletedAt",
      CURRENT_TIMESTAMP
    )) AS "claimedAt"
  FROM "MediaAsset" AS asset
  WHERE asset."retentionExpiryRecordId" IS NOT NULL
    AND (
      asset."storageDeleteRequestedAt" IS NOT NULL
      OR asset."storageDeletedAt" IS NOT NULL
      OR asset."storageDeleteLeaseToken" IS NOT NULL
    )
  GROUP BY asset."retentionExpiryRecordId"
)
UPDATE "AccountDataRetentionRecord" AS record
SET "mediaDeletionClaimedAt" = COALESCE(
      record."mediaDeletionClaimedAt",
      GREATEST(record."createdAt", claimed."claimedAt")
    ),
    "updatedAt" = CURRENT_TIMESTAMP
FROM claimed
WHERE record."id" = claimed."recordId";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "AccountDataRetentionRecord" AS record
    WHERE record."mediaDeletionClaimedAt" IS NOT NULL
      AND (
        EXISTS (
          SELECT 1
          FROM "AccountDataRetentionLegalHoldAction" AS action
          WHERE action."retentionRecordId" = record."id"
            AND action."action" = 'placement'
            AND action."status" = 'pending'
        )
        OR EXISTS (
          SELECT 1
          FROM "AccountDataRetentionLegalHold" AS hold
          WHERE hold."retentionRecordId" = record."id"
            AND hold."releasedAt" IS NULL
        )
      )
  ) THEN
    RAISE EXCEPTION 'existing legal hold intersects an already-started retention media deletion'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "guard_retention_media_claim_marker"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."mediaDeletionClaimedAt" IS NOT NULL
     AND NEW."mediaDeletionClaimedAt" IS DISTINCT FROM OLD."mediaDeletionClaimedAt" THEN
    RAISE EXCEPTION 'retention media deletion claim marker is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."mediaDeletionClaimedAt" IS NOT NULL
     AND NEW."mediaDeletionClaimedAt" < NEW."createdAt" THEN
    RAISE EXCEPTION 'retention media deletion claim marker predates the ledger'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AccountDataRetentionRecord_media_claim_marker_guard"
BEFORE UPDATE OF "mediaDeletionClaimedAt" ON "AccountDataRetentionRecord"
FOR EACH ROW EXECUTE FUNCTION "guard_retention_media_claim_marker"();

CREATE OR REPLACE FUNCTION "guard_media_retention_expiry_binding"()
RETURNS TRIGGER AS $$
DECLARE
  record_state RECORD;
BEGIN
  IF NEW."retentionExpiryRecordId" IS NULL THEN
    IF TG_OP = 'UPDATE' AND OLD."retentionExpiryRecordId" IS NOT NULL THEN
      RAISE EXCEPTION 'retention media binding is immutable'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD."retentionExpiryRecordId" IS NOT NULL
     AND NEW."retentionExpiryRecordId" IS DISTINCT FROM OLD."retentionExpiryRecordId" THEN
    RAISE EXCEPTION 'retention media binding is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW."retentionExpiryRecordId" IS NOT DISTINCT FROM OLD."retentionExpiryRecordId" THEN
    RETURN NEW;
  END IF;

  SELECT
    record."id",
    record."category",
    record."disposition",
    record."expiryProcessedAt"
  INTO record_state
  FROM "AccountDataRetentionRecord" AS record
  WHERE record."id" = NEW."retentionExpiryRecordId"
  FOR UPDATE;

  IF NOT FOUND
     OR record_state."disposition" <> 'retainedRestricted'
     OR record_state."expiryProcessedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'retention media binding requires an active restricted-retention record'
      USING ERRCODE = '23514';
  END IF;

  IF (
    NEW."purpose"::TEXT IN (
      'chatMessage',
      'orderSupportFact',
      'attendanceDisputeStatement',
      'companionIncidentReport'
    )
    AND record_state."category" <> 'support_disputes_safety'
  ) OR (
    NEW."purpose"::TEXT IN ('userAccountAppeal', 'companionAccountAppeal')
    AND record_state."category" <> 'consent_rights_account_governance'
  ) OR NEW."purpose"::TEXT NOT IN (
    'chatMessage',
    'orderSupportFact',
    'attendanceDisputeStatement',
    'companionIncidentReport',
    'userAccountAppeal',
    'companionAccountAppeal'
  ) THEN
    RAISE EXCEPTION 'retention media purpose does not match the retention category'
      USING ERRCODE = '23514';
  END IF;

  -- Binding is preservation metadata, not a deletion claim. It remains legal
  -- while held so legacy NULL-bound rows become durably associated with the
  -- exact record that blocks their later storage claim.
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "MediaAsset_retention_expiry_binding_guard"
BEFORE INSERT OR UPDATE OF "retentionExpiryRecordId" ON "MediaAsset"
FOR EACH ROW EXECUTE FUNCTION "guard_media_retention_expiry_binding"();

-- A delete claim must lock the retention ledger before it writes its durable
-- lease. The worker query follows the same order; this trigger is the database
-- authority for direct SQL and future callers.
CREATE OR REPLACE FUNCTION "guard_retention_media_delete_claim"()
RETURNS TRIGGER AS $$
DECLARE
  placement_pending BOOLEAN;
  active_hold BOOLEAN;
BEGIN
  IF NEW."retentionExpiryRecordId" IS NULL
     OR NEW."storageDeleteLeaseToken" IS NULL
     OR NEW."storageDeleteLeaseToken" IS NOT DISTINCT FROM OLD."storageDeleteLeaseToken" THEN
    RETURN NEW;
  END IF;

  PERFORM 1
  FROM "AccountDataRetentionRecord" AS record
  WHERE record."id" = NEW."retentionExpiryRecordId"
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'retention media delete claim lost its retention record'
      USING ERRCODE = '23503';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM "AccountDataRetentionLegalHoldAction" AS action
    WHERE action."retentionRecordId" = NEW."retentionExpiryRecordId"
      AND action."action" = 'placement'
      AND action."status" = 'pending'
  ) INTO placement_pending;
  SELECT EXISTS (
    SELECT 1
    FROM "AccountDataRetentionLegalHold" AS hold
    WHERE hold."retentionRecordId" = NEW."retentionExpiryRecordId"
      AND hold."releasedAt" IS NULL
  ) INTO active_hold;
  IF placement_pending OR active_hold THEN
    RAISE EXCEPTION 'retention media delete claim is blocked by a legal hold barrier'
      USING ERRCODE = '55000';
  END IF;
  UPDATE "AccountDataRetentionRecord" AS record
  SET "mediaDeletionClaimedAt" = COALESCE(
        record."mediaDeletionClaimedAt",
        CURRENT_TIMESTAMP
      ),
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE record."id" = NEW."retentionExpiryRecordId";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "MediaAsset_retention_delete_claim_guard"
BEFORE UPDATE OF "storageDeleteLeaseToken" ON "MediaAsset"
FOR EACH ROW EXECUTE FUNCTION "guard_retention_media_delete_claim"();

-- Placement is the opposite side of the same serialization boundary. A
-- committed lease or an outcome-unknown marker means bytes may already be
-- leaving storage, so the API must reject instead of claiming preservation.
CREATE OR REPLACE FUNCTION "guard_legal_hold_against_retention_media_delete"()
RETURNS TRIGGER AS $$
DECLARE
  destructive_media_exists BOOLEAN;
  media_deletion_claimed_at TIMESTAMP(3);
  retention_user_id TEXT;
  retention_category TEXT;
BEGIN
  IF NEW."action" <> 'placement'
     OR NEW."status" NOT IN ('pending', 'approved') THEN
    RETURN NEW;
  END IF;

  SELECT
    record."mediaDeletionClaimedAt",
    record."userId",
    record."category"
  INTO media_deletion_claimed_at, retention_user_id, retention_category
  FROM "AccountDataRetentionRecord" AS record
  WHERE record."id" = NEW."retentionRecordId"
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'legal hold action lost its retention record'
      USING ERRCODE = '23503';
  END IF;

  IF media_deletion_claimed_at IS NOT NULL THEN
    RAISE EXCEPTION 'retention media deletion was already claimed'
      USING ERRCODE = '55000';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM "MediaAsset" AS asset
    WHERE (
        asset."retentionExpiryRecordId" = NEW."retentionRecordId"
        OR (
          asset."retentionExpiryRecordId" IS NULL
          AND asset."uploaderId" = retention_user_id
          AND (
            (
              retention_category = 'support_disputes_safety'
              AND asset."purpose"::TEXT IN (
                'chatMessage',
                'orderSupportFact',
                'attendanceDisputeStatement',
                'companionIncidentReport'
              )
            )
            OR (
              retention_category = 'consent_rights_account_governance'
              AND asset."purpose"::TEXT IN (
                'userAccountAppeal',
                'companionAccountAppeal'
              )
            )
          )
        )
      )
      AND (
        asset."storageDeleteLeaseToken" IS NOT NULL
        OR asset."storageDeleteOutcomeUnknownAt" IS NOT NULL
        OR asset."storageDeletedAt" IS NOT NULL
      )
  ) INTO destructive_media_exists;

  IF destructive_media_exists THEN
    RAISE EXCEPTION 'retention media deletion is already in flight or outcome unknown'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RetentionLegalHoldAction_media_delete_guard"
BEFORE INSERT OR UPDATE OF "action", "status", "retentionRecordId"
ON "AccountDataRetentionLegalHoldAction"
FOR EACH ROW EXECUTE FUNCTION "guard_legal_hold_against_retention_media_delete"();
