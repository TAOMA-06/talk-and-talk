-- Multiple active/full-refund attempts for one order require manual financial
-- reconciliation. Refuse to hide legacy duplicates during deployment.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "RefundTransaction"
    WHERE "status" IN ('pendingReview', 'pending', 'processing', 'success', 'failed')
    GROUP BY "orderId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate active refund transactions require manual reconciliation';
  END IF;
END $$;

CREATE UNIQUE INDEX "RefundTransaction_one_active_per_order_key"
ON "RefundTransaction"("orderId")
WHERE "status" IN ('pendingReview', 'pending', 'processing', 'success', 'failed');
