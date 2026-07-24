-- Existing orders stay on the legacy pricing path. New orders can retain a
-- reference to the selected offering while freezing every commercial field
-- needed to explain the charge after the offering is edited or retired.
ALTER TABLE "Order"
  ADD COLUMN "serviceOfferingId" TEXT,
  ADD COLUMN "serviceOfferingCodeSnapshot" TEXT,
  ADD COLUMN "serviceOfferingTitleSnapshot" TEXT,
  ADD COLUMN "serviceOfferingDeliveryModeSnapshot" "CompanionServiceOfferingMode",
  ADD COLUMN "serviceOfferingDurationSnapshot" INTEGER,
  ADD COLUMN "serviceOfferingPriceCentsSnapshot" INTEGER,
  ADD COLUMN "serviceOfferingCurrencySnapshot" TEXT;

CREATE INDEX "Order_serviceOfferingId_idx" ON "Order"("serviceOfferingId");

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_serviceOfferingId_fkey"
  FOREIGN KEY ("serviceOfferingId") REFERENCES "CompanionServiceOffering"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
