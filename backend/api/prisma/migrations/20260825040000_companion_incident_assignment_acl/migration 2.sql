ALTER TABLE "CompanionIncidentReport"
  ADD COLUMN "assignedToUserId" TEXT,
  ADD COLUMN "assignedAt" TIMESTAMP(3);

ALTER TABLE "CompanionIncidentReport"
  ADD CONSTRAINT "CompanionIncidentReport_assignedToUserId_fkey"
    FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CompanionIncidentReport_assignment_pair_check" CHECK (
    ("assignedToUserId" IS NULL) = ("assignedAt" IS NULL)
  ),
  ADD CONSTRAINT "CompanionIncidentReport_assignment_time_check" CHECK (
    "assignedAt" IS NULL OR "assignedAt" >= "createdAt"
  );

CREATE INDEX "CompanionIncidentReport_assignee_status_created"
  ON "CompanionIncidentReport"("assignedToUserId", "status", "createdAt", "id");
CREATE INDEX "CompanionIncidentReport_claimable_queue"
  ON "CompanionIncidentReport"("status", "createdAt", "id")
  WHERE "assignedToUserId" IS NULL AND "status" IN ('open', 'inReview');

CREATE OR REPLACE FUNCTION "validate_companion_incident_assignee"()
RETURNS TRIGGER AS $$
DECLARE
  assignee_role TEXT;
  assignee_account_status TEXT;
  credential_status TEXT;
BEGIN
  IF NEW."assignedToUserId" IS NULL THEN
    RETURN NEW;
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

  IF assignee_role NOT IN ('supply', 'admin')
     OR assignee_account_status IS DISTINCT FROM 'active'
     OR credential_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'companion incident assignee must be active supply staff or an active administrator'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CompanionIncidentReport_assignee_guard"
BEFORE INSERT OR UPDATE OF "assignedToUserId", "assignedAt"
ON "CompanionIncidentReport"
FOR EACH ROW EXECUTE FUNCTION "validate_companion_incident_assignee"();

CREATE OR REPLACE FUNCTION "guard_staff_incident_assignments_before_offboarding"()
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
    SELECT 1
    FROM "CompanionIncidentReport" AS incident
    WHERE incident."assignedToUserId" = subject_user_id
      AND incident."status" IN ('open', 'inReview')
  ) THEN
    RAISE EXCEPTION 'active companion incident assignments require handoff before staff offboarding'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "StaffCredential_companion_incident_handoff_guard"
BEFORE UPDATE OF "status", "userId" OR DELETE ON "StaffCredential"
FOR EACH ROW EXECUTE FUNCTION "guard_staff_incident_assignments_before_offboarding"();

CREATE OR REPLACE FUNCTION "guard_user_incident_assignments_before_role_restriction"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."accountStatus"::TEXT = 'active'
     AND NEW."role"::TEXT IN ('supply', 'admin') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "CompanionIncidentReport" AS incident
    WHERE incident."assignedToUserId" = NEW."id"
      AND incident."status" IN ('open', 'inReview')
  ) THEN
    RAISE EXCEPTION 'active companion incident assignments require handoff before role or account restriction'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "User_companion_incident_handoff_guard"
BEFORE UPDATE OF "role", "accountStatus" ON "User"
FOR EACH ROW EXECUTE FUNCTION "guard_user_incident_assignments_before_role_restriction"();

-- AUDIT_SUBJECT_POLICY_EXTENSION|commercial.companion_incident_claimed|companionId|companion
-- AUDIT_SUBJECT_POLICY_EXTENSION|commercial.companion_incident_claimed|assignedToUserId|user
-- AUDIT_SUBJECT_POLICY_EXTENSION|commercial.companion_incident_assigned|companionId|companion
-- AUDIT_SUBJECT_POLICY_EXTENSION|commercial.companion_incident_assigned|previousAssignedToUserId|user
-- AUDIT_SUBJECT_POLICY_EXTENSION|commercial.companion_incident_assigned|assignedToUserId|user
