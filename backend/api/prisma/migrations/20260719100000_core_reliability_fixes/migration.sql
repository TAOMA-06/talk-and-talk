-- Core reliability follow-up: an explicit payment reservation prevents a
-- companion from confirming overlapping appointments, while a short-lived
-- moderation lease gives media workers a compare-and-set claim protocol.

ALTER TABLE "Order"
  ADD COLUMN "paymentReservationExpiresAt" TIMESTAMP(3);

ALTER TABLE "Message"
  ADD COLUMN "moderationProcessingToken" TEXT,
  ADD COLUMN "moderationProcessingAt" TIMESTAMP(3);

ALTER TABLE "ModerationCase"
  ADD COLUMN "automaticCaseKey" TEXT;

CREATE INDEX "Order_companionId_paymentReservationExpiresAt_idx"
  ON "Order"("companionId", "paymentReservationExpiresAt");

CREATE INDEX "Message_moderationStatus_moderationProcessingAt_idx"
  ON "Message"("moderationStatus", "moderationProcessingAt");

-- A media message has one automatic chat case. Reports remain independent so
-- multiple users can report the same message without losing their evidence.
CREATE UNIQUE INDEX "ModerationCase_automaticCaseKey_key"
  ON "ModerationCase"("automaticCaseKey");
