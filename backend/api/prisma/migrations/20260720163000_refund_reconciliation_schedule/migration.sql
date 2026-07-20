-- Persist refund query scheduling so restarts and multiple API replicas do not
-- lose, flood, or duplicate provider reconciliation work.
ALTER TABLE "RefundTransaction"
  ADD COLUMN "providerQueryAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextReconcileAt" TIMESTAMP(3);

-- Existing in-flight refunds become immediately eligible for the first
-- reconciliation pass after deployment.
UPDATE "RefundTransaction"
SET "nextReconcileAt" = "updatedAt"
WHERE "status" = 'processing';

CREATE INDEX "RefundTransaction_status_nextReconcileAt_idx"
ON "RefundTransaction"("status", "nextReconcileAt");
