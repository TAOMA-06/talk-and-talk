-- Category-level legal holds are represented separately from expiry progress:
-- the retention ledger remains immutable evidence, while append-only actions
-- preserve every placement/release request and independent decision.

CREATE TABLE "AccountDataRetentionLegalHoldAction" (
  "id" TEXT NOT NULL,
  "retentionRecordId" TEXT NOT NULL,
  "legalHoldId" TEXT,
  "action" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "reasonCode" VARCHAR(64) NOT NULL,
  "authorityReference" VARCHAR(160) NOT NULL,
  "policyVersion" VARCHAR(64) NOT NULL,
  "policyApprovalReference" VARCHAR(160) NOT NULL,
  "requestedById" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedById" TEXT,
  "decidedAt" TIMESTAMP(3),
  "decisionReference" VARCHAR(160),
  "decisionReasonCode" VARCHAR(64),
  "clientRequestId" VARCHAR(80) NOT NULL,
  "partialErasurePhase" TEXT,
  "partialErasureCursor" TEXT,
  "partialErasedRecordCount" INTEGER NOT NULL,
  "partialExpiryAttemptCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountDataRetentionLegalHoldAction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RetentionLegalHoldAction_kind_check"
    CHECK ("action" IN ('placement', 'release')),
  CONSTRAINT "RetentionLegalHoldAction_status_check"
    CHECK ("status" IN ('pending', 'approved', 'rejected')),
  CONSTRAINT "RetentionLegalHoldAction_target_check"
    CHECK (
      ("action" = 'placement' AND "legalHoldId" IS NULL)
      OR ("action" = 'release' AND "legalHoldId" IS NOT NULL)
    ),
  CONSTRAINT "RetentionLegalHoldAction_reason_check"
    CHECK ("reasonCode" ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  CONSTRAINT "RetentionLegalHoldAction_authority_reference_check"
    CHECK ("authorityReference" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{5,159}$'),
  CONSTRAINT "RetentionLegalHoldAction_policy_check"
    CHECK (
      "policyVersion" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{2,63}$'
      AND "policyApprovalReference" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{5,159}$'
    ),
  CONSTRAINT "RetentionLegalHoldAction_client_request_check"
    CHECK ("clientRequestId" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$'),
  CONSTRAINT "RetentionLegalHoldAction_progress_check"
    CHECK ("partialErasedRecordCount" >= 0 AND "partialExpiryAttemptCount" >= 0),
  CONSTRAINT "RetentionLegalHoldAction_decision_check"
    CHECK (
      (
        "status" = 'pending'
        AND "decidedById" IS NULL
        AND "decidedAt" IS NULL
        AND "decisionReference" IS NULL
        AND "decisionReasonCode" IS NULL
      )
      OR (
        "status" = 'approved'
        AND "decidedById" IS NOT NULL
        AND "decidedAt" IS NOT NULL
        AND "decisionReference" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{5,159}$'
        AND "decisionReasonCode" IS NULL
        AND "decidedById" <> "requestedById"
        AND "decidedAt" >= "requestedAt"
      )
      OR (
        "status" = 'rejected'
        AND "decidedById" IS NOT NULL
        AND "decidedAt" IS NOT NULL
        AND "decisionReference" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{5,159}$'
        AND "decisionReasonCode" ~ '^[A-Z][A-Z0-9_]{2,63}$'
        AND "decidedById" <> "requestedById"
        AND "decidedAt" >= "requestedAt"
      )
    )
);

CREATE TABLE "AccountDataRetentionLegalHold" (
  "id" TEXT NOT NULL,
  "retentionRecordId" TEXT NOT NULL,
  "placementActionId" TEXT NOT NULL,
  "placedById" TEXT NOT NULL,
  "placedAt" TIMESTAMP(3) NOT NULL,
  "releaseActionId" TEXT,
  "releasedById" TEXT,
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountDataRetentionLegalHold_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RetentionLegalHold_release_check"
    CHECK (
      (
        "releaseActionId" IS NULL
        AND "releasedById" IS NULL
        AND "releasedAt" IS NULL
      )
      OR (
        "releaseActionId" IS NOT NULL
        AND "releasedById" IS NOT NULL
        AND "releasedAt" IS NOT NULL
        AND "releasedAt" >= "placedAt"
      )
    )
);

CREATE UNIQUE INDEX "RetentionLegalHold_placementActionId_key"
ON "AccountDataRetentionLegalHold"("placementActionId");
CREATE UNIQUE INDEX "RetentionLegalHold_releaseActionId_key"
ON "AccountDataRetentionLegalHold"("releaseActionId");
CREATE UNIQUE INDEX "RetentionLegalHold_active_record_key"
ON "AccountDataRetentionLegalHold"("retentionRecordId")
WHERE "releasedAt" IS NULL;
CREATE INDEX "RetentionLegalHold_record_state"
ON "AccountDataRetentionLegalHold"("retentionRecordId", "releasedAt", "placedAt", "id");

CREATE UNIQUE INDEX "RetentionLegalHoldAction_requester_client_key"
ON "AccountDataRetentionLegalHoldAction"("requestedById", "clientRequestId");
CREATE UNIQUE INDEX "RetentionLegalHoldAction_pending_placement_key"
ON "AccountDataRetentionLegalHoldAction"("retentionRecordId")
WHERE "action" = 'placement' AND "status" = 'pending';
CREATE UNIQUE INDEX "RetentionLegalHoldAction_pending_release_key"
ON "AccountDataRetentionLegalHoldAction"("legalHoldId")
WHERE "action" = 'release' AND "status" = 'pending';
CREATE INDEX "RetentionLegalHoldAction_record_queue"
ON "AccountDataRetentionLegalHoldAction"(
  "retentionRecordId", "action", "status", "requestedAt", "id"
);
CREATE INDEX "RetentionLegalHoldAction_hold_queue"
ON "AccountDataRetentionLegalHoldAction"(
  "legalHoldId", "action", "status", "requestedAt", "id"
);
CREATE INDEX "RetentionLegalHoldAction_pending_sla"
ON "AccountDataRetentionLegalHoldAction"("status", "requestedAt", "id");

ALTER TABLE "AccountDataRetentionLegalHoldAction"
ADD CONSTRAINT "RetentionLegalHoldAction_record_fkey"
FOREIGN KEY ("retentionRecordId") REFERENCES "AccountDataRetentionRecord"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "RetentionLegalHoldAction_requestedBy_fkey"
FOREIGN KEY ("requestedById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "RetentionLegalHoldAction_decidedBy_fkey"
FOREIGN KEY ("decidedById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AccountDataRetentionLegalHold"
ADD CONSTRAINT "RetentionLegalHold_record_fkey"
FOREIGN KEY ("retentionRecordId") REFERENCES "AccountDataRetentionRecord"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "RetentionLegalHold_placementAction_fkey"
FOREIGN KEY ("placementActionId") REFERENCES "AccountDataRetentionLegalHoldAction"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "RetentionLegalHold_releaseAction_fkey"
FOREIGN KEY ("releaseActionId") REFERENCES "AccountDataRetentionLegalHoldAction"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "RetentionLegalHold_placedBy_fkey"
FOREIGN KEY ("placedById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "RetentionLegalHold_releasedBy_fkey"
FOREIGN KEY ("releasedById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AccountDataRetentionLegalHoldAction"
ADD CONSTRAINT "RetentionLegalHoldAction_hold_fkey"
FOREIGN KEY ("legalHoldId") REFERENCES "AccountDataRetentionLegalHold"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "assert_retention_legal_hold_admin"(
  actor_id TEXT,
  operation_name TEXT
) RETURNS VOID AS $$
DECLARE
  actor_role TEXT;
  actor_status TEXT;
BEGIN
  SELECT actor."role"::TEXT, actor."accountStatus"::TEXT
  INTO actor_role, actor_status
  FROM "User" actor
  WHERE actor."id" = actor_id;

  IF actor_role IS DISTINCT FROM 'admin' OR actor_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION '% requires an active admin actor', operation_name
      USING ERRCODE = '23514';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "guard_retention_legal_hold_action"()
RETURNS TRIGGER AS $$
DECLARE
  record_state RECORD;
  hold_state RECORD;
  subject_user_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'retention legal-hold actions are append-only'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'pending' THEN
      RAISE EXCEPTION 'legal-hold actions must be inserted as pending requests'
        USING ERRCODE = '23514';
    END IF;
    -- Match the worker/service lock order. The initial read is only a pointer;
    -- after all actor/subject users and the subject companion are locked in a
    -- deterministic order, the retention record is locked and revalidated.
    SELECT record."userId"
    INTO subject_user_id
    FROM "AccountDataRetentionRecord" record
    WHERE record."id" = NEW."retentionRecordId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'retention record does not exist'
        USING ERRCODE = '23503';
    END IF;
    PERFORM actor."id"
    FROM "User" actor
    WHERE actor."id" IN (NEW."requestedById", subject_user_id)
    ORDER BY actor."id"
    FOR UPDATE;
    PERFORM companion."id"
    FROM "CompanionProfile" companion
    WHERE companion."ownerUserId" = subject_user_id
    ORDER BY companion."id"
    FOR UPDATE;

    SELECT
      record."userId",
      record."expiryProcessedAt",
      record."expiryPhase",
      record."expiryCursor",
      record."expiryErasedRecordCount",
      record."expiryAttemptCount",
      record."expiryLeaseToken",
      record."expiryLeaseExpiresAt",
      record."expiryNextAttemptAt"
    INTO record_state
    FROM "AccountDataRetentionRecord" record
    WHERE record."id" = NEW."retentionRecordId"
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'retention record does not exist'
        USING ERRCODE = '23503';
    END IF;
    IF record_state."userId" IS DISTINCT FROM subject_user_id THEN
      RAISE EXCEPTION 'retention record subject changed while placing a legal hold'
        USING ERRCODE = '23514';
    END IF;
    PERFORM "assert_retention_legal_hold_admin"(NEW."requestedById", 'legal-hold request');
    IF record_state."expiryProcessedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'completed retention expiry cannot receive a legal hold'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."partialErasurePhase" IS DISTINCT FROM record_state."expiryPhase"
      OR NEW."partialErasureCursor" IS DISTINCT FROM record_state."expiryCursor"
      OR NEW."partialErasedRecordCount" IS DISTINCT FROM record_state."expiryErasedRecordCount"
      OR NEW."partialExpiryAttemptCount" IS DISTINCT FROM record_state."expiryAttemptCount"
    THEN
      RAISE EXCEPTION 'legal-hold partial-erasure snapshot is not current'
        USING ERRCODE = '23514';
    END IF;

    IF NEW."action" = 'placement' THEN
      IF record_state."expiryLeaseToken" IS NOT NULL
        OR record_state."expiryLeaseExpiresAt" IS NOT NULL
        OR record_state."expiryNextAttemptAt" IS NOT NULL
      THEN
        RAISE EXCEPTION 'legal-hold placement requires cleared expiry scheduling'
          USING ERRCODE = '23514';
      END IF;

      -- Record locking serializes this cross-table invariant with both hold
      -- placement and expiry work. Lock the active row as well when present so
      -- direct SQL cannot create a second provisional placement barrier.
      PERFORM hold."id"
      FROM "AccountDataRetentionLegalHold" hold
      WHERE hold."retentionRecordId" = NEW."retentionRecordId"
        AND hold."releasedAt" IS NULL
      FOR UPDATE;
      IF FOUND THEN
        RAISE EXCEPTION 'an active legal hold already exists for this retention record'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      SELECT hold."retentionRecordId", hold."releasedAt"
      INTO hold_state
      FROM "AccountDataRetentionLegalHold" hold
      WHERE hold."id" = NEW."legalHoldId"
      FOR UPDATE;
      IF NOT FOUND
        OR hold_state."retentionRecordId" IS DISTINCT FROM NEW."retentionRecordId"
        OR hold_state."releasedAt" IS NOT NULL
      THEN
        RAISE EXCEPTION 'release request must target the active hold on the same record'
          USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."retentionRecordId" IS DISTINCT FROM OLD."retentionRecordId"
    OR NEW."legalHoldId" IS DISTINCT FROM OLD."legalHoldId"
    OR NEW."action" IS DISTINCT FROM OLD."action"
    OR NEW."reasonCode" IS DISTINCT FROM OLD."reasonCode"
    OR NEW."authorityReference" IS DISTINCT FROM OLD."authorityReference"
    OR NEW."policyVersion" IS DISTINCT FROM OLD."policyVersion"
    OR NEW."policyApprovalReference" IS DISTINCT FROM OLD."policyApprovalReference"
    OR NEW."requestedById" IS DISTINCT FROM OLD."requestedById"
    OR NEW."requestedAt" IS DISTINCT FROM OLD."requestedAt"
    OR NEW."clientRequestId" IS DISTINCT FROM OLD."clientRequestId"
    OR NEW."partialErasurePhase" IS DISTINCT FROM OLD."partialErasurePhase"
    OR NEW."partialErasureCursor" IS DISTINCT FROM OLD."partialErasureCursor"
    OR NEW."partialErasedRecordCount" IS DISTINCT FROM OLD."partialErasedRecordCount"
    OR NEW."partialExpiryAttemptCount" IS DISTINCT FROM OLD."partialExpiryAttemptCount"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'retention legal-hold action provenance is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."status" <> 'pending'
    OR NEW."status" NOT IN ('approved', 'rejected')
    OR NEW."status" = OLD."status"
  THEN
    RAISE EXCEPTION 'retention legal-hold action transition is invalid'
      USING ERRCODE = '23514';
  END IF;
  PERFORM "assert_retention_legal_hold_admin"(NEW."decidedById", 'legal-hold decision');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RetentionLegalHoldAction_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "AccountDataRetentionLegalHoldAction"
FOR EACH ROW EXECUTE FUNCTION "guard_retention_legal_hold_action"();

CREATE OR REPLACE FUNCTION "guard_retention_legal_hold"()
RETURNS TRIGGER AS $$
DECLARE
  record_processed_at TIMESTAMP(3);
  action_state RECORD;
  subject_user_id TEXT;
  record_subject_user_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'retention legal holds are immutable evidence'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT record."userId"
    INTO subject_user_id
    FROM "AccountDataRetentionRecord" record
    WHERE record."id" = NEW."retentionRecordId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'active legal hold requires an existing retention record'
        USING ERRCODE = '23514';
    END IF;
    PERFORM actor."id"
    FROM "User" actor
    WHERE actor."id" IN (NEW."placedById", subject_user_id)
    ORDER BY actor."id"
    FOR UPDATE;
    PERFORM companion."id"
    FROM "CompanionProfile" companion
    WHERE companion."ownerUserId" = subject_user_id
    ORDER BY companion."id"
    FOR UPDATE;
    SELECT record."expiryProcessedAt", record."userId"
    INTO record_processed_at, record_subject_user_id
    FROM "AccountDataRetentionRecord" record
    WHERE record."id" = NEW."retentionRecordId"
    FOR UPDATE;
    IF NOT FOUND
      OR record_subject_user_id IS DISTINCT FROM subject_user_id
      OR record_processed_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'active legal hold requires an unprocessed retention record'
        USING ERRCODE = '23514';
    END IF;
    PERFORM "assert_retention_legal_hold_admin"(NEW."placedById", 'legal-hold placement');
    SELECT action."retentionRecordId", action."action", action."status",
           action."requestedById", action."decidedById", action."decidedAt"
    INTO action_state
    FROM "AccountDataRetentionLegalHoldAction" action
    WHERE action."id" = NEW."placementActionId";
    IF NOT FOUND
      OR action_state."retentionRecordId" IS DISTINCT FROM NEW."retentionRecordId"
      OR action_state."action" IS DISTINCT FROM 'placement'
      OR action_state."status" IS DISTINCT FROM 'pending'
      OR action_state."requestedById" = NEW."placedById"
    THEN
      RAISE EXCEPTION 'legal-hold placement action is inconsistent'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."retentionRecordId" IS DISTINCT FROM OLD."retentionRecordId"
    OR NEW."placementActionId" IS DISTINCT FROM OLD."placementActionId"
    OR NEW."placedById" IS DISTINCT FROM OLD."placedById"
    OR NEW."placedAt" IS DISTINCT FROM OLD."placedAt"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'legal-hold placement provenance is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."releasedAt" IS NOT NULL
    OR NEW."releasedAt" IS NULL
    OR NEW."releaseActionId" IS NULL
    OR NEW."releasedById" IS NULL
  THEN
    RAISE EXCEPTION 'legal-hold release transition is invalid'
      USING ERRCODE = '23514';
  END IF;
  PERFORM "assert_retention_legal_hold_admin"(NEW."releasedById", 'legal-hold release');
  SELECT action."retentionRecordId", action."legalHoldId", action."action",
         action."status", action."requestedById", action."decidedById", action."decidedAt"
  INTO action_state
  FROM "AccountDataRetentionLegalHoldAction" action
  WHERE action."id" = NEW."releaseActionId";
  IF NOT FOUND
    OR action_state."retentionRecordId" IS DISTINCT FROM NEW."retentionRecordId"
    OR action_state."legalHoldId" IS DISTINCT FROM NEW."id"
    OR action_state."action" IS DISTINCT FROM 'release'
    OR action_state."status" IS DISTINCT FROM 'pending'
    OR action_state."requestedById" = NEW."releasedById"
  THEN
    RAISE EXCEPTION 'legal-hold release action is inconsistent'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RetentionLegalHold_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "AccountDataRetentionLegalHold"
FOR EACH ROW EXECUTE FUNCTION "guard_retention_legal_hold"();

CREATE OR REPLACE FUNCTION "validate_retention_legal_hold_action_commit"()
RETURNS TRIGGER AS $$
DECLARE
  matching_holds INTEGER;
BEGIN
  IF NEW."status" = 'approved' AND NEW."action" = 'placement' THEN
    SELECT COUNT(*) INTO matching_holds
    FROM "AccountDataRetentionLegalHold" hold
    WHERE hold."placementActionId" = NEW."id"
      AND hold."retentionRecordId" = NEW."retentionRecordId"
      AND hold."placedById" = NEW."decidedById"
      AND hold."placedAt" = NEW."decidedAt";
    IF matching_holds <> 1 THEN
      RAISE EXCEPTION 'approved placement action must create exactly one legal hold'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."status" = 'approved' AND NEW."action" = 'release' THEN
    SELECT COUNT(*) INTO matching_holds
    FROM "AccountDataRetentionLegalHold" hold
    WHERE hold."id" = NEW."legalHoldId"
      AND hold."releaseActionId" = NEW."id"
      AND hold."releasedById" = NEW."decidedById"
      AND hold."releasedAt" = NEW."decidedAt";
    IF matching_holds <> 1 THEN
      RAISE EXCEPTION 'approved release action must release exactly one legal hold'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."status" = 'rejected' THEN
    SELECT COUNT(*) INTO matching_holds
    FROM "AccountDataRetentionLegalHold" hold
    WHERE hold."placementActionId" = NEW."id" OR hold."releaseActionId" = NEW."id";
    IF matching_holds <> 0 THEN
      RAISE EXCEPTION 'rejected legal-hold action cannot change a hold'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "RetentionLegalHoldAction_commit_check"
AFTER INSERT OR UPDATE ON "AccountDataRetentionLegalHoldAction"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_retention_legal_hold_action_commit"();

CREATE OR REPLACE FUNCTION "validate_retention_legal_hold_commit"()
RETURNS TRIGGER AS $$
DECLARE
  action_state RECORD;
BEGIN
  SELECT action."retentionRecordId", action."action", action."status",
         action."decidedById", action."decidedAt"
  INTO action_state
  FROM "AccountDataRetentionLegalHoldAction" action
  WHERE action."id" = NEW."placementActionId";
  IF NOT FOUND
    OR action_state."retentionRecordId" IS DISTINCT FROM NEW."retentionRecordId"
    OR action_state."action" IS DISTINCT FROM 'placement'
    OR action_state."status" IS DISTINCT FROM 'approved'
    OR action_state."decidedById" IS DISTINCT FROM NEW."placedById"
    OR action_state."decidedAt" IS DISTINCT FROM NEW."placedAt"
  THEN
    RAISE EXCEPTION 'committed legal hold lacks an approved placement action'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."releasedAt" IS NOT NULL THEN
    SELECT action."retentionRecordId", action."legalHoldId", action."action",
           action."status", action."decidedById", action."decidedAt"
    INTO action_state
    FROM "AccountDataRetentionLegalHoldAction" action
    WHERE action."id" = NEW."releaseActionId";
    IF NOT FOUND
      OR action_state."retentionRecordId" IS DISTINCT FROM NEW."retentionRecordId"
      OR action_state."legalHoldId" IS DISTINCT FROM NEW."id"
      OR action_state."action" IS DISTINCT FROM 'release'
      OR action_state."status" IS DISTINCT FROM 'approved'
      OR action_state."decidedById" IS DISTINCT FROM NEW."releasedById"
      OR action_state."decidedAt" IS DISTINCT FROM NEW."releasedAt"
    THEN
      RAISE EXCEPTION 'released legal hold lacks an approved release action'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "RetentionLegalHold_commit_check"
AFTER INSERT OR UPDATE ON "AccountDataRetentionLegalHold"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_retention_legal_hold_commit"();

-- The hold service clears an existing lease before inserting a pending
-- placement. Once that barrier exists, only clearing operational scheduling is
-- allowed; acquiring a lease or advancing any expiry progress fails closed.
CREATE OR REPLACE FUNCTION "guard_retention_expiry_while_held"()
RETURNS TRIGGER AS $$
DECLARE
  barrier_exists BOOLEAN;
BEGIN
  SELECT
    EXISTS (
      SELECT 1
      FROM "AccountDataRetentionLegalHoldAction" action
      WHERE action."retentionRecordId" = NEW."id"
        AND action."action" = 'placement'
        AND action."status" = 'pending'
    )
    OR EXISTS (
      SELECT 1
      FROM "AccountDataRetentionLegalHold" hold
      WHERE hold."retentionRecordId" = NEW."id"
        AND hold."releasedAt" IS NULL
    )
  INTO barrier_exists;

  IF barrier_exists AND (
    NEW."disposition" IS DISTINCT FROM OLD."disposition"
    OR NEW."expiryProcessedAt" IS DISTINCT FROM OLD."expiryProcessedAt"
    OR NEW."expiryAttemptCount" IS DISTINCT FROM OLD."expiryAttemptCount"
    OR NEW."expiryLastErrorCode" IS DISTINCT FROM OLD."expiryLastErrorCode"
    OR NEW."expiryPhase" IS DISTINCT FROM OLD."expiryPhase"
    OR NEW."expiryCursor" IS DISTINCT FROM OLD."expiryCursor"
    OR NEW."expiryErasedRecordCount" IS DISTINCT FROM OLD."expiryErasedRecordCount"
    OR NEW."expiryLeaseToken" IS NOT NULL
    OR NEW."expiryLeaseExpiresAt" IS NOT NULL
    OR NEW."expiryNextAttemptAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'retention expiry cannot advance while a legal hold barrier is active'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AccountDataRetentionRecord_legal_hold_guard"
BEFORE UPDATE ON "AccountDataRetentionRecord"
FOR EACH ROW EXECUTE FUNCTION "guard_retention_expiry_while_held"();
