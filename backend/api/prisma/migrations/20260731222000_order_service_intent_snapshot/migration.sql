CREATE TYPE "OrderServiceIntent" AS ENUM (
  'listen',
  'comfort',
  'organize',
  'advice',
  'lightCompanionship'
);

ALTER TABLE "Order"
  ADD COLUMN "serviceIntentSnapshot" "OrderServiceIntent",
  ADD COLUMN "serviceIntentPolicyVersionSnapshot" TEXT NOT NULL DEFAULT 'legacy';

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_service_intent_snapshot_pair_check"
  CHECK (
    (
      "serviceIntentSnapshot" IS NULL
      AND "serviceIntentPolicyVersionSnapshot" = 'legacy'
    )
    OR
    (
      "serviceIntentSnapshot" IS NOT NULL
      AND length(btrim("serviceIntentPolicyVersionSnapshot")) > 0
      AND "serviceIntentPolicyVersionSnapshot" <> 'legacy'
    )
  );

CREATE INDEX "Order_serviceIntentSnapshot_createdAt_idx"
  ON "Order"("serviceIntentSnapshot", "createdAt");
