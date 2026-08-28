-- controlled-v3 composes the immutable controlled-v2 registry with the exact
-- post-v2 action/key additions introduced by the 2026-08-25 release. The v3
-- worker drains v2 first, then scans the full AuditLog once for only this delta.
INSERT INTO "AuditSubjectReferenceBackfillState" (
  "id", "version", "processedCount", "createdAt", "updatedAt"
) VALUES (
  'controlled-v3', 'controlled-v3', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
) ON CONFLICT ("version") DO NOTHING;

CREATE OR REPLACE FUNCTION "backfill_audit_subject_references_v3"(batch_size INTEGER DEFAULT 250)
RETURNS TABLE (
  "processed" INTEGER,
  "referencesTouched" INTEGER,
  "completed" BOOLEAN
) AS $$
DECLARE
  state_row "AuditSubjectReferenceBackfillState"%ROWTYPE;
  v2_state "AuditSubjectReferenceBackfillState"%ROWTYPE;
  v2_result RECORD;
  bounded_batch_size INTEGER := LEAST(GREATEST(COALESCE(batch_size, 250), 1), 250);
BEGIN
  SELECT state.*
  INTO v2_state
  FROM "AuditSubjectReferenceBackfillState" state
  WHERE state."version" = 'controlled-v2';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'controlled-v2 audit subject backfill state is missing'
      USING ERRCODE = '23514';
  END IF;

  -- One call performs at most one bounded batch. Even when the final v2 batch
  -- completes, v3 delta work starts on the next invocation.
  IF v2_state."completedAt" IS NULL THEN
    SELECT result.*
    INTO v2_result
    FROM "backfill_audit_subject_references_v2"(bounded_batch_size) result;
    RETURN QUERY SELECT
      COALESCE(v2_result."processed", 0)::INTEGER,
      COALESCE(v2_result."referencesTouched", 0)::INTEGER,
      FALSE;
    RETURN;
  END IF;

  SELECT state.*
  INTO state_row
  FROM "AuditSubjectReferenceBackfillState" state
  WHERE state."version" = 'controlled-v3'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'controlled-v3 audit subject backfill state is missing'
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
      ('commercial.companion_action_reactivation_completed', 'companionId', 'companion'),
      ('commercial.companion_suspension_expiry_reactivation_required', 'companionId', 'companion'),
      ('commercial.companion_incident_claimed', 'companionId', 'companion'),
      ('commercial.companion_incident_claimed', 'assignedToUserId', 'user'),
      ('commercial.companion_incident_assigned', 'companionId', 'companion'),
      ('commercial.companion_incident_assigned', 'previousAssignedToUserId', 'user'),
      ('commercial.companion_incident_assigned', 'assignedToUserId', 'user'),
      ('favorite.availability_reminder_enabled', 'companionId', 'companion'),
      ('favorite.availability_reminder_disabled', 'companionId', 'companion')
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
      'audit-subject-v3-' || md5("auditLogId" || ':' || "subjectUserId"),
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
    WHERE state."version" = 'controlled-v3'
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

-- Full post-v2 delta registry pinned for static parity checks.
-- AUDIT_SUBJECT_POLICY_EXTENSION|commercial.companion_action_reactivation_completed|companionId|companion
-- AUDIT_SUBJECT_POLICY_EXTENSION|commercial.companion_suspension_expiry_reactivation_required|companionId|companion
-- AUDIT_SUBJECT_POLICY_EXTENSION|commercial.companion_incident_claimed|companionId|companion
-- AUDIT_SUBJECT_POLICY_EXTENSION|commercial.companion_incident_claimed|assignedToUserId|user
-- AUDIT_SUBJECT_POLICY_EXTENSION|commercial.companion_incident_assigned|companionId|companion
-- AUDIT_SUBJECT_POLICY_EXTENSION|commercial.companion_incident_assigned|previousAssignedToUserId|user
-- AUDIT_SUBJECT_POLICY_EXTENSION|commercial.companion_incident_assigned|assignedToUserId|user
-- AUDIT_SUBJECT_POLICY_EXTENSION|favorite.availability_reminder_enabled|companionId|companion
-- AUDIT_SUBJECT_POLICY_EXTENSION|favorite.availability_reminder_disabled|companionId|companion
