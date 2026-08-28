ALTER TABLE "CompanionAccountAppeal"
  ADD COLUMN "assignedToUserId" TEXT,
  ADD COLUMN "assignedAt" TIMESTAMP(3);

ALTER TABLE "CompanionAccountAppeal"
  ADD CONSTRAINT "CompanionAccountAppeal_assignedToUserId_fkey"
    FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CompanionAccountAppeal_assignment_pair_check" CHECK (
    ("assignedToUserId" IS NULL) = ("assignedAt" IS NULL)
  ),
  ADD CONSTRAINT "CompanionAccountAppeal_assignment_time_check" CHECK (
    "assignedAt" IS NULL OR "assignedAt" >= "createdAt"
  );

CREATE INDEX "CompanionAccountAppeal_assignee_status_due"
  ON "CompanionAccountAppeal"("assignedToUserId", "status", "reviewDueAt", "id");
CREATE INDEX "CompanionAccountAppeal_claimable_queue"
  ON "CompanionAccountAppeal"("reviewDueAt", "createdAt", "id")
  WHERE "assignedToUserId" IS NULL AND "status" = 'pending';

CREATE OR REPLACE FUNCTION "validate_companion_appeal_assignee"()
RETURNS TRIGGER AS $$
DECLARE
  assignee_role TEXT;
  assignee_account_status TEXT;
  credential_status TEXT;
  original_action_creator_id TEXT;
BEGIN
  IF NEW."assignedToUserId" IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW."status"::TEXT <> 'pending' THEN
    RAISE EXCEPTION 'only a pending companion appeal can be assigned'
      USING ERRCODE = '23514';
  END IF;

  SELECT user_row."role"::TEXT, user_row."accountStatus"::TEXT
  INTO assignee_role, assignee_account_status
  FROM "User" AS user_row
  WHERE user_row."id" = NEW."assignedToUserId"
  FOR UPDATE;
  SELECT credential."status"::TEXT
  INTO credential_status
  FROM "StaffCredential" AS credential
  WHERE credential."userId" = NEW."assignedToUserId"
  FOR UPDATE;
  SELECT action."createdById"
  INTO original_action_creator_id
  FROM "CompanionAccountAction" AS action
  WHERE action."id" = NEW."actionId"
  FOR UPDATE;

  IF assignee_role NOT IN ('supply', 'admin')
     OR assignee_account_status IS DISTINCT FROM 'active'
     OR credential_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'companion appeal assignee must be active supply or admin staff'
      USING ERRCODE = '23514';
  END IF;
  IF original_action_creator_id IS NULL
     OR original_action_creator_id = NEW."assignedToUserId" THEN
    RAISE EXCEPTION 'companion appeal assignee must be independent from the original action creator'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CompanionAccountAppeal_assignee_guard"
BEFORE INSERT OR UPDATE OF "assignedToUserId", "assignedAt"
ON "CompanionAccountAppeal"
FOR EACH ROW EXECUTE FUNCTION "validate_companion_appeal_assignee"();

CREATE OR REPLACE FUNCTION "guard_staff_companion_appeal_assignments_before_offboarding"()
RETURNS TRIGGER AS $$
DECLARE
  subject_user_id TEXT;
BEGIN
  subject_user_id := OLD."userId";
  IF TG_OP <> 'DELETE'
     AND NEW."status"::TEXT = 'active'
     AND NEW."userId" IS NOT DISTINCT FROM OLD."userId" THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "CompanionAccountAppeal" AS appeal
    WHERE appeal."assignedToUserId" = subject_user_id
      AND appeal."status" = 'pending'
  ) THEN
    RAISE EXCEPTION 'pending companion appeal assignments require handoff before staff offboarding'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "StaffCredential_companion_appeal_handoff_guard"
BEFORE UPDATE OF "status", "userId" OR DELETE ON "StaffCredential"
FOR EACH ROW EXECUTE FUNCTION "guard_staff_companion_appeal_assignments_before_offboarding"();

CREATE OR REPLACE FUNCTION "guard_user_companion_appeal_assignments_before_role_restriction"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."accountStatus"::TEXT = 'active'
     AND NEW."role"::TEXT IN ('supply', 'admin') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "CompanionAccountAppeal" AS appeal
    WHERE appeal."assignedToUserId" = NEW."id"
      AND appeal."status" = 'pending'
  ) THEN
    RAISE EXCEPTION 'pending companion appeal assignments require handoff before role or account restriction'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "User_companion_appeal_handoff_guard"
BEFORE UPDATE OF "role", "accountStatus" ON "User"
FOR EACH ROW EXECUTE FUNCTION "guard_user_companion_appeal_assignments_before_role_restriction"();

-- AUDIT_SUBJECT_POLICY_EXTENSION|commercial.companion_action_appeal_claimed|companionId|companion
-- AUDIT_SUBJECT_POLICY_EXTENSION|commercial.companion_action_appeal_claimed|assignedToUserId|user
-- AUDIT_SUBJECT_POLICY_EXTENSION|commercial.companion_action_appeal_claimed|originalActionCreatedById|user
-- AUDIT_SUBJECT_POLICY_EXTENSION|commercial.companion_action_appeal_assigned|companionId|companion
-- AUDIT_SUBJECT_POLICY_EXTENSION|commercial.companion_action_appeal_assigned|previousAssignedToUserId|user
-- AUDIT_SUBJECT_POLICY_EXTENSION|commercial.companion_action_appeal_assigned|assignedToUserId|user
-- AUDIT_SUBJECT_POLICY_EXTENSION|commercial.companion_action_appeal_assigned|originalActionCreatedById|user
