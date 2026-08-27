ALTER TYPE "MediaAssetPurpose" ADD VALUE IF NOT EXISTS 'userAccountAppeal';
ALTER TYPE "MediaAssetPurpose" ADD VALUE IF NOT EXISTS 'companionAccountAppeal';

ALTER TABLE "MediaAsset"
  ADD COLUMN "userAccountActionId" TEXT,
  ADD COLUMN "companionAccountActionId" TEXT;

ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "MediaAsset_userAccountActionId_fkey"
    FOREIGN KEY ("userAccountActionId") REFERENCES "UserAccountAction"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "MediaAsset_companionAccountActionId_fkey"
    FOREIGN KEY ("companionAccountActionId") REFERENCES "CompanionAccountAction"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MediaAsset"
  DROP CONSTRAINT "MediaAsset_controlled_purpose_scope_check";

ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "MediaAsset_controlled_purpose_scope_check" CHECK (
    (
      "purpose"::TEXT = 'chatMessage'
      AND "conversationId" IS NOT NULL
      AND "supportTicketId" IS NULL
      AND "attendanceDisputeId" IS NULL
      AND "companionId" IS NULL
      AND "userAccountActionId" IS NULL
      AND "companionAccountActionId" IS NULL
    ) OR (
      "purpose"::TEXT = 'orderSupportFact'
      AND "conversationId" IS NULL
      AND "messageId" IS NULL
      AND "supportTicketId" IS NOT NULL
      AND "attendanceDisputeId" IS NULL
      AND "companionId" IS NULL
      AND "userAccountActionId" IS NULL
      AND "companionAccountActionId" IS NULL
      AND "uploadExpiresAt" IS NOT NULL
    ) OR (
      "purpose"::TEXT = 'attendanceDisputeStatement'
      AND "conversationId" IS NULL
      AND "messageId" IS NULL
      AND "supportTicketId" IS NULL
      AND "attendanceDisputeId" IS NOT NULL
      AND "companionId" IS NULL
      AND "userAccountActionId" IS NULL
      AND "companionAccountActionId" IS NULL
      AND "uploadExpiresAt" IS NOT NULL
    ) OR (
      "purpose"::TEXT = 'companionIncidentReport'
      AND "conversationId" IS NULL
      AND "messageId" IS NULL
      AND "supportTicketId" IS NULL
      AND "attendanceDisputeId" IS NULL
      AND "companionId" IS NOT NULL
      AND "userAccountActionId" IS NULL
      AND "companionAccountActionId" IS NULL
      AND "uploadExpiresAt" IS NOT NULL
    ) OR (
      "purpose"::TEXT = 'userAccountAppeal'
      AND "conversationId" IS NULL
      AND "messageId" IS NULL
      AND "supportTicketId" IS NULL
      AND "attendanceDisputeId" IS NULL
      AND "companionId" IS NULL
      AND "userAccountActionId" IS NOT NULL
      AND "companionAccountActionId" IS NULL
      AND "uploadExpiresAt" IS NOT NULL
    ) OR (
      "purpose"::TEXT = 'companionAccountAppeal'
      AND "conversationId" IS NULL
      AND "messageId" IS NULL
      AND "supportTicketId" IS NULL
      AND "attendanceDisputeId" IS NULL
      AND "companionId" IS NULL
      AND "userAccountActionId" IS NULL
      AND "companionAccountActionId" IS NOT NULL
      AND "uploadExpiresAt" IS NOT NULL
    )
  );

CREATE INDEX "MediaAsset_user_appeal_evidence_scope"
  ON "MediaAsset"("purpose", "userAccountActionId", "uploaderId", "status", "createdAt");
CREATE INDEX "MediaAsset_companion_appeal_evidence_scope"
  ON "MediaAsset"("purpose", "companionAccountActionId", "uploaderId", "status", "createdAt");

ALTER TABLE "ControlledCaseEvidenceAttachment"
  ADD COLUMN "userAccountAppealId" TEXT,
  ADD COLUMN "companionAccountAppealId" TEXT;

ALTER TABLE "ControlledCaseEvidenceAttachment"
  DROP CONSTRAINT "ControlledCaseEvidenceAttachment_one_target_check",
  DROP CONSTRAINT "ControlledCaseEvidenceAttachment_purpose_target_check";

ALTER TABLE "ControlledCaseEvidenceAttachment"
  ADD CONSTRAINT "ControlledCaseEvidenceAttachment_one_target_check" CHECK (
    num_nonnulls(
      "orderSupportFactId",
      "attendanceDisputeStatementId",
      "companionIncidentReportId",
      "userAccountAppealId",
      "companionAccountAppealId"
    ) = 1
  ),
  ADD CONSTRAINT "ControlledCaseEvidenceAttachment_purpose_target_check" CHECK (
    ("purpose"::TEXT = 'orderSupportFact' AND "orderSupportFactId" IS NOT NULL)
    OR ("purpose"::TEXT = 'attendanceDisputeStatement' AND "attendanceDisputeStatementId" IS NOT NULL)
    OR ("purpose"::TEXT = 'companionIncidentReport' AND "companionIncidentReportId" IS NOT NULL)
    OR ("purpose"::TEXT = 'userAccountAppeal' AND "userAccountAppealId" IS NOT NULL)
    OR ("purpose"::TEXT = 'companionAccountAppeal' AND "companionAccountAppealId" IS NOT NULL)
  );

ALTER TABLE "ControlledCaseEvidenceAttachment"
  ADD CONSTRAINT "CaseEvidence_user_account_appeal_fk"
    FOREIGN KEY ("userAccountAppealId") REFERENCES "UserAccountAppeal"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CaseEvidence_companion_account_appeal_fk"
    FOREIGN KEY ("companionAccountAppealId") REFERENCES "CompanionAccountAppeal"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "CaseEvidence_user_account_appeal_created"
  ON "ControlledCaseEvidenceAttachment"("userAccountAppealId", "createdAt");
CREATE INDEX "CaseEvidence_companion_account_appeal_created"
  ON "ControlledCaseEvidenceAttachment"("companionAccountAppealId", "createdAt");

-- Historical free-form references cannot be trusted as controlled uploads.
-- Preserve only their count for migration audit and remove the arbitrary values.
ALTER TABLE "CompanionAccountAppeal"
  ADD COLUMN "legacyEvidenceReferenceCount" INTEGER NOT NULL DEFAULT 0;
UPDATE "CompanionAccountAppeal"
SET "legacyEvidenceReferenceCount" = cardinality("evidenceReferences")
WHERE cardinality("evidenceReferences") > 0;
ALTER TABLE "CompanionAccountAppeal" DROP COLUMN "evidenceReferences";

CREATE OR REPLACE FUNCTION "validate_controlled_case_evidence_binding"()
RETURNS TRIGGER AS $$
DECLARE
  asset "MediaAsset"%ROWTYPE;
  target_scope_id TEXT;
  target_owner_id TEXT;
  attachment_count INTEGER;
BEGIN
  IF NEW."boundByUserId" IS NULL THEN
    RAISE EXCEPTION 'controlled case evidence requires an authenticated binder';
  END IF;

  SELECT * INTO asset
  FROM "MediaAsset"
  WHERE "id" = NEW."mediaAssetId"
  FOR UPDATE;

  IF NOT FOUND
     OR asset."purpose" <> NEW."purpose"
     OR asset."status" <> 'approved'
     OR asset."uploaderId" <> NEW."boundByUserId"
     OR asset."storageDeletedAt" IS NOT NULL
     OR asset."expiresAt" IS NULL
     OR asset."expiresAt" <= CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'controlled case evidence asset is not bindable';
  END IF;

  IF NEW."purpose" = 'orderSupportFact' THEN
    SELECT fact."supportTicketId", fact."submittedByUserId"
      INTO target_scope_id, target_owner_id
    FROM "OrderSupportFact" AS fact
    WHERE fact."id" = NEW."orderSupportFactId"
    FOR UPDATE;
    SELECT COUNT(*) INTO attachment_count
    FROM "ControlledCaseEvidenceAttachment"
    WHERE "orderSupportFactId" = NEW."orderSupportFactId";
    IF target_scope_id IS NULL
       OR target_scope_id <> asset."supportTicketId"
       OR target_owner_id IS DISTINCT FROM asset."uploaderId" THEN
      RAISE EXCEPTION 'support evidence scope or owner mismatch';
    END IF;
  ELSIF NEW."purpose" = 'attendanceDisputeStatement' THEN
    SELECT statement."disputeId", statement."submittedByUserId"
      INTO target_scope_id, target_owner_id
    FROM "AttendanceDisputeStatement" AS statement
    WHERE statement."id" = NEW."attendanceDisputeStatementId"
    FOR UPDATE;
    SELECT COUNT(*) INTO attachment_count
    FROM "ControlledCaseEvidenceAttachment"
    WHERE "attendanceDisputeStatementId" = NEW."attendanceDisputeStatementId";
    IF target_scope_id IS NULL
       OR target_scope_id <> asset."attendanceDisputeId"
       OR target_owner_id IS DISTINCT FROM asset."uploaderId" THEN
      RAISE EXCEPTION 'attendance evidence scope or owner mismatch';
    END IF;
  ELSIF NEW."purpose" = 'companionIncidentReport' THEN
    SELECT incident."companionId", companion."ownerUserId"
      INTO target_scope_id, target_owner_id
    FROM "CompanionIncidentReport" AS incident
    JOIN "CompanionProfile" AS companion ON companion."id" = incident."companionId"
    WHERE incident."id" = NEW."companionIncidentReportId"
    FOR UPDATE OF incident;
    SELECT COUNT(*) INTO attachment_count
    FROM "ControlledCaseEvidenceAttachment"
    WHERE "companionIncidentReportId" = NEW."companionIncidentReportId";
    IF target_scope_id IS NULL
       OR target_scope_id <> asset."companionId"
       OR target_owner_id IS DISTINCT FROM asset."uploaderId" THEN
      RAISE EXCEPTION 'companion incident evidence scope or owner mismatch';
    END IF;
  ELSIF NEW."purpose" = 'userAccountAppeal' THEN
    SELECT appeal."actionId", appeal."userId"
      INTO target_scope_id, target_owner_id
    FROM "UserAccountAppeal" AS appeal
    WHERE appeal."id" = NEW."userAccountAppealId"
    FOR UPDATE;
    SELECT COUNT(*) INTO attachment_count
    FROM "ControlledCaseEvidenceAttachment"
    WHERE "userAccountAppealId" = NEW."userAccountAppealId";
    IF target_scope_id IS NULL
       OR target_scope_id <> asset."userAccountActionId"
       OR target_owner_id IS DISTINCT FROM asset."uploaderId" THEN
      RAISE EXCEPTION 'user account appeal evidence scope or owner mismatch';
    END IF;
  ELSIF NEW."purpose" = 'companionAccountAppeal' THEN
    SELECT appeal."actionId", companion."ownerUserId"
      INTO target_scope_id, target_owner_id
    FROM "CompanionAccountAppeal" AS appeal
    JOIN "CompanionProfile" AS companion ON companion."id" = appeal."companionId"
    WHERE appeal."id" = NEW."companionAccountAppealId"
    FOR UPDATE OF appeal;
    SELECT COUNT(*) INTO attachment_count
    FROM "ControlledCaseEvidenceAttachment"
    WHERE "companionAccountAppealId" = NEW."companionAccountAppealId";
    IF target_scope_id IS NULL
       OR target_scope_id <> asset."companionAccountActionId"
       OR target_owner_id IS DISTINCT FROM asset."uploaderId" THEN
      RAISE EXCEPTION 'companion account appeal evidence scope or owner mismatch';
    END IF;
  ELSE
    RAISE EXCEPTION 'chat media cannot be bound as controlled case evidence';
  END IF;

  IF attachment_count >= 3 THEN
    RAISE EXCEPTION 'controlled case evidence attachment limit reached';
  END IF;

  UPDATE "MediaAsset"
  SET "expiresAt" = GREATEST("expiresAt", CURRENT_TIMESTAMP + INTERVAL '180 days'),
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE "id" = NEW."mediaAssetId";

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "prevent_controlled_case_evidence_rebinding"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."mediaAssetId" IS DISTINCT FROM OLD."mediaAssetId"
     OR NEW."purpose" IS DISTINCT FROM OLD."purpose"
     OR NEW."orderSupportFactId" IS DISTINCT FROM OLD."orderSupportFactId"
     OR NEW."attendanceDisputeStatementId" IS DISTINCT FROM OLD."attendanceDisputeStatementId"
     OR NEW."companionIncidentReportId" IS DISTINCT FROM OLD."companionIncidentReportId"
     OR NEW."userAccountAppealId" IS DISTINCT FROM OLD."userAccountAppealId"
     OR NEW."companionAccountAppealId" IS DISTINCT FROM OLD."companionAccountAppealId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
     OR (OLD."boundByUserId" IS NULL AND NEW."boundByUserId" IS NOT NULL)
     OR (OLD."boundByUserId" IS NOT NULL AND NEW."boundByUserId" IS NOT NULL AND NEW."boundByUserId" <> OLD."boundByUserId") THEN
    RAISE EXCEPTION 'controlled case evidence bindings are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
