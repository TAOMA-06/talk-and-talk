CREATE TYPE "CompanionReactivationStatus" AS ENUM (
  'notRequired',
  'required',
  'completed'
);

ALTER TABLE "CompanionAccountAppeal"
  ADD COLUMN "reactivationStatus" "CompanionReactivationStatus" NOT NULL DEFAULT 'notRequired',
  ADD COLUMN "reactivationRequiredAt" TIMESTAMP(3),
  ADD COLUMN "reactivationCompletedAt" TIMESTAMP(3),
  ADD COLUMN "reactivationCompletedById" TEXT,
  ADD COLUMN "reactivationResolution" TEXT;

ALTER TABLE "CompanionAccountAction"
  ADD COLUMN "reactivationStatus" "CompanionReactivationStatus" NOT NULL DEFAULT 'notRequired',
  ADD COLUMN "reactivationRequiredAt" TIMESTAMP(3),
  ADD COLUMN "reactivationCompletedAt" TIMESTAMP(3),
  ADD COLUMN "reactivationCompletedById" TEXT,
  ADD COLUMN "reactivationResolution" TEXT;

ALTER TABLE "CompanionCommercialProfile"
  ADD COLUMN "suspendedByAccountActionId" TEXT;

CREATE UNIQUE INDEX "CompanionCommercialProfile_suspendedByAccountActionId_key"
  ON "CompanionCommercialProfile"("suspendedByAccountActionId");

ALTER TABLE "CompanionCommercialProfile"
  ADD CONSTRAINT "CompanionCommercialProfile_suspendedByAccountActionId_fkey"
  FOREIGN KEY ("suspendedByAccountActionId")
  REFERENCES "CompanionAccountAction"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

UPDATE "CompanionAccountAppeal" AS appeal
SET
  "reactivationStatus" = 'required',
  "reactivationRequiredAt" = COALESCE(appeal."resolvedAt", appeal."updatedAt")
FROM "CompanionAccountAction" AS action
WHERE action."id" = appeal."actionId"
  AND appeal."status" = 'overturned'
  AND action."kind" IN ('serviceRestriction', 'suspension');

CREATE INDEX "CompanionAccountAppeal_reactivationStatus_resolvedAt_idx"
  ON "CompanionAccountAppeal"("reactivationStatus", "resolvedAt");

CREATE INDEX "CompanionAccountAction_reactivationStatus_endsAt_idx"
  ON "CompanionAccountAction"("reactivationStatus", "endsAt");

ALTER TABLE "CompanionAccountAppeal"
  ADD CONSTRAINT "CompanionAccountAppeal_reactivation_state_check"
  CHECK (
    (
      "reactivationStatus" = 'notRequired'
      AND "reactivationRequiredAt" IS NULL
      AND "reactivationCompletedAt" IS NULL
      AND "reactivationCompletedById" IS NULL
      AND "reactivationResolution" IS NULL
    )
    OR (
      "reactivationStatus" = 'required'
      AND "status" = 'overturned'
      AND "reactivationRequiredAt" IS NOT NULL
      AND "reactivationCompletedAt" IS NULL
      AND "reactivationCompletedById" IS NULL
      AND "reactivationResolution" IS NULL
    )
    OR (
      "reactivationStatus" = 'completed'
      AND "status" = 'overturned'
      AND "reactivationRequiredAt" IS NOT NULL
      AND "reactivationCompletedAt" IS NOT NULL
      AND "reactivationCompletedById" IS NOT NULL
      AND "reactivationResolution" IS NOT NULL
    )
  );

ALTER TABLE "CompanionAccountAction"
  ADD CONSTRAINT "CompanionAccountAction_reactivation_state_check"
  CHECK (
    (
      "reactivationStatus" = 'notRequired'
      AND "reactivationRequiredAt" IS NULL
      AND "reactivationCompletedAt" IS NULL
      AND "reactivationCompletedById" IS NULL
      AND "reactivationResolution" IS NULL
    )
    OR (
      "reactivationStatus" = 'required'
      AND "kind" = 'suspension'
      AND "endsAt" IS NOT NULL
      AND "reactivationRequiredAt" IS NOT NULL
      AND "reactivationCompletedAt" IS NULL
      AND "reactivationCompletedById" IS NULL
      AND "reactivationResolution" IS NULL
    )
    OR (
      "reactivationStatus" = 'completed'
      AND "kind" = 'suspension'
      AND "endsAt" IS NOT NULL
      AND "reactivationRequiredAt" IS NOT NULL
      AND "reactivationCompletedAt" IS NOT NULL
      AND "reactivationCompletedById" IS NOT NULL
      AND "reactivationResolution" IS NOT NULL
    )
  );

-- Post-controlled-v2 runtime audit policies. These actions are introduced by
-- this migration/code release, so every new row is born with explicit subject
-- references and does not require rewriting the historical 076 backfill.
-- AUDIT_SUBJECT_POLICY_EXTENSION|commercial.companion_action_reactivation_completed|companionId|companion
-- AUDIT_SUBJECT_POLICY_EXTENSION|commercial.companion_suspension_expiry_reactivation_required|companionId|companion
