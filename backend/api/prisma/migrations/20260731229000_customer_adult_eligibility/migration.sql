CREATE TYPE "CustomerAdultEligibilityStatus" AS ENUM (
  'pending',
  'adult',
  'ineligible'
);

CREATE TYPE "CustomerAdultEligibilityMethod" AS ENUM (
  'externalProvider',
  'governmentNetworkIdentity',
  'secureManualReview'
);

CREATE TABLE "CustomerAdultEligibility" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "CustomerAdultEligibilityStatus" NOT NULL DEFAULT 'pending',
  "verificationMethod" "CustomerAdultEligibilityMethod" NOT NULL,
  "evidenceReference" TEXT NOT NULL,
  "submittedById" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedById" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "validUntil" TIMESTAMP(3),
  "reviewReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CustomerAdultEligibility_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerAdultEligibility_evidenceReference_key"
  ON "CustomerAdultEligibility"("evidenceReference");
CREATE UNIQUE INDEX "CustomerAdultEligibility_one_pending_per_user_key"
  ON "CustomerAdultEligibility"("userId")
  WHERE "status" = 'pending';
CREATE INDEX "CustomerAdultEligibility_status_submittedAt_idx"
  ON "CustomerAdultEligibility"("status", "submittedAt");
CREATE INDEX "CustomerAdultEligibility_userId_submittedAt_idx"
  ON "CustomerAdultEligibility"("userId", "submittedAt");
CREATE INDEX "CustomerAdultEligibility_reviewedById_verifiedAt_idx"
  ON "CustomerAdultEligibility"("reviewedById", "verifiedAt");
CREATE INDEX "CustomerAdultEligibility_status_validUntil_idx"
  ON "CustomerAdultEligibility"("status", "validUntil");

ALTER TABLE "CustomerAdultEligibility"
  ADD CONSTRAINT "CustomerAdultEligibility_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerAdultEligibility"
  ADD CONSTRAINT "CustomerAdultEligibility_submittedById_fkey"
  FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerAdultEligibility"
  ADD CONSTRAINT "CustomerAdultEligibility_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerAdultEligibility"
  ADD CONSTRAINT "CustomerAdultEligibility_self_submission_check"
  CHECK ("userId" = "submittedById");

ALTER TABLE "CustomerAdultEligibility"
  ADD CONSTRAINT "CustomerAdultEligibility_independent_review_check"
  CHECK ("reviewedById" IS NULL OR "reviewedById" <> "submittedById");

ALTER TABLE "CustomerAdultEligibility"
  ADD CONSTRAINT "CustomerAdultEligibility_evidence_reference_check"
  CHECK (
    length("evidenceReference") BETWEEN 7 AND 160
    AND "evidenceReference" ~ '^[A-Za-z][A-Za-z0-9._-]{1,31}:[A-Za-z0-9][A-Za-z0-9._:/-]{4,127}$'
    AND "evidenceReference" !~ '[0-9]{10,}'
  );

ALTER TABLE "CustomerAdultEligibility"
  ADD CONSTRAINT "CustomerAdultEligibility_state_check"
  CHECK (
    (
      "status" = 'pending'
      AND "reviewedById" IS NULL
      AND "verifiedAt" IS NULL
      AND "validUntil" IS NULL
      AND "reviewReason" IS NULL
    )
    OR
    (
      "status" = 'adult'
      AND "reviewedById" IS NOT NULL
      AND "verifiedAt" IS NOT NULL
      AND "validUntil" IS NOT NULL
      AND "validUntil" > "verifiedAt"
      AND "reviewReason" IS NOT NULL
    )
    OR
    (
      "status" = 'ineligible'
      AND "reviewedById" IS NOT NULL
      AND "verifiedAt" IS NOT NULL
      AND "validUntil" IS NULL
      AND "reviewReason" IS NOT NULL
    )
  );

CREATE FUNCTION "prevent_customer_adult_eligibility_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" <> 'pending' THEN
    RAISE EXCEPTION 'Reviewed customer adult eligibility records are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."userId" IS DISTINCT FROM NEW."userId"
    OR OLD."verificationMethod" IS DISTINCT FROM NEW."verificationMethod"
    OR OLD."evidenceReference" IS DISTINCT FROM NEW."evidenceReference"
    OR OLD."submittedById" IS DISTINCT FROM NEW."submittedById"
    OR OLD."submittedAt" IS DISTINCT FROM NEW."submittedAt"
  THEN
    RAISE EXCEPTION 'Customer adult eligibility submission evidence is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CustomerAdultEligibility_immutable_trigger"
BEFORE UPDATE ON "CustomerAdultEligibility"
FOR EACH ROW
EXECUTE FUNCTION "prevent_customer_adult_eligibility_mutation"();
