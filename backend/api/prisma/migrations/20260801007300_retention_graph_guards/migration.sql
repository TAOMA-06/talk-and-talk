-- Backfill and then guard the O(1) companion rating projection. The database
-- trigger is the only projection writer, including for future direct SQL and
-- bounded account-deletion Review deletes.
ALTER TABLE "Review"
ADD CONSTRAINT "Review_rating_check"
CHECK ("rating" BETWEEN 1 AND 5) NOT VALID;
ALTER TABLE "Review" VALIDATE CONSTRAINT "Review_rating_check";

WITH aggregates AS (
  SELECT
    "companionId",
    COUNT(*)::INTEGER AS "reviewCount",
    COALESCE(SUM("rating"), 0)::INTEGER AS "ratingSum"
  FROM "Review"
  GROUP BY "companionId"
), projection AS (
  SELECT
    profile."id",
    COALESCE(aggregates."reviewCount", 0) AS "reviewCount",
    COALESCE(aggregates."ratingSum", 0) AS "ratingSum"
  FROM "CompanionProfile" profile
  LEFT JOIN aggregates ON aggregates."companionId" = profile."id"
)
UPDATE "CompanionProfile" profile
SET
  "reviewCount" = projection."reviewCount",
  "ratingSum" = projection."ratingSum",
  "rating" = CASE
    WHEN projection."reviewCount" = 0 THEN 0
    ELSE projection."ratingSum"::DOUBLE PRECISION / projection."reviewCount"
  END,
  "updatedAt" = CURRENT_TIMESTAMP
FROM projection
WHERE profile."id" = projection."id";

ALTER TABLE "CompanionProfile"
ADD CONSTRAINT "CompanionProfile_rating_projection_check"
CHECK (
  "reviewCount" >= 0
  AND "ratingSum" >= 0
  AND "rating" <> 'NaN'::DOUBLE PRECISION
  AND "rating" <> 'Infinity'::DOUBLE PRECISION
  AND "rating" <> '-Infinity'::DOUBLE PRECISION
  AND (
    ("reviewCount" = 0 AND "ratingSum" = 0 AND "rating" = 0)
    OR (
      "reviewCount" > 0
      AND "ratingSum" BETWEEN "reviewCount" AND 5 * "reviewCount"
      AND abs(
        "rating" - "ratingSum"::DOUBLE PRECISION / "reviewCount"
      ) <= 0.000000000001
    )
  )
) NOT VALID;
ALTER TABLE "CompanionProfile"
VALIDATE CONSTRAINT "CompanionProfile_rating_projection_check";

CREATE OR REPLACE FUNCTION "apply_review_insert_projection"()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM profile."id"
  FROM "CompanionProfile" profile
  WHERE profile."id" IN (SELECT DISTINCT "companionId" FROM new_reviews)
  ORDER BY profile."id"
  FOR UPDATE;

  WITH delta AS (
    SELECT
      "companionId",
      SUM("rating")::INTEGER AS "ratingDelta",
      COUNT(*)::INTEGER AS "countDelta"
    FROM new_reviews
    GROUP BY "companionId"
  )
  UPDATE "CompanionProfile" profile
  SET
    "ratingSum" = profile."ratingSum" + delta."ratingDelta",
    "reviewCount" = profile."reviewCount" + delta."countDelta",
    "rating" = (profile."ratingSum" + delta."ratingDelta")::DOUBLE PRECISION
      / (profile."reviewCount" + delta."countDelta"),
    "updatedAt" = CURRENT_TIMESTAMP
  FROM delta
  WHERE profile."id" = delta."companionId";
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "apply_review_delete_projection"()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM profile."id"
  FROM "CompanionProfile" profile
  WHERE profile."id" IN (SELECT DISTINCT "companionId" FROM old_reviews)
  ORDER BY profile."id"
  FOR UPDATE;

  WITH delta AS (
    SELECT
      "companionId",
      SUM("rating")::INTEGER AS "ratingDelta",
      COUNT(*)::INTEGER AS "countDelta"
    FROM old_reviews
    GROUP BY "companionId"
  )
  UPDATE "CompanionProfile" profile
  SET
    "ratingSum" = profile."ratingSum" - delta."ratingDelta",
    "reviewCount" = profile."reviewCount" - delta."countDelta",
    "rating" = CASE
      WHEN profile."reviewCount" - delta."countDelta" = 0 THEN 0
      ELSE (profile."ratingSum" - delta."ratingDelta")::DOUBLE PRECISION
        / (profile."reviewCount" - delta."countDelta")
    END,
    "updatedAt" = CURRENT_TIMESTAMP
  FROM delta
  WHERE profile."id" = delta."companionId";
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "apply_review_update_projection"()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM profile."id"
  FROM "CompanionProfile" profile
  WHERE profile."id" IN (
    SELECT "companionId" FROM old_reviews
    UNION
    SELECT "companionId" FROM new_reviews
  )
  ORDER BY profile."id"
  FOR UPDATE;

  WITH changes AS (
    SELECT
      "companionId",
      SUM("rating")::INTEGER AS "ratingDelta",
      COUNT(*)::INTEGER AS "countDelta"
    FROM new_reviews
    GROUP BY "companionId"
    UNION ALL
    SELECT
      "companionId",
      -SUM("rating")::INTEGER AS "ratingDelta",
      -COUNT(*)::INTEGER AS "countDelta"
    FROM old_reviews
    GROUP BY "companionId"
  ), delta AS (
    SELECT
      "companionId",
      SUM("ratingDelta")::INTEGER AS "ratingDelta",
      SUM("countDelta")::INTEGER AS "countDelta"
    FROM changes
    GROUP BY "companionId"
  )
  UPDATE "CompanionProfile" profile
  SET
    "ratingSum" = profile."ratingSum" + delta."ratingDelta",
    "reviewCount" = profile."reviewCount" + delta."countDelta",
    "rating" = CASE
      WHEN profile."reviewCount" + delta."countDelta" = 0 THEN 0
      ELSE (profile."ratingSum" + delta."ratingDelta")::DOUBLE PRECISION
        / (profile."reviewCount" + delta."countDelta")
    END,
    "updatedAt" = CURRENT_TIMESTAMP
  FROM delta
  WHERE profile."id" = delta."companionId";
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Review_projection_after_insert"
AFTER INSERT ON "Review"
REFERENCING NEW TABLE AS new_reviews
FOR EACH STATEMENT
EXECUTE FUNCTION "apply_review_insert_projection"();

CREATE TRIGGER "Review_projection_after_delete"
AFTER DELETE ON "Review"
REFERENCING OLD TABLE AS old_reviews
FOR EACH STATEMENT
EXECUTE FUNCTION "apply_review_delete_projection"();

CREATE TRIGGER "Review_projection_after_update"
AFTER UPDATE ON "Review"
REFERENCING OLD TABLE AS old_reviews NEW TABLE AS new_reviews
FOR EACH STATEMENT
EXECUTE FUNCTION "apply_review_update_projection"();

-- Existing expired rows were finalized by the legacy delete-then-status
-- worker. Seal that historical terminal state before enforcing equivalence.
UPDATE "MediaAsset"
SET
  "storageDeleteRequestedAt" = LEAST(COALESCE("expiresAt", "updatedAt"), "updatedAt"),
  "storageDeletedAt" = "updatedAt",
  "storageDeleteAttemptCount" = GREATEST("storageDeleteAttemptCount", 1),
  "storageDeleteNextAttemptAt" = NULL,
  "storageDeleteLastErrorCode" = NULL,
  "storageDeleteLeaseToken" = NULL,
  "storageDeleteLeaseExpiresAt" = NULL
WHERE "status"::TEXT = 'expired'
  AND "storageDeletedAt" IS NULL;

ALTER TABLE "MediaAsset"
ADD CONSTRAINT "MediaAsset_storage_delete_attempt_check"
CHECK ("storageDeleteAttemptCount" >= 0),
ADD CONSTRAINT "MediaAsset_storage_delete_lease_check"
CHECK (("storageDeleteLeaseToken" IS NULL) = ("storageDeleteLeaseExpiresAt" IS NULL)),
ADD CONSTRAINT "MediaAsset_storage_delete_terminal_check"
CHECK (
  ("status"::TEXT = 'expired') = ("storageDeletedAt" IS NOT NULL)
  AND (
    "storageDeletedAt" IS NULL
    OR (
      "storageDeleteRequestedAt" IS NOT NULL
      AND "storageDeleteRequestedAt" <= "storageDeletedAt"
      AND "storageDeleteLeaseToken" IS NULL
      AND "storageDeleteLeaseExpiresAt" IS NULL
      AND "storageDeleteNextAttemptAt" IS NULL
      AND "storageDeleteLastErrorCode" IS NULL
    )
  )
),
ADD CONSTRAINT "MediaAsset_storage_delete_retry_check"
CHECK ("storageDeleteNextAttemptAt" IS NULL OR "storageDeletedAt" IS NULL);

-- Subject edges may be detached only after the bilateral case is terminal.
-- Live evidence collection and appeal flows must retain both participants.
ALTER TABLE "AttendanceDispute"
ADD CONSTRAINT "AttendanceDispute_live_participants_check"
CHECK (
  "status"::TEXT = 'final'
  OR ("openedByUserId" IS NOT NULL AND "counterpartyUserId" IS NOT NULL)
) NOT VALID;
ALTER TABLE "AttendanceDispute"
VALIDATE CONSTRAINT "AttendanceDispute_live_participants_check";

ALTER TABLE "OrderRescheduleRequest"
ADD CONSTRAINT "OrderRescheduleRequest_pending_requester_check"
CHECK ("status"::TEXT <> 'pending' OR "requestedByUserId" IS NOT NULL) NOT VALID;
ALTER TABLE "OrderRescheduleRequest"
VALIDATE CONSTRAINT "OrderRescheduleRequest_pending_requester_check";

-- The execution-phase allowlist is a database-level state-machine boundary.
-- Replace the original constraint so newly introduced dependency-detach phases
-- cannot be rejected after the worker has already committed the prior phase.
ALTER TABLE "AccountDeletionRequest"
DROP CONSTRAINT "AccountDeletionRequest_execution_phase_check";
ALTER TABLE "AccountDeletionRequest"
ADD CONSTRAINT "AccountDeletionRequest_execution_phase_check"
CHECK ("executionPhase" IN (
  'awaiting_second_review',
  'pending_customer_adult_eligibility',
  'notification_delivery',
  'notification',
  'subscription_grant',
  'recommendation_impression',
  'recommendation_request',
  'recommendation_tag',
  'recommendation_preference',
  'recommendation_exclusion',
  'availability_reminder_candidate',
  'availability_reminder_fanout_job',
  'companion_favorite',
  'companion_recent_view',
  'message_read_state',
  'conversation_notification_preference',
  'conversation_block',
  'refresh_token',
  'verification_code',
  'auth_identity',
  'staff_credential',
  'user_profile',
  'companion_availability_deactivate',
  'companion_availability_window',
  'recurring_window_detach',
  'companion_recurring_rule',
  'companion_blackout',
  'companion_recommendation_policy',
  'community_like',
  'community_report',
  'authored_post_like',
  'authored_post_report',
  'community_post',
  'review',
  'rating_refresh',
  'order_service_offering_detach',
  'companion_offering',
  'companion_service_tag',
  'companion_profile',
  'media_retention',
  'retained_transactions_snapshot',
  'retained_safety_snapshot',
  'retained_governance_snapshot',
  'final_verification',
  'completed'
)) NOT VALID;
ALTER TABLE "AccountDeletionRequest"
VALIDATE CONSTRAINT "AccountDeletionRequest_execution_phase_check";

-- Explicit retained-snapshot cursors are queryable and machine-checkable;
-- opaque phase strings cannot silently masquerade as completed evidence.
ALTER TABLE "AccountDeletionRetentionSnapshotProgress"
ADD CONSTRAINT "RetentionSnapshotProgress_category_check"
CHECK ("category" IN (
  'transactions_tax_invoices',
  'support_disputes_safety',
  'consent_rights_account_governance'
)),
ADD CONSTRAINT "RetentionSnapshotProgress_source_key_check"
CHECK ("sourceKey" ~ '^[a-z][a-z0-9_]{0,95}$'),
ADD CONSTRAINT "RetentionSnapshotProgress_cursor_pair_check"
CHECK (("cursorCreatedAt" IS NULL) = ("cursorId" IS NULL)),
ADD CONSTRAINT "RetentionSnapshotProgress_count_check"
CHECK ("observedCount" >= 0),
ADD CONSTRAINT "RetentionSnapshotProgress_high_water_check"
CHECK (
  ("cursorCreatedAt" IS NULL OR "cursorCreatedAt" <= "highWaterAt")
  AND ("completedAt" IS NULL OR "completedAt" >= "highWaterAt")
);

CREATE OR REPLACE FUNCTION "guard_retention_snapshot_progress"()
RETURNS TRIGGER AS $$
DECLARE
  approved_at TIMESTAMP(3);
BEGIN
  SELECT request."approvedAt"
  INTO approved_at
  FROM "AccountDeletionRequest" request
  WHERE request."id" = NEW."deletionRequestId";

  IF approved_at IS NULL OR NEW."highWaterAt" IS DISTINCT FROM approved_at THEN
    RAISE EXCEPTION 'retention snapshot high-water must equal deletion approval time'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW."deletionRequestId" IS DISTINCT FROM OLD."deletionRequestId"
      OR NEW."category" IS DISTINCT FROM OLD."category"
      OR NEW."sourceKey" IS DISTINCT FROM OLD."sourceKey"
      OR NEW."highWaterAt" IS DISTINCT FROM OLD."highWaterAt"
      OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    THEN
      RAISE EXCEPTION 'retention snapshot provenance is immutable'
        USING ERRCODE = '23514';
    END IF;

    IF NEW."observedCount" < OLD."observedCount"
      OR (
        OLD."cursorCreatedAt" IS NOT NULL
        AND NEW."cursorCreatedAt" IS NOT NULL
        AND (NEW."cursorCreatedAt", NEW."cursorId") < (OLD."cursorCreatedAt", OLD."cursorId")
      )
    THEN
      RAISE EXCEPTION 'retention snapshot progress cannot move backwards'
        USING ERRCODE = '23514';
    END IF;

    IF OLD."completedAt" IS NOT NULL AND (
      NEW."cursorCreatedAt" IS DISTINCT FROM OLD."cursorCreatedAt"
      OR NEW."cursorId" IS DISTINCT FROM OLD."cursorId"
      OR NEW."observedCount" IS DISTINCT FROM OLD."observedCount"
      OR NEW."completedAt" IS DISTINCT FROM OLD."completedAt"
    ) THEN
      RAISE EXCEPTION 'completed retention snapshot progress is immutable'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RetentionSnapshotProgress_guard"
BEFORE INSERT OR UPDATE ON "AccountDeletionRetentionSnapshotProgress"
FOR EACH ROW
EXECUTE FUNCTION "guard_retention_snapshot_progress"();

ALTER TABLE "AuditSubjectReference"
ADD CONSTRAINT "AuditSubjectReference_relation_kind_check"
CHECK ("relationKind" IN ('actor', 'subject', 'actorAndSubject'));

ALTER TABLE "AuditSubjectReferenceBackfillState"
ADD CONSTRAINT "AuditSubjectBackfill_cursor_pair_check"
CHECK (("cursorCreatedAt" IS NULL) = ("cursorId" IS NULL)),
ADD CONSTRAINT "AuditSubjectBackfill_processed_count_check"
CHECK ("processedCount" >= 0),
ADD CONSTRAINT "AuditSubjectBackfill_version_check"
CHECK ("version" ~ '^[a-z][a-z0-9._-]{0,63}$');

INSERT INTO "AuditSubjectReferenceBackfillState" (
  "id", "version", "processedCount", "createdAt", "updatedAt"
) VALUES (
  'controlled-v1', 'controlled-v1', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
) ON CONFLICT ("version") DO NOTHING;

-- Process at most 250 AuditLog rows per transaction in stable
-- (createdAt,id) order. Only the exact action/key registry below may produce a
-- business-subject edge; arbitrary or nested JSON is never scanned.
CREATE OR REPLACE FUNCTION "backfill_audit_subject_references_v1"(batch_size INTEGER DEFAULT 250)
RETURNS TABLE (
  "processed" INTEGER,
  "referencesTouched" INTEGER,
  "completed" BOOLEAN
) AS $$
DECLARE
  state_row "AuditSubjectReferenceBackfillState"%ROWTYPE;
  bounded_batch_size INTEGER := LEAST(GREATEST(COALESCE(batch_size, 250), 1), 250);
BEGIN
  SELECT state.*
  INTO state_row
  FROM "AuditSubjectReferenceBackfillState" state
  WHERE state."version" = 'controlled-v1'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'controlled audit subject backfill state is missing'
      USING ERRCODE = '23514';
  END IF;

  IF state_row."completedAt" IS NOT NULL THEN
    RETURN QUERY SELECT 0, 0, TRUE;
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidates AS MATERIALIZED (
    SELECT log."id", log."actorId", log."action", log."metadata", log."createdAt"
    FROM "AuditLog" log
    WHERE state_row."cursorCreatedAt" IS NULL
      OR (log."createdAt", log."id") > (state_row."cursorCreatedAt", state_row."cursorId")
    ORDER BY log."createdAt", log."id"
    LIMIT bounded_batch_size
  ), controlled_rules("action", "metadataKey", "identifierKind") AS (
    VALUES
      ('account.deletion_requested', 'userId', 'user'),
      ('account.deletion_cancelled', 'userId', 'user'),
      ('account.deletion_cancelled', 'companionId', 'companion'),
      ('account.deletion_processing_started', 'userId', 'user'),
      ('account.deletion_execution_queued', 'userId', 'user'),
      ('account.deletion_execution_queued', 'companionId', 'companion'),
      ('account.deletion_execution_retry_queued', 'userId', 'user'),
      ('account.deletion_completed', 'userId', 'user'),
      ('identity.verification_change_submitted', 'userId', 'user'),
      ('identity.verification_change_approved', 'userId', 'user'),
      ('identity.verification_change_rejected', 'userId', 'user'),
      ('admin.staff_credential_suspended', 'targetUserId', 'user'),
      ('refund.requested', 'requestedForUserId', 'user'),
      ('favorite.companion_saved', 'companionId', 'companion'),
      ('favorite.companion_removed', 'companionId', 'companion'),
      ('companion.create', 'companionId', 'companion'),
      ('companion.update', 'companionId', 'companion'),
      ('companion.publish', 'companionId', 'companion'),
      ('companion.unpublish', 'companionId', 'companion'),
      ('commercial.companion_training_attempted', 'companionId', 'companion'),
      ('commercial.companion_action_appealed', 'companionId', 'companion'),
      ('commercial.companion_incident_created', 'companionId', 'companion'),
      ('commercial.companion_withdrawal_requested', 'companionId', 'companion'),
      ('commercial.companion_withdrawal_cancelled', 'companionId', 'companion'),
      ('commercial.companion_account_action_created', 'companionId', 'companion'),
      ('commercial.companion_action_appeal_resolved', 'companionId', 'companion'),
      ('commercial.companion_voice_intro_read_issued', 'companionId', 'companion'),
      ('commercial.companion_voice_intro_reviewed', 'companionId', 'companion'),
      ('commercial.companion_incident_updated', 'companionId', 'companion'),
      ('commercial.companion_withdrawal_updated', 'companionId', 'companion'),
      ('commercial.companion_profile_submitted', 'companionId', 'companion'),
      ('commercial.companion_profile_verified', 'companionId', 'companion'),
      ('commercial.companion_profile_suspended', 'companionId', 'companion'),
      ('commercial.earning_payout_claimed', 'companionId', 'companion'),
      ('commercial.earning_payout_claim_cancelled', 'companionId', 'companion'),
      ('commercial.earning_payout_evidence_held_outcome_unknown', 'companionId', 'companion'),
      ('commercial.earning_payout_evidence_held_for_concurrent_dispute', 'companionId', 'companion'),
      ('commercial.earning_payout_evidence_recorded', 'companionId', 'companion'),
      ('commercial.earning_payout_verification_blocked_outcome_unknown', 'companionId', 'companion'),
      ('commercial.earning_payout_verification_blocked_by_concurrent_dispute', 'companionId', 'companion'),
      ('commercial.earning_payout_verified', 'companionId', 'companion'),
      ('commercial.recovery_evidence_recorded', 'companionId', 'companion'),
      ('commercial.recovery_verified', 'companionId', 'companion'),
      ('recommendation.policy.update', 'companionId', 'companion')
  ), subject_candidates AS (
    SELECT
      candidate."id" AS "auditLogId",
      actor."id" AS "subjectUserId",
      'actor'::TEXT AS "source"
    FROM candidates candidate
    JOIN "User" actor ON actor."id" = candidate."actorId"

    UNION ALL

    SELECT
      candidate."id" AS "auditLogId",
      CASE
        WHEN rule."identifierKind" = 'user' THEN subject_user."id"
        ELSE companion."ownerUserId"
      END AS "subjectUserId",
      'subject'::TEXT AS "source"
    FROM candidates candidate
    JOIN controlled_rules rule ON rule."action" = candidate."action"
    LEFT JOIN "User" subject_user
      ON rule."identifierKind" = 'user'
     AND subject_user."id" = candidate."metadata" ->> rule."metadataKey"
    LEFT JOIN "CompanionProfile" companion
      ON rule."identifierKind" = 'companion'
     AND companion."id" = candidate."metadata" ->> rule."metadataKey"
    WHERE CASE
      WHEN rule."identifierKind" = 'user' THEN subject_user."id"
      ELSE companion."ownerUserId"
    END IS NOT NULL
  ), collapsed AS (
    SELECT
      "auditLogId",
      "subjectUserId",
      CASE
        WHEN bool_or("source" = 'actor') AND bool_or("source" = 'subject') THEN 'actorAndSubject'
        WHEN bool_or("source" = 'actor') THEN 'actor'
        ELSE 'subject'
      END AS "relationKind"
    FROM subject_candidates
    GROUP BY "auditLogId", "subjectUserId"
  ), upserted AS (
    INSERT INTO "AuditSubjectReference" (
      "id", "auditLogId", "subjectUserId", "relationKind", "createdAt"
    )
    SELECT
      'audit-subject-v1-' || md5("auditLogId" || ':' || "subjectUserId"),
      "auditLogId",
      "subjectUserId",
      "relationKind",
      CURRENT_TIMESTAMP
    FROM collapsed
    ON CONFLICT ("auditLogId", "subjectUserId") DO UPDATE
    SET "relationKind" = CASE
      WHEN "AuditSubjectReference"."relationKind" = EXCLUDED."relationKind"
        THEN "AuditSubjectReference"."relationKind"
      WHEN "AuditSubjectReference"."relationKind" = 'actorAndSubject'
        OR EXCLUDED."relationKind" = 'actorAndSubject'
        THEN 'actorAndSubject'
      ELSE 'actorAndSubject'
    END
    RETURNING 1
  ), boundary AS (
    SELECT
      COUNT(*)::INTEGER AS "batchProcessed",
      (array_agg("createdAt" ORDER BY "createdAt" DESC, "id" DESC))[1] AS "lastCreatedAt",
      (array_agg("id" ORDER BY "createdAt" DESC, "id" DESC))[1] AS "lastId"
    FROM candidates
  ), touched AS (
    SELECT COUNT(*)::INTEGER AS "referencesTouched" FROM upserted
  ), advanced AS (
    UPDATE "AuditSubjectReferenceBackfillState" state
    SET
      "cursorCreatedAt" = COALESCE(boundary."lastCreatedAt", state."cursorCreatedAt"),
      "cursorId" = COALESCE(boundary."lastId", state."cursorId"),
      "processedCount" = state."processedCount" + boundary."batchProcessed",
      "completedAt" = CASE
        WHEN boundary."batchProcessed" < bounded_batch_size THEN CURRENT_TIMESTAMP
        ELSE NULL
      END,
      "lastErrorCode" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP
    FROM boundary, touched
    WHERE state."version" = 'controlled-v1'
    RETURNING
      boundary."batchProcessed",
      touched."referencesTouched",
      state."completedAt" IS NOT NULL AS "completed"
  )
  SELECT
    advanced."batchProcessed",
    advanced."referencesTouched",
    advanced."completed"
  FROM advanced;
END;
$$ LANGUAGE plpgsql;
