-- Account deletion used to erase every subject-owned row, recompute every
-- affected rating and write the retention ledger in one unbounded transaction.
-- Persist the erasure state machine so every source-table batch can commit
-- independently and an expired lease can be resumed by another replica.

ALTER TABLE "AccountDeletionRequest"
ADD COLUMN "approvedById" TEXT,
ADD COLUMN "approvedAt" TIMESTAMP(3),
ADD COLUMN "approvalNote" TEXT,
ADD COLUMN "retentionApprovalReference" TEXT,
ADD COLUMN "companionIdSnapshot" TEXT,
ADD COLUMN "executionStatus" TEXT NOT NULL DEFAULT 'idle',
ADD COLUMN "executionPhase" TEXT NOT NULL DEFAULT 'awaiting_second_review',
ADD COLUMN "executionCursor" TEXT,
ADD COLUMN "executionAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "executionFailureCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "executionNextAttemptAt" TIMESTAMP(3),
ADD COLUMN "executionLastErrorCode" TEXT,
ADD COLUMN "executionFailedAt" TIMESTAMP(3),
ADD COLUMN "executionLeaseToken" TEXT,
ADD COLUMN "executionLeaseExpiresAt" TIMESTAMP(3),
ADD COLUMN "executionProcessedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "executionDeletedCounts" JSONB,
ADD COLUMN "executionRetainedCounts" JSONB,
ADD COLUMN "executionStartedAt" TIMESTAMP(3),
ADD COLUMN "executionFinishedAt" TIMESTAMP(3);

UPDATE "AccountDeletionRequest"
SET
  "executionStatus" = 'completed',
  "executionPhase" = 'completed',
  "executionStartedAt" = COALESCE("processingStartedAt", "completedAt", "updatedAt"),
  "executionFinishedAt" = COALESCE("completedAt", "updatedAt")
WHERE "status" = 'completed';

ALTER TABLE "AccountDeletionRequest"
ADD CONSTRAINT "AccountDeletionRequest_approvedById_fkey"
FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "AccountDeletionRequest_executionLeaseToken_key"
ON "AccountDeletionRequest"("executionLeaseToken");
CREATE INDEX "AccountDeletionRequest_approvedById_approvedAt_idx"
ON "AccountDeletionRequest"("approvedById", "approvedAt");
CREATE INDEX "AccountDeletionRequest_execution_due"
ON "AccountDeletionRequest"("status", "executionStatus", "executionNextAttemptAt", "createdAt", "id");
CREATE INDEX "AccountDeletionRequest_execution_lease"
ON "AccountDeletionRequest"("executionStatus", "executionLeaseExpiresAt", "id");

ALTER TABLE "AccountDeletionRequest"
ADD CONSTRAINT "AccountDeletionRequest_execution_status_check"
CHECK ("executionStatus" IN ('idle', 'queued', 'processing', 'retryScheduled', 'failed', 'completed')),
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
  'auth_identity',
  'staff_credential',
  'user_profile',
  'companion_availability_deactivate',
  'companion_availability_window',
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
  'companion_offering',
  'companion_service_tag',
  'companion_profile',
  'media_retention',
  'retained_transactions_snapshot',
  'retained_safety_snapshot',
  'retained_governance_snapshot',
  'final_verification',
  'completed'
)),
ADD CONSTRAINT "AccountDeletionRequest_execution_counts_check"
CHECK ("executionAttemptCount" >= 0 AND "executionFailureCount" >= 0 AND "executionProcessedCount" >= 0),
ADD CONSTRAINT "AccountDeletionRequest_execution_lease_check"
CHECK (("executionLeaseToken" IS NULL) = ("executionLeaseExpiresAt" IS NULL)),
ADD CONSTRAINT "AccountDeletionRequest_execution_failure_check"
CHECK (
  ("executionStatus" <> 'failed')
  OR ("executionFailedAt" IS NOT NULL AND length(btrim(COALESCE("executionLastErrorCode", ''))) > 0)
),
ADD CONSTRAINT "AccountDeletionRequest_execution_retry_check"
CHECK (("executionStatus" <> 'retryScheduled') OR "executionNextAttemptAt" IS NOT NULL),
ADD CONSTRAINT "AccountDeletionRequest_execution_completion_check"
CHECK (
  ("status"::TEXT <> 'completed' OR "executionStatus" = 'completed')
  AND ("executionStatus" <> 'completed' OR ("status"::TEXT = 'completed' AND "executionPhase" = 'completed'))
),
ADD CONSTRAINT "AccountDeletionRequest_execution_approval_check"
CHECK (
  "executionStatus" IN ('idle', 'completed')
  OR (
    "approvedById" IS NOT NULL
    AND "approvedAt" IS NOT NULL
    AND length(btrim(COALESCE("approvalNote", ''))) > 0
    AND length(btrim(COALESCE("retentionApprovalReference", ''))) > 0
  )
);

CREATE OR REPLACE FUNCTION "prevent_account_deletion_execution_provenance_rewrite"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."approvedAt" IS NOT NULL AND (
    NEW."approvedById" IS DISTINCT FROM OLD."approvedById"
    OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt"
    OR NEW."approvalNote" IS DISTINCT FROM OLD."approvalNote"
    OR NEW."retentionApprovalReference" IS DISTINCT FROM OLD."retentionApprovalReference"
    OR NEW."companionIdSnapshot" IS DISTINCT FROM OLD."companionIdSnapshot"
  ) THEN
    RAISE EXCEPTION 'account deletion approval provenance is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."executionAttemptCount" < OLD."executionAttemptCount"
    OR NEW."executionFailureCount" < OLD."executionFailureCount"
    OR NEW."executionProcessedCount" < OLD."executionProcessedCount"
  THEN
    RAISE EXCEPTION 'account deletion execution progress cannot decrease'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."executionStatus" = 'completed' AND (
    NEW."executionStatus" IS DISTINCT FROM OLD."executionStatus"
    OR NEW."executionPhase" IS DISTINCT FROM OLD."executionPhase"
    OR NEW."executionDeletedCounts" IS DISTINCT FROM OLD."executionDeletedCounts"
    OR NEW."executionRetainedCounts" IS DISTINCT FROM OLD."executionRetainedCounts"
    OR NEW."executionFinishedAt" IS DISTINCT FROM OLD."executionFinishedAt"
    OR NEW."completedById" IS DISTINCT FROM OLD."completedById"
    OR NEW."completedAt" IS DISTINCT FROM OLD."completedAt"
  ) THEN
    RAISE EXCEPTION 'completed account deletion execution is immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AccountDeletionRequest_execution_provenance_immutable"
BEFORE UPDATE ON "AccountDeletionRequest"
FOR EACH ROW
EXECUTE FUNCTION "prevent_account_deletion_execution_provenance_rewrite"();

-- A companion snapshot is part of the approved deletion subject. Prevent an
-- admin/raw SQL reassignment from moving that same profile to another person
-- while a worker is erasing its availability, listings and reminder state.
-- Detachment after a completed retention period remains allowed because the
-- old-owner branch intentionally covers only active deletion workflows.
CREATE OR REPLACE FUNCTION "prevent_companion_owner_reassignment_during_deletion"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."ownerUserId" IS NOT DISTINCT FROM OLD."ownerUserId" THEN
    RETURN NEW;
  END IF;

  IF OLD."ownerUserId" IS NOT NULL AND EXISTS (
    SELECT 1
    FROM "AccountDeletionRequest" request
    WHERE request."userId" = OLD."ownerUserId"
      AND request."status"::TEXT IN ('pending', 'processing')
  ) THEN
    RAISE EXCEPTION 'companion owner cannot change during account deletion'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."ownerUserId" IS NOT NULL AND EXISTS (
    SELECT 1
    FROM "AccountDeletionRequest" request
    WHERE request."userId" = NEW."ownerUserId"
      AND request."status"::TEXT IN ('pending', 'processing', 'completed')
  ) THEN
    RAISE EXCEPTION 'companion profile cannot be assigned to a deleting or deleted account'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CompanionProfile_owner_deletion_guard"
BEFORE UPDATE OF "ownerUserId" ON "CompanionProfile"
FOR EACH ROW
EXECUTE FUNCTION "prevent_companion_owner_reassignment_during_deletion"();

CREATE TABLE "AccountDeletionRatingRefreshJob" (
  "id" TEXT NOT NULL,
  "deletionRequestId" TEXT NOT NULL,
  "companionId" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountDeletionRatingRefreshJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountDeletionRatingRefreshJob_deletionRequestId_companionId_key"
ON "AccountDeletionRatingRefreshJob"("deletionRequestId", "companionId");
CREATE INDEX "AccountDeletionRatingRefreshJob_request_due"
ON "AccountDeletionRatingRefreshJob"("deletionRequestId", "completedAt", "companionId");
ALTER TABLE "AccountDeletionRatingRefreshJob"
ADD CONSTRAINT "AccountDeletionRatingRefreshJob_deletionRequestId_fkey"
FOREIGN KEY ("deletionRequestId") REFERENCES "AccountDeletionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountDeletionRatingRefreshJob"
ADD CONSTRAINT "AccountDeletionRatingRefreshJob_companionId_fkey"
FOREIGN KEY ("companionId") REFERENCES "CompanionProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AccountDataRetentionRecord"
ADD COLUMN "expiryPhase" TEXT,
ADD COLUMN "expiryCursor" TEXT,
ADD COLUMN "expiryLeaseToken" TEXT,
ADD COLUMN "expiryLeaseExpiresAt" TIMESTAMP(3),
ADD COLUMN "expiryErasedRecordCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "AccountDataRetentionRecord"
SET "expiryPhase" = CASE "category"
  WHEN 'identity_authentication_profile' THEN 'refresh_token'
  WHEN 'preferences_behavior_notifications' THEN 'notification_delivery'
  WHEN 'public_user_content' THEN 'community_like'
  ELSE NULL
END
WHERE "disposition" = 'pendingErasure' AND "expiryProcessedAt" IS NULL;

CREATE UNIQUE INDEX "AccountDataRetentionRecord_expiryLeaseToken_key"
ON "AccountDataRetentionRecord"("expiryLeaseToken");
CREATE INDEX "AccountDataRetentionRecord_expiry_claim"
ON "AccountDataRetentionRecord"(
  "disposition", "expiryProcessedAt", "expiryNextAttemptAt",
  "expiryLeaseExpiresAt", "retentionEndsAt", "id"
);

ALTER TABLE "AccountDataRetentionRecord"
ADD CONSTRAINT "AccountDataRetentionRecord_expiry_progress_check"
CHECK ("expiryErasedRecordCount" >= 0),
ADD CONSTRAINT "AccountDataRetentionRecord_expiry_lease_check"
CHECK (("expiryLeaseToken" IS NULL) = ("expiryLeaseExpiresAt" IS NULL)),
ADD CONSTRAINT "AccountDataRetentionRecord_expiry_processed_lease_check"
CHECK ("expiryProcessedAt" IS NULL OR "expiryLeaseToken" IS NULL);

-- Keep the evidence columns immutable while allowing only the new operational
-- lease/cursor/progress fields to move before the terminal outcome.
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
      AND (OLD."policyApprovalReference" IS NULL OR NEW."policyApprovalReference" = OLD."policyApprovalReference")
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

  IF OLD."expiryProcessedAt" IS NOT NULL AND (
    NEW."expiryProcessedAt" IS DISTINCT FROM OLD."expiryProcessedAt"
    OR NEW."expiryAttemptCount" IS DISTINCT FROM OLD."expiryAttemptCount"
    OR NEW."expiryNextAttemptAt" IS DISTINCT FROM OLD."expiryNextAttemptAt"
    OR NEW."expiryLastErrorCode" IS DISTINCT FROM OLD."expiryLastErrorCode"
    OR NEW."expiryPhase" IS DISTINCT FROM OLD."expiryPhase"
    OR NEW."expiryCursor" IS DISTINCT FROM OLD."expiryCursor"
    OR NEW."expiryLeaseToken" IS DISTINCT FROM OLD."expiryLeaseToken"
    OR NEW."expiryLeaseExpiresAt" IS DISTINCT FROM OLD."expiryLeaseExpiresAt"
    OR NEW."expiryErasedRecordCount" IS DISTINCT FROM OLD."expiryErasedRecordCount"
    OR NEW."disposition" IS DISTINCT FROM OLD."disposition"
  ) THEN
    RAISE EXCEPTION 'processed retention ledger outcome is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."expiryAttemptCount" < OLD."expiryAttemptCount"
    OR NEW."expiryErasedRecordCount" < OLD."expiryErasedRecordCount"
  THEN
    RAISE EXCEPTION 'retention ledger progress cannot decrease'
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

-- Existing trigger keeps its name and now executes the replacement function.

CREATE INDEX "Notification_retention_due"
ON "Notification"("createdAt", "id");
CREATE INDEX "WeChatSubscriptionGrant_retention_due"
ON "WeChatSubscriptionGrant"("createdAt", "id");
CREATE INDEX "RefreshToken_retention_due"
ON "RefreshToken"("expiresAt", "id");
