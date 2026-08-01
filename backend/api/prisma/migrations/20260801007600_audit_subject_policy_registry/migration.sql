-- Re-run the bounded AuditLog subject-reference backfill with the complete,
-- centrally reviewed top-level action/key registry. A distinct state version
-- is required because controlled-v1 may already be complete in production.
INSERT INTO "AuditSubjectReferenceBackfillState" (
  "id", "version", "processedCount", "createdAt", "updatedAt"
) VALUES (
  'controlled-v2', 'controlled-v2', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
) ON CONFLICT ("version") DO NOTHING;

CREATE OR REPLACE FUNCTION "backfill_audit_subject_references_v2"(batch_size INTEGER DEFAULT 250)
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
  WHERE state."version" = 'controlled-v2'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'controlled-v2 audit subject backfill state is missing'
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
      ('account.data_rights_assignment_taken_over', 'userId', 'user'),
      ('account.data_rights_assignment_taken_over', 'previousHandlerId', 'user'),
      ('account.data_rights_claimed', 'userId', 'user'),
      ('account.data_rights_claimed', 'previousHandlerId', 'user'),
      ('account.data_rights_status_changed', 'userId', 'user'),
      ('account.invoice_status_changed', 'userId', 'user'),
      ('account.user_action_revoked', 'userId', 'user'),
      ('account.status_updated', 'userId', 'user'),
      ('account.user_action_created', 'userId', 'user'),
      ('account.user_action_appeal_claimed', 'userId', 'user'),
      ('account.user_action_appeal_assigned', 'userId', 'user'),
      ('account.user_action_appeal_assigned', 'previousAssignedToUserId', 'user'),
      ('account.user_action_appeal_assigned', 'assignedToUserId', 'user'),
      ('account.user_action_appeal_resolved', 'userId', 'user'),
      ('account.deletion_payment_synced', 'userId', 'user'),
      ('account.deletion_refund_synced', 'userId', 'user'),
      ('identity.verification_change_submitted', 'userId', 'user'),
      ('identity.verification_change_approved', 'userId', 'user'),
      ('identity.verification_change_approved', 'submittedById', 'user'),
      ('identity.verification_change_rejected', 'userId', 'user'),
      ('identity.verification_change_rejected', 'submittedById', 'user'),
      ('admin.staff_credential_suspended', 'targetUserId', 'user'),
      ('admin.staff_credential_suspended', 'replacementUserId', 'user'),
      ('attendance.case_created', 'openedByUserId', 'user'),
      ('attendance.case_created', 'counterpartyUserId', 'user'),
      ('attendance.evidence_completed', 'openedByUserId', 'user'),
      ('attendance.evidence_completed', 'counterpartyUserId', 'user'),
      ('attendance.statement_submitted', 'openedByUserId', 'user'),
      ('attendance.statement_submitted', 'counterpartyUserId', 'user'),
      ('attendance.case_appealed', 'openedByUserId', 'user'),
      ('attendance.case_appealed', 'counterpartyUserId', 'user'),
      ('attendance.case_claimed', 'openedByUserId', 'user'),
      ('attendance.case_claimed', 'counterpartyUserId', 'user'),
      ('attendance.case_decided', 'openedByUserId', 'user'),
      ('attendance.case_decided', 'counterpartyUserId', 'user'),
      ('attendance.appeal_claimed', 'initialReviewerId', 'user'),
      ('attendance.appeal_claimed', 'openedByUserId', 'user'),
      ('attendance.appeal_claimed', 'counterpartyUserId', 'user'),
      ('attendance.case_finalized', 'openedByUserId', 'user'),
      ('attendance.case_finalized', 'counterpartyUserId', 'user'),
      ('attendance.case_finalized', 'initialReviewerId', 'user'),
      ('attendance.refund_workflow_started', 'openedByUserId', 'user'),
      ('attendance.refund_workflow_started', 'counterpartyUserId', 'user'),
      ('refund.requested', 'requestedForUserId', 'user'),
      ('refund.requested', 'companionId', 'companion'),
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
      ('commercial.companion_profile_verified', 'submittedById', 'user'),
      ('commercial.companion_profile_suspended', 'companionId', 'companion'),
      ('commercial.earning_payout_claimed', 'companionId', 'companion'),
      ('commercial.earning_payout_claim_cancelled', 'companionId', 'companion'),
      ('commercial.earning_payout_evidence_held_outcome_unknown', 'companionId', 'companion'),
      ('commercial.earning_payout_evidence_held_for_concurrent_dispute', 'companionId', 'companion'),
      ('commercial.earning_payout_evidence_recorded', 'companionId', 'companion'),
      ('commercial.earning_payout_verification_blocked_outcome_unknown', 'companionId', 'companion'),
      ('commercial.earning_payout_verification_blocked_by_concurrent_dispute', 'companionId', 'companion'),
      ('commercial.earning_payout_verified', 'companionId', 'companion'),
      ('commercial.earning_payout_verified', 'submittedById', 'user'),
      ('commercial.recovery_evidence_recorded', 'companionId', 'companion'),
      ('commercial.recovery_verified', 'companionId', 'companion'),
      ('commercial.recovery_verified', 'evidenceSubmittedById', 'user'),
      ('moderation.chat_restriction_created', 'userId', 'user'),
      ('moderation.manual_escalation_required', 'userId', 'user'),
      ('order.created', 'companionId', 'companion'),
      ('payment_dispute.assigned', 'assignedSupportUserId', 'user'),
      ('account.deletion_refund_initiated', 'userId', 'user'),
      ('account.deletion_refund_initiated', 'companionId', 'companion'),
      ('support.refund_initiated', 'userId', 'user'),
      ('support.refund_initiated', 'companionId', 'companion'),
      ('attendance.refund_requested', 'userId', 'user'),
      ('attendance.refund_requested', 'companionId', 'companion'),
      ('refund.approved', 'userId', 'user'),
      ('refund.approved', 'companionId', 'companion'),
      ('refund.claimed', 'userId', 'user'),
      ('refund.claimed', 'companionId', 'companion'),
      ('refund.rejected', 'userId', 'user'),
      ('refund.rejected', 'companionId', 'companion'),
      ('refund.retry_requested', 'userId', 'user'),
      ('refund.retry_requested', 'companionId', 'companion'),
      ('refund.provider_sync_requested', 'userId', 'user'),
      ('refund.provider_sync_requested', 'companionId', 'companion'),
      ('payment.fulfilled', 'userId', 'user'),
      ('payment.fulfilled', 'companionId', 'companion'),
      ('refund.succeeded', 'userId', 'user'),
      ('refund.succeeded', 'companionId', 'companion'),
      ('support.order_fact_added', 'submittedByUserId', 'user'),
      ('support.ticket_assigned', 'previousAssignedToUserId', 'user'),
      ('support.ticket_assigned', 'assignedToUserId', 'user'),
      ('customer.adult_eligibility_marked_adult', 'userId', 'user'),
      ('customer.adult_eligibility_marked_adult', 'submittedById', 'user'),
      ('customer.adult_eligibility_marked_ineligible', 'userId', 'user'),
      ('customer.adult_eligibility_marked_ineligible', 'submittedById', 'user'),
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
      'audit-subject-v2-' || md5("auditLogId" || ':' || "subjectUserId"),
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
    WHERE state."version" = 'controlled-v2'
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
