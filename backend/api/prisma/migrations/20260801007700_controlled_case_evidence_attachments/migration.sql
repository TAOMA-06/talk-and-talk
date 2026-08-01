ALTER TYPE "MediaAssetStatus" ADD VALUE IF NOT EXISTS 'reviewRequired';

CREATE TYPE "MediaAssetPurpose" AS ENUM (
  'chatMessage',
  'orderSupportFact',
  'attendanceDisputeStatement',
  'companionIncidentReport'
);

ALTER TABLE "MediaAsset"
  ALTER COLUMN "conversationId" DROP NOT NULL,
  ADD COLUMN "purpose" "MediaAssetPurpose" NOT NULL DEFAULT 'chatMessage',
  ADD COLUMN "supportTicketId" TEXT,
  ADD COLUMN "attendanceDisputeId" TEXT,
  ADD COLUMN "companionId" TEXT,
  ADD COLUMN "uploadExpiresAt" TIMESTAMP(3),
  ADD COLUMN "moderationProcessingToken" TEXT,
  ADD COLUMN "moderationProcessingAt" TIMESTAMP(3);

ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "MediaAsset_supportTicketId_fkey"
    FOREIGN KEY ("supportTicketId") REFERENCES "SupportTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "MediaAsset_attendanceDisputeId_fkey"
    FOREIGN KEY ("attendanceDisputeId") REFERENCES "AttendanceDispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "MediaAsset_companionId_fkey"
    FOREIGN KEY ("companionId") REFERENCES "CompanionProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "MediaAsset_controlled_purpose_scope_check" CHECK (
    (
      "purpose" = 'chatMessage'
      AND "conversationId" IS NOT NULL
      AND "supportTicketId" IS NULL
      AND "attendanceDisputeId" IS NULL
      AND "companionId" IS NULL
    ) OR (
      "purpose" = 'orderSupportFact'
      AND "conversationId" IS NULL
      AND "messageId" IS NULL
      AND "supportTicketId" IS NOT NULL
      AND "attendanceDisputeId" IS NULL
      AND "companionId" IS NULL
      AND "uploadExpiresAt" IS NOT NULL
    ) OR (
      "purpose" = 'attendanceDisputeStatement'
      AND "conversationId" IS NULL
      AND "messageId" IS NULL
      AND "supportTicketId" IS NULL
      AND "attendanceDisputeId" IS NOT NULL
      AND "companionId" IS NULL
      AND "uploadExpiresAt" IS NOT NULL
    ) OR (
      "purpose" = 'companionIncidentReport'
      AND "conversationId" IS NULL
      AND "messageId" IS NULL
      AND "supportTicketId" IS NULL
      AND "attendanceDisputeId" IS NULL
      AND "companionId" IS NOT NULL
      AND "uploadExpiresAt" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "MediaAsset_controlled_storage_key_check" CHECK (
    "purpose" = 'chatMessage' OR "storageKey" LIKE 'case-evidence/%'
  );

CREATE UNIQUE INDEX "MediaAsset_moderationProcessingToken_key"
  ON "MediaAsset"("moderationProcessingToken");
CREATE INDEX "MediaAsset_support_evidence_scope"
  ON "MediaAsset"("purpose", "supportTicketId", "uploaderId", "status", "createdAt");
CREATE INDEX "MediaAsset_attendance_evidence_scope"
  ON "MediaAsset"("purpose", "attendanceDisputeId", "uploaderId", "status", "createdAt");
CREATE INDEX "MediaAsset_incident_evidence_scope"
  ON "MediaAsset"("purpose", "companionId", "uploaderId", "status", "createdAt");
CREATE INDEX "MediaAsset_controlled_moderation_queue"
  ON "MediaAsset"("purpose", "status", "nextAttemptAt", "moderationProcessingAt", "createdAt");

CREATE TABLE "ControlledCaseEvidenceAttachment" (
  "id" TEXT NOT NULL,
  "mediaAssetId" TEXT NOT NULL,
  "purpose" "MediaAssetPurpose" NOT NULL,
  "orderSupportFactId" TEXT,
  "attendanceDisputeStatementId" TEXT,
  "companionIncidentReportId" TEXT,
  "boundByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ControlledCaseEvidenceAttachment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ControlledCaseEvidenceAttachment_one_target_check" CHECK (
    num_nonnulls("orderSupportFactId", "attendanceDisputeStatementId", "companionIncidentReportId") = 1
  ),
  CONSTRAINT "ControlledCaseEvidenceAttachment_purpose_target_check" CHECK (
    ("purpose" = 'orderSupportFact' AND "orderSupportFactId" IS NOT NULL)
    OR ("purpose" = 'attendanceDisputeStatement' AND "attendanceDisputeStatementId" IS NOT NULL)
    OR ("purpose" = 'companionIncidentReport' AND "companionIncidentReportId" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "ControlledCaseEvidenceAttachment_mediaAssetId_key"
  ON "ControlledCaseEvidenceAttachment"("mediaAssetId");
CREATE INDEX "CaseEvidence_order_fact_created"
  ON "ControlledCaseEvidenceAttachment"("orderSupportFactId", "createdAt");
CREATE INDEX "CaseEvidence_attendance_statement_created"
  ON "ControlledCaseEvidenceAttachment"("attendanceDisputeStatementId", "createdAt");
CREATE INDEX "CaseEvidence_companion_incident_created"
  ON "ControlledCaseEvidenceAttachment"("companionIncidentReportId", "createdAt");
CREATE INDEX "CaseEvidence_bound_by_created"
  ON "ControlledCaseEvidenceAttachment"("boundByUserId", "createdAt");

ALTER TABLE "ControlledCaseEvidenceAttachment"
  ADD CONSTRAINT "CaseEvidence_media_asset_fk"
    FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CaseEvidence_order_fact_fk"
    FOREIGN KEY ("orderSupportFactId") REFERENCES "OrderSupportFact"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CaseEvidence_attendance_statement_fk"
    FOREIGN KEY ("attendanceDisputeStatementId") REFERENCES "AttendanceDisputeStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CaseEvidence_companion_incident_fk"
    FOREIGN KEY ("companionIncidentReportId") REFERENCES "CompanionIncidentReport"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CaseEvidence_bound_by_fk"
    FOREIGN KEY ("boundByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
       OR target_owner_id <> asset."uploaderId" THEN
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
       OR target_owner_id <> asset."uploaderId" THEN
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
       OR target_owner_id <> asset."uploaderId" THEN
      RAISE EXCEPTION 'companion incident evidence scope or owner mismatch';
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

CREATE TRIGGER "ControlledCaseEvidenceAttachment_validate_insert"
BEFORE INSERT ON "ControlledCaseEvidenceAttachment"
FOR EACH ROW EXECUTE FUNCTION "validate_controlled_case_evidence_binding"();

CREATE OR REPLACE FUNCTION "prevent_controlled_case_evidence_rebinding"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."mediaAssetId" IS DISTINCT FROM OLD."mediaAssetId"
     OR NEW."purpose" IS DISTINCT FROM OLD."purpose"
     OR NEW."orderSupportFactId" IS DISTINCT FROM OLD."orderSupportFactId"
     OR NEW."attendanceDisputeStatementId" IS DISTINCT FROM OLD."attendanceDisputeStatementId"
     OR NEW."companionIncidentReportId" IS DISTINCT FROM OLD."companionIncidentReportId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
     OR (OLD."boundByUserId" IS NULL AND NEW."boundByUserId" IS NOT NULL)
     OR (OLD."boundByUserId" IS NOT NULL AND NEW."boundByUserId" IS NOT NULL AND NEW."boundByUserId" <> OLD."boundByUserId") THEN
    RAISE EXCEPTION 'controlled case evidence bindings are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ControlledCaseEvidenceAttachment_prevent_rebinding"
BEFORE UPDATE ON "ControlledCaseEvidenceAttachment"
FOR EACH ROW EXECUTE FUNCTION "prevent_controlled_case_evidence_rebinding"();

ALTER TABLE "CompanionIncidentReport"
  ADD COLUMN "legacyEvidenceReferenceCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "CompanionIncidentReport"
SET "legacyEvidenceReferenceCount" = cardinality("evidenceReferences")
WHERE cardinality("evidenceReferences") > 0;

ALTER TABLE "CompanionIncidentReport" DROP COLUMN "evidenceReferences";
