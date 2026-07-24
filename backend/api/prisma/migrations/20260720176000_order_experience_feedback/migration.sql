-- This is a private customer-to-platform signal, not a public companion
-- review. One row per order preserves the first submitted feedback without
-- changing the order, refund, or settlement state machine.
CREATE TABLE "OrderExperienceFeedback" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrderExperienceFeedback_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderExperienceFeedback_rating_check" CHECK ("rating" >= 1 AND "rating" <= 5)
);

CREATE UNIQUE INDEX "OrderExperienceFeedback_orderId_key"
  ON "OrderExperienceFeedback"("orderId");
CREATE INDEX "OrderExperienceFeedback_createdAt_idx"
  ON "OrderExperienceFeedback"("createdAt");

ALTER TABLE "OrderExperienceFeedback"
  ADD CONSTRAINT "OrderExperienceFeedback_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
