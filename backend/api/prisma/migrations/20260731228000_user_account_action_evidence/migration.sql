CREATE TYPE "UserAccountActionSourceType" AS ENUM (
  'moderationCase',
  'supportTicket',
  'paymentDispute',
  'attendanceDispute',
  'conversationSafety',
  'manualSafetyReview',
  'legalCompliance',
  'userAccountAction'
);

-- Existing rows predate the evidence-chain contract and remain NULL rather
-- than receiving fabricated evidence. Every new restriction/ban created by
-- the application writes the complete four-field snapshot.
ALTER TABLE "UserAccountAction"
ADD COLUMN "sourceType" "UserAccountActionSourceType",
ADD COLUMN "sourceReference" TEXT,
ADD COLUMN "evidenceReference" TEXT,
ADD COLUMN "evidenceDigest" TEXT,
ADD COLUMN "evidenceAnonymizedAt" TIMESTAMP(3);

ALTER TABLE "UserAccountAction"
ADD CONSTRAINT "UserAccountAction_evidence_snapshot_check"
CHECK (
  (
    "sourceType" IS NULL
    AND "sourceReference" IS NULL
    AND "evidenceReference" IS NULL
    AND "evidenceDigest" IS NULL
  )
  OR
  (
    "sourceType" IS NOT NULL
    AND "sourceReference" IS NOT NULL
    AND length("sourceReference") BETWEEN 6 AND 160
    AND "sourceReference" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
    AND "evidenceReference" IS NOT NULL
    AND length("evidenceReference") BETWEEN 6 AND 160
    AND "evidenceReference" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
    AND "evidenceDigest" IS NOT NULL
    AND "evidenceDigest" ~ '^[a-f0-9]{64}$'
  )
);

ALTER TABLE "UserAccountAction"
ADD CONSTRAINT "UserAccountAction_evidence_anonymization_check"
CHECK (
  "evidenceAnonymizedAt" IS NULL
  OR (
    "sourceType" IS NULL
    AND "sourceReference" IS NULL
    AND "evidenceReference" IS NULL
    AND "evidenceDigest" IS NULL
  )
);

CREATE INDEX "UserAccountAction_sourceType_sourceReference_idx"
ON "UserAccountAction"("sourceType", "sourceReference");

CREATE FUNCTION "prevent_user_account_action_evidence_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  -- Retention expiry may perform exactly one irreversible tombstone
  -- transition: clear the complete evidence snapshot and stamp when it was
  -- anonymized. No partial clearing, replacement, or later restoration is
  -- accepted.
  IF OLD."evidenceAnonymizedAt" IS NULL
    AND NEW."evidenceAnonymizedAt" IS NOT NULL
    AND NEW."sourceType" IS NULL
    AND NEW."sourceReference" IS NULL
    AND NEW."evidenceReference" IS NULL
    AND NEW."evidenceDigest" IS NULL
  THEN
    RETURN NEW;
  END IF;

  IF OLD."sourceType" IS DISTINCT FROM NEW."sourceType"
    OR OLD."sourceReference" IS DISTINCT FROM NEW."sourceReference"
    OR OLD."evidenceReference" IS DISTINCT FROM NEW."evidenceReference"
    OR OLD."evidenceDigest" IS DISTINCT FROM NEW."evidenceDigest"
    OR OLD."evidenceAnonymizedAt" IS DISTINCT FROM NEW."evidenceAnonymizedAt"
  THEN
    RAISE EXCEPTION 'UserAccountAction evidence snapshot is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "UserAccountAction_evidence_immutable_trigger"
BEFORE UPDATE OF "sourceType", "sourceReference", "evidenceReference", "evidenceDigest", "evidenceAnonymizedAt"
ON "UserAccountAction"
FOR EACH ROW
EXECUTE FUNCTION "prevent_user_account_action_evidence_mutation"();
