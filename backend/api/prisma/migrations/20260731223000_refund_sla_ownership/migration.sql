ALTER TABLE "RefundTransaction"
  ADD COLUMN "assignedToUserId" TEXT,
  ADD COLUMN "assignedAt" TIMESTAMP(3),
  ADD COLUMN "reviewDueAt" TIMESTAMP(3),
  ADD COLUMN "resolutionDueAt" TIMESTAMP(3);

UPDATE "RefundTransaction"
SET
  "reviewDueAt" = CASE
    WHEN "status" = 'pendingReview' THEN "createdAt" + INTERVAL '24 hours'
    ELSE NULL
  END,
  "resolutionDueAt" = "createdAt" + INTERVAL '72 hours';

ALTER TABLE "RefundTransaction"
  ALTER COLUMN "resolutionDueAt" SET NOT NULL,
  ADD CONSTRAINT "RefundTransaction_assignment_pair_check"
    CHECK (
      ("assignedToUserId" IS NULL AND "assignedAt" IS NULL)
      OR
      ("assignedToUserId" IS NOT NULL AND "assignedAt" IS NOT NULL)
    ),
  ADD CONSTRAINT "RefundTransaction_review_due_state_check"
    CHECK (
      "reviewDueAt" IS NULL
      OR "reviewDueAt" >= "createdAt"
    ),
  ADD CONSTRAINT "RefundTransaction_resolution_due_check"
    CHECK ("resolutionDueAt" >= "createdAt"),
  ADD CONSTRAINT "RefundTransaction_assignedToUserId_fkey"
    FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "RefundTransaction_assignedToUserId_status_idx"
  ON "RefundTransaction"("assignedToUserId", "status");

CREATE INDEX "RefundTransaction_status_reviewDueAt_idx"
  ON "RefundTransaction"("status", "reviewDueAt");

CREATE INDEX "RefundTransaction_status_resolutionDueAt_idx"
  ON "RefundTransaction"("status", "resolutionDueAt");
