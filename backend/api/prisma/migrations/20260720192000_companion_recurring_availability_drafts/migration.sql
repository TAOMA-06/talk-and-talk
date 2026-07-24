-- Generated schedule drafts retain an immutable source fingerprint. Both
-- values remain nullable for manually-created windows; the pair is unique only
-- for materialized occurrences, so a repeated private pass cannot duplicate
-- one rule occurrence or overwrite an operator-created explicit window.
ALTER TABLE "CompanionAvailabilityWindow"
  ADD COLUMN "recurringAvailabilityRuleId" TEXT,
  ADD COLUMN "recurringOccurrenceStartsAt" TIMESTAMP(3);

CREATE INDEX "CompanionAvailabilityWindow_companionId_recurringAvailabilityRuleId_recurringOccurrenceStartsAt_idx"
  ON "CompanionAvailabilityWindow"("companionId", "recurringAvailabilityRuleId", "recurringOccurrenceStartsAt");

CREATE UNIQUE INDEX "CompanionAvailabilityWindow_recurringAvailabilityRuleId_recurringOccurrenceStartsAt_key"
  ON "CompanionAvailabilityWindow"("recurringAvailabilityRuleId", "recurringOccurrenceStartsAt");

ALTER TABLE "CompanionAvailabilityWindow"
  ADD CONSTRAINT "CompanionAvailabilityWindow_recurringAvailabilityRuleId_fkey"
  FOREIGN KEY ("recurringAvailabilityRuleId") REFERENCES "CompanionRecurringAvailabilityRule"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
