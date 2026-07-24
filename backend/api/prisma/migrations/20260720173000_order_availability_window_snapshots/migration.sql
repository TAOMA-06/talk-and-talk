-- A structured reservation keeps both its live window relation and a compact
-- snapshot. The relation protects the scheduling record from deletion while
-- an order exists; snapshots keep the booked terms intelligible if a future
-- provider workflow retires or edits the window.
ALTER TABLE "Order"
  ADD COLUMN "availabilityWindowId" TEXT,
  ADD COLUMN "availabilityWindowStartsAtSnapshot" TIMESTAMP(3),
  ADD COLUMN "availabilityWindowEndsAtSnapshot" TIMESTAMP(3),
  ADD COLUMN "availabilityWindowCapacitySnapshot" INTEGER;

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_availabilityWindow_snapshot_check"
  CHECK (
    (
      "availabilityWindowId" IS NULL
      AND "availabilityWindowStartsAtSnapshot" IS NULL
      AND "availabilityWindowEndsAtSnapshot" IS NULL
      AND "availabilityWindowCapacitySnapshot" IS NULL
    )
    OR (
      "availabilityWindowId" IS NOT NULL
      AND "availabilityWindowStartsAtSnapshot" IS NOT NULL
      AND "availabilityWindowEndsAtSnapshot" IS NOT NULL
      AND "availabilityWindowCapacitySnapshot" IS NOT NULL
      AND "availabilityWindowEndsAtSnapshot" > "availabilityWindowStartsAtSnapshot"
      AND "availabilityWindowCapacitySnapshot" >= 1
      AND "availabilityWindowCapacitySnapshot" <= 20
    )
  );

CREATE INDEX "Order_availabilityWindowId_idx" ON "Order"("availabilityWindowId");

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_availabilityWindowId_fkey"
  FOREIGN KEY ("availabilityWindowId") REFERENCES "CompanionAvailabilityWindow"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
