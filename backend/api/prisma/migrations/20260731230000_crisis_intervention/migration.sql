CREATE TYPE "CrisisInterventionSource" AS ENUM (
  'homeIntent',
  'homeBrowseAll',
  'homeRecommendation',
  'discover',
  'companionDetail',
  'order',
  'chatSafetyRule',
  'directEmergencyHelp'
);

CREATE TYPE "CrisisInterventionRiskCode" AS ENUM (
  'userRequested',
  'selfHarmSignal',
  'violenceSignal',
  'immediateDangerSignal',
  'chatSafetyRule'
);

CREATE TYPE "CrisisInterventionStatus" AS ENUM (
  'resourcesPending',
  'resourcesViewed'
);

CREATE TABLE "CrisisIntervention" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "source" "CrisisInterventionSource" NOT NULL,
  "riskCode" "CrisisInterventionRiskCode" NOT NULL,
  "region" TEXT NOT NULL,
  "resourcePolicyVersion" TEXT NOT NULL,
  "status" "CrisisInterventionStatus" NOT NULL DEFAULT 'resourcesPending',
  "resourcesViewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CrisisIntervention_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CrisisIntervention_one_pending_per_user_key"
  ON "CrisisIntervention"("userId")
  WHERE "status" = 'resourcesPending';
CREATE INDEX "CrisisIntervention_userId_status_createdAt_idx"
  ON "CrisisIntervention"("userId", "status", "createdAt");
CREATE INDEX "CrisisIntervention_status_createdAt_idx"
  ON "CrisisIntervention"("status", "createdAt");

ALTER TABLE "CrisisIntervention"
  ADD CONSTRAINT "CrisisIntervention_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CrisisIntervention"
  ADD CONSTRAINT "CrisisIntervention_region_check"
  CHECK ("region" ~ '^CN(-[0-9]{2})?$');

ALTER TABLE "CrisisIntervention"
  ADD CONSTRAINT "CrisisIntervention_policy_version_check"
  CHECK (
    length("resourcePolicyVersion") BETWEEN 3 AND 64
    AND "resourcePolicyVersion" ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  );

ALTER TABLE "CrisisIntervention"
  ADD CONSTRAINT "CrisisIntervention_state_check"
  CHECK (
    (
      "status" = 'resourcesPending'
      AND "resourcesViewedAt" IS NULL
    )
    OR
    (
      "status" = 'resourcesViewed'
      AND "resourcesViewedAt" IS NOT NULL
      AND "resourcesViewedAt" >= "createdAt"
    )
  );

-- Routing facts cannot be rewritten into a different source, risk, region, or
-- policy after creation. The only permitted transition records resource view.
CREATE FUNCTION "prevent_crisis_intervention_fact_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."userId" IS DISTINCT FROM NEW."userId"
    OR OLD."source" IS DISTINCT FROM NEW."source"
    OR OLD."riskCode" IS DISTINCT FROM NEW."riskCode"
    OR OLD."region" IS DISTINCT FROM NEW."region"
    OR OLD."resourcePolicyVersion" IS DISTINCT FROM NEW."resourcePolicyVersion"
    OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt"
  THEN
    RAISE EXCEPTION 'Crisis intervention routing facts are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."status" = 'resourcesViewed'
    AND (
      NEW."status" IS DISTINCT FROM OLD."status"
      OR NEW."resourcesViewedAt" IS DISTINCT FROM OLD."resourcesViewedAt"
    )
  THEN
    RAISE EXCEPTION 'Completed crisis intervention records are immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CrisisIntervention_immutable_trigger"
BEFORE UPDATE ON "CrisisIntervention"
FOR EACH ROW
EXECUTE FUNCTION "prevent_crisis_intervention_fact_mutation"();
