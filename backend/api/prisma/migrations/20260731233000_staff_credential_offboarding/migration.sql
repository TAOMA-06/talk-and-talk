CREATE TYPE "StaffCredentialStatus" AS ENUM ('active', 'suspended');

ALTER TABLE "StaffCredential"
  ADD COLUMN "status" "StaffCredentialStatus" NOT NULL DEFAULT 'active',
  ADD COLUMN "suspendedAt" TIMESTAMP(3),
  ADD COLUMN "suspendedByUserId" TEXT,
  ADD COLUMN "suspensionReason" TEXT,
  ADD COLUMN "handoffToUserId" TEXT,
  ADD COLUMN "offboardingOperationId" TEXT;

CREATE UNIQUE INDEX "StaffCredential_offboardingOperationId_key"
  ON "StaffCredential"("offboardingOperationId");
CREATE INDEX "StaffCredential_status_updatedAt_idx"
  ON "StaffCredential"("status", "updatedAt");
CREATE INDEX "StaffCredential_suspendedByUserId_suspendedAt_idx"
  ON "StaffCredential"("suspendedByUserId", "suspendedAt");
CREATE INDEX "StaffCredential_handoffToUserId_suspendedAt_idx"
  ON "StaffCredential"("handoffToUserId", "suspendedAt");

ALTER TABLE "StaffCredential"
  ADD CONSTRAINT "StaffCredential_suspendedByUserId_fkey"
    FOREIGN KEY ("suspendedByUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "StaffCredential_handoffToUserId_fkey"
    FOREIGN KEY ("handoffToUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "StaffCredential_suspension_evidence_check"
    CHECK (
      ("status" = 'active'
        AND "suspendedAt" IS NULL
        AND "suspendedByUserId" IS NULL
        AND "suspensionReason" IS NULL
        AND "handoffToUserId" IS NULL
        AND "offboardingOperationId" IS NULL)
      OR
      ("status" = 'suspended'
        AND "suspendedAt" IS NOT NULL
        AND "suspendedByUserId" IS NOT NULL
        AND "suspensionReason" IS NOT NULL
        AND length(btrim("suspensionReason")) >= 10
        AND "offboardingOperationId" IS NOT NULL)
    );

-- A suspended credential is an immutable offboarding fact. Rehiring requires
-- a separately governed credential instead of silently reviving old access.
CREATE OR REPLACE FUNCTION prevent_staff_credential_reactivation()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'suspended' AND (
    NEW."status" IS DISTINCT FROM OLD."status"
    OR NEW."suspendedAt" IS DISTINCT FROM OLD."suspendedAt"
    OR NEW."suspendedByUserId" IS DISTINCT FROM OLD."suspendedByUserId"
    OR NEW."suspensionReason" IS DISTINCT FROM OLD."suspensionReason"
    OR NEW."handoffToUserId" IS DISTINCT FROM OLD."handoffToUserId"
    OR NEW."offboardingOperationId" IS DISTINCT FROM OLD."offboardingOperationId"
  ) THEN
    RAISE EXCEPTION 'suspended StaffCredential offboarding evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "StaffCredential_prevent_reactivation"
BEFORE UPDATE ON "StaffCredential"
FOR EACH ROW EXECUTE FUNCTION prevent_staff_credential_reactivation();

-- Queue ownership changes lock and re-check the commercial credential. This
-- closes the race where another operator assigns work to a person while their
-- offboarding transaction is revoking access and handing off current work.
CREATE OR REPLACE FUNCTION enforce_active_commercial_staff_assignment()
RETURNS trigger AS $$
DECLARE
  new_assignee TEXT;
  old_assignee TEXT;
  credential_status "StaffCredentialStatus";
  account_status "AccountStatus";
BEGIN
  new_assignee := to_jsonb(NEW) ->> TG_ARGV[0];
  old_assignee := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ->> TG_ARGV[0] ELSE NULL END;
  IF new_assignee IS NULL OR new_assignee IS NOT DISTINCT FROM old_assignee THEN
    RETURN NEW;
  END IF;

  SELECT sc."status", u."accountStatus"
    INTO credential_status, account_status
  FROM "StaffCredential" AS sc
  JOIN "User" AS u ON u."id" = sc."userId"
  WHERE sc."userId" = new_assignee
  FOR KEY SHARE OF sc;

  IF credential_status IS DISTINCT FROM 'active'::"StaffCredentialStatus"
     OR account_status IS DISTINCT FROM 'active'::"AccountStatus" THEN
    RAISE EXCEPTION 'commercial assignment requires an active StaffCredential';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SupportTicket_active_staff_assignment"
BEFORE INSERT OR UPDATE OF "assignedToUserId" ON "SupportTicket"
FOR EACH ROW EXECUTE FUNCTION enforce_active_commercial_staff_assignment('assignedToUserId');

CREATE TRIGGER "RefundTransaction_active_staff_assignment"
BEFORE INSERT OR UPDATE OF "assignedToUserId" ON "RefundTransaction"
FOR EACH ROW EXECUTE FUNCTION enforce_active_commercial_staff_assignment('assignedToUserId');

CREATE TRIGGER "PaymentDispute_active_staff_assignment"
BEFORE INSERT OR UPDATE OF "assignedSupportUserId" ON "PaymentDispute"
FOR EACH ROW EXECUTE FUNCTION enforce_active_commercial_staff_assignment('assignedSupportUserId');

CREATE TRIGGER "AttendanceDispute_active_staff_assignment"
BEFORE INSERT OR UPDATE OF "assignedToUserId" ON "AttendanceDispute"
FOR EACH ROW EXECUTE FUNCTION enforce_active_commercial_staff_assignment('assignedToUserId');

CREATE TRIGGER "AttendanceDispute_active_staff_appeal_assignment"
BEFORE INSERT OR UPDATE OF "appealAssignedToUserId" ON "AttendanceDispute"
FOR EACH ROW EXECUTE FUNCTION enforce_active_commercial_staff_assignment('appealAssignedToUserId');

CREATE TRIGGER "UserAccountAppeal_active_staff_assignment"
BEFORE INSERT OR UPDATE OF "assignedToUserId" ON "UserAccountAppeal"
FOR EACH ROW EXECUTE FUNCTION enforce_active_commercial_staff_assignment('assignedToUserId');

CREATE TRIGGER "DataRightsRequest_active_staff_assignment"
BEFORE INSERT OR UPDATE OF "handledById" ON "DataRightsRequest"
FOR EACH ROW EXECUTE FUNCTION enforce_active_commercial_staff_assignment('handledById');

CREATE TRIGGER "InvoiceRequest_active_staff_assignment"
BEFORE INSERT OR UPDATE OF "handledById" ON "InvoiceRequest"
FOR EACH ROW EXECUTE FUNCTION enforce_active_commercial_staff_assignment('handledById');

CREATE TRIGGER "CompanionWithdrawalRequest_active_staff_assignment"
BEFORE INSERT OR UPDATE OF "reviewedById" ON "CompanionWithdrawalRequest"
FOR EACH ROW EXECUTE FUNCTION enforce_active_commercial_staff_assignment('reviewedById');
