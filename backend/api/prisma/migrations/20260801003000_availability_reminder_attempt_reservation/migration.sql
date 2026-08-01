-- A handoff is not deliverable until the production preparation runner has
-- either bound it to a durable attempt or terminally skipped that immutable
-- window-version event after a fresh live recheck. Keeping this marker on the
-- handoff lets every API replica drain old handoffs without an in-memory cursor
-- and prevents permanently ineligible rows from starving newer work.
ALTER TABLE "AvailabilityReminderHandoff"
  ADD COLUMN "reservationProcessedAt" TIMESTAMP(3),
  ADD COLUMN "reservationOutcomeReason" "AvailabilityReminderAttemptOutcomeReason";

-- Existing attempts were already durably bound; make the migration idempotent
-- with respect to their original reservation boundary.
UPDATE "AvailabilityReminderHandoff" AS handoff
SET "reservationProcessedAt" = attempt."createdAt"
FROM "AvailabilityReminderAttempt" AS attempt
WHERE attempt."handoffId" = handoff."id";

ALTER TABLE "AvailabilityReminderHandoff"
  ADD CONSTRAINT "AvailabilityReminderHandoff_outcome_requires_processed"
  CHECK (
    "reservationOutcomeReason" IS NULL
    OR "reservationProcessedAt" IS NOT NULL
  );

CREATE INDEX "AvailabilityReminderHandoff_reservation_due"
  ON "AvailabilityReminderHandoff"("reservationProcessedAt", "createdAt", "id");
