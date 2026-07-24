-- Keep each participant's pre-service acknowledgement as an independent
-- order fact. These fields are intentionally nullable so historical orders
-- retain their original lifecycle and confirmation remains optional.
ALTER TABLE "Order"
  ADD COLUMN "customerServiceGuidelinesConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "companionServiceGuidelinesConfirmedAt" TIMESTAMP(3);
