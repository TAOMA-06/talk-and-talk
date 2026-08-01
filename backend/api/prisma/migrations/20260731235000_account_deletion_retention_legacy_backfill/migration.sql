-- A legacy completed deletion may predate the retention ledger. Preserve it as
-- restricted evidence, but do not claim legal approval that a SQL migration
-- cannot prove. The application may later promote the records only with its
-- externally configured approval reference.

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

CREATE OR REPLACE FUNCTION ensure_completed_account_deletion_retention_ledger(
  p_request_id TEXT,
  p_policy_approval_reference TEXT DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  v_user_id TEXT;
  v_user_role TEXT;
  v_companion_id TEXT;
  v_completed_at TIMESTAMP;
  v_completed_at_was_missing BOOLEAN;
  v_approval_reference TEXT := NULLIF(btrim(p_policy_approval_reference), '');
  v_approval_status TEXT;
  v_record_count INTEGER;
BEGIN
  SELECT request."userId"
  INTO v_user_id
  FROM "AccountDeletionRequest" AS request
  WHERE request."id" = p_request_id
    AND request."status" = 'completed';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'completed account deletion request not found for retention backfill'
      USING ERRCODE = '23514';
  END IF;

  -- Match the application deletion workflow: User -> AccountDeletionRequest.
  -- This also serializes two idempotent repair calls for the same subject.
  PERFORM 1
  FROM "User"
  WHERE "id" = v_user_id
  FOR UPDATE;

  SELECT
    request."userId",
    subject."role"::TEXT,
    (
      SELECT companion."id"
      FROM "CompanionProfile" AS companion
      WHERE companion."ownerUserId" = request."userId"
      ORDER BY companion."id"
      LIMIT 1
    ),
    COALESCE(request."completedAt", request."updatedAt", request."createdAt", CURRENT_TIMESTAMP),
    request."completedAt" IS NULL
  INTO
    v_user_id,
    v_user_role,
    v_companion_id,
    v_completed_at,
    v_completed_at_was_missing
  FROM "AccountDeletionRequest" AS request
  JOIN "User" AS subject ON subject."id" = request."userId"
  WHERE request."id" = p_request_id
    AND request."status" = 'completed'
  FOR UPDATE OF request;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'completed account deletion request not found for retention backfill'
      USING ERRCODE = '23514';
  END IF;

  v_approval_status := CASE
    WHEN v_approval_reference IS NULL THEN 'pendingLegalApproval'
    ELSE 'approved'
  END;

  UPDATE "User"
  SET
    "dataProcessingRestrictedAt" = COALESCE("dataProcessingRestrictedAt", v_completed_at),
    "deletionCompletedAt" = COALESCE("deletionCompletedAt", v_completed_at)
  WHERE "id" = v_user_id;

  INSERT INTO "AccountDataRetentionRecord" (
    "id",
    "deletionRequestId",
    "userId",
    "category",
    "disposition",
    "legalBasisCode",
    "policyVersion",
    "policyApprovalStatus",
    "policyApprovalReference",
    "recordCount",
    "processingRestrictedAt",
    "retentionEndsAt",
    "expiryProcessedAt",
    "details",
    "createdAt",
    "updatedAt"
  )
  SELECT
    'legacy-retention-' || md5(p_request_id || ':' || category.code),
    p_request_id,
    v_user_id,
    category.code,
    category.disposition,
    category.legal_basis_code,
    '2026.2-technical-baseline',
    v_approval_status,
    v_approval_reference,
    0,
    v_completed_at,
    CASE
      WHEN category.disposition = 'deleted' THEN v_completed_at
      ELSE v_completed_at + make_interval(days => category.retention_days)
    END,
    CASE WHEN category.disposition = 'deleted' THEN v_completed_at ELSE NULL END,
    jsonb_strip_nulls(jsonb_build_object(
      'description', category.description,
      'subjectRole', v_user_role,
      'companionId', v_companion_id,
      'legacyBackfill', TRUE,
      'completedAtWasMissing', v_completed_at_was_missing,
      'recordCountSemantics', 'legacy_not_observed_at_completion',
      'requiresExplicitPolicyApproval', v_approval_reference IS NULL
    )),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  FROM (VALUES
    ('identity_authentication_profile', 'deleted', 0, 'deletion_request_fulfilment',
      'Consumer login identities, refresh sessions and direct customer/companion profile fields; workforce credentials require separate offboarding'),
    ('preferences_behavior_notifications', 'deleted', 0, 'purpose_ended',
      'Recommendations, favorites, recent views, notification grants, conversation controls and purpose-ended companion schedules'),
    ('public_user_content', 'deleted', 0, 'purpose_ended',
      'Community posts, likes, report receipts, public reviews and companion marketplace listings'),
    ('transactions_tax_invoices', 'retainedRestricted', 3650, 'statutory_financial_recordkeeping_pending_legal_approval',
      'Orders, payments, refunds, companion earnings/withdrawals/recoveries, settlement identity and invoice evidence'),
    ('support_disputes_safety', 'retainedRestricted', 1095, 'claims_and_safety_evidence_pending_legal_approval',
      'Support, service/reschedule/attendance disputes, payment complaints, voice attendance, companion incidents, moderation and communication evidence'),
    ('consent_rights_account_governance', 'retainedRestricted', 1095, 'rights_and_compliance_evidence_pending_legal_approval',
      'Consent receipts, data-rights and identity-review cases, customer/companion account actions, training and appeals'),
    ('deletion_audit_evidence', 'retainedRestricted', 3650, 'accountability_evidence_pending_legal_approval',
      'Deletion request, disposition ledger and minimally necessary audit evidence')
  ) AS category(code, disposition, retention_days, legal_basis_code, description)
  ON CONFLICT ("deletionRequestId", "category") DO NOTHING;

  IF v_approval_reference IS NOT NULL THEN
    UPDATE "AccountDataRetentionRecord"
    SET
      "policyApprovalStatus" = 'approved',
      "policyApprovalReference" = v_approval_reference,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "deletionRequestId" = p_request_id
      AND "policyApprovalStatus" = 'pendingLegalApproval';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_record_count
  FROM "AccountDataRetentionRecord"
  WHERE "deletionRequestId" = p_request_id;

  RETURN v_record_count;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  legacy_request RECORD;
BEGIN
  FOR legacy_request IN
    SELECT "id"
    FROM "AccountDeletionRequest"
    WHERE "status" = 'completed'
    ORDER BY "id"
  LOOP
    PERFORM ensure_completed_account_deletion_retention_ledger(legacy_request."id", NULL);
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "AccountDeletionRequest" AS request
    WHERE request."status" = 'completed'
      AND (
        SELECT COUNT(*)
        FROM "AccountDataRetentionRecord" AS ledger
        WHERE ledger."deletionRequestId" = request."id"
      ) <> 7
  ) THEN
    RAISE EXCEPTION 'completed deletion retention ledger backfill is incomplete';
  END IF;
END;
$$;
