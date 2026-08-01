ALTER TABLE "AccountDeletionRequest"
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "companionReactivationRequired" BOOLEAN NOT NULL DEFAULT false;

-- Historical cancelled requests predate the explicit cancellation outcome.
-- Their last transition timestamp is the safest bounded backfill available.
UPDATE "AccountDeletionRequest"
SET "cancelledAt" = "updatedAt"
WHERE "status" = 'cancelled'
  AND "cancelledAt" IS NULL;

UPDATE "AccountDeletionRequest" AS request
SET "companionReactivationRequired" = true
FROM "CompanionProfile" AS companion
WHERE request."status" = 'cancelled'
  AND companion."ownerUserId" = request."userId";

ALTER TABLE "AccountDeletionRequest"
  ADD CONSTRAINT "AccountDeletionRequest_cancellation_state_check"
  CHECK (
    (
      "status" = 'cancelled'
      AND "cancelledAt" IS NOT NULL
    )
    OR
    (
      "status" <> 'cancelled'
      AND "cancelledAt" IS NULL
      AND "companionReactivationRequired" = false
    )
  );

CREATE OR REPLACE FUNCTION enforce_account_deletion_cancellation_transition()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'cancelled' AND (
    NEW."status" <> 'cancelled'
    OR NEW."cancelledAt" IS DISTINCT FROM OLD."cancelledAt"
    OR NEW."companionReactivationRequired" IS DISTINCT FROM OLD."companionReactivationRequired"
  ) THEN
    RAISE EXCEPTION 'cancelled account deletion evidence is immutable';
  END IF;

  IF NEW."status" = 'cancelled' AND OLD."status" <> 'cancelled' AND OLD."status" <> 'pending' THEN
    RAISE EXCEPTION 'only a pending account deletion request can be cancelled';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "AccountDeletionRequest_cancellation_transition_guard"
  ON "AccountDeletionRequest";
CREATE TRIGGER "AccountDeletionRequest_cancellation_transition_guard"
BEFORE UPDATE ON "AccountDeletionRequest"
FOR EACH ROW
EXECUTE FUNCTION enforce_account_deletion_cancellation_transition();
