-- Legacy concurrent prepay requests may have left more than one initiated
-- transaction for an order. Keep the newest one active; stale callbacks for
-- the closed rows are rejected by PaymentsService.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "orderId"
      ORDER BY "createdAt" DESC, "id" DESC
    ) AS row_number
  FROM "PaymentTransaction"
  WHERE "status" = 'initiated'
)
UPDATE "PaymentTransaction"
SET "status" = 'closed', "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN (
  SELECT "id" FROM ranked WHERE row_number > 1
);

-- Database-level invariant: at most one externally payable transaction may
-- be active for an order, even if a future code path omits the order row lock.
CREATE UNIQUE INDEX "PaymentTransaction_one_initiated_per_order_key"
ON "PaymentTransaction"("orderId")
WHERE "status" = 'initiated';
