-- Commercial settlement must not become payable while a customer refund
-- request can still be opened. Existing rows remain NULL and are evaluated
-- against completedAt plus the runtime policy so deployments can choose the
-- approved window without a destructive backfill.
ALTER TABLE "Order" ADD COLUMN "refundRequestDeadlineAt" TIMESTAMP(3);

CREATE INDEX "Order_status_refundRequestDeadlineAt_idx"
ON "Order"("status", "refundRequestDeadlineAt");
