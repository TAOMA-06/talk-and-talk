-- Provider terminal facts remain immutable. These columns record only that an
-- operator reconciled the incident and explicitly acknowledged no automatic
-- resend; readiness can then distinguish unresolved from retained history.
ALTER TABLE "AvailabilityReminderAttempt"
  ADD COLUMN "operationalResolvedAt" TIMESTAMP(3),
  ADD COLUMN "operationalResolvedById" TEXT,
  ADD COLUMN "operationalResolutionCode" TEXT,
  ADD COLUMN "operationalResolutionNote" TEXT,
  ADD COLUMN "operationalEvidenceRef" TEXT;

ALTER TABLE "AvailabilityReminderAttempt"
  ADD CONSTRAINT "AvailabilityReminderAttempt_operational_resolution_all_or_none"
  CHECK (
    (
      "operationalResolvedAt" IS NULL
      AND "operationalResolvedById" IS NULL
      AND "operationalResolutionCode" IS NULL
      AND "operationalResolutionNote" IS NULL
      AND "operationalEvidenceRef" IS NULL
    )
    OR (
      "operationalResolvedAt" IS NOT NULL
      AND "operationalResolvedById" IS NOT NULL
      AND "operationalResolutionCode" IS NOT NULL
    )
  );

ALTER TABLE "AvailabilityReminderAttempt"
  ADD CONSTRAINT "AvailabilityReminderAttempt_resolution_matches_terminal_status"
  CHECK (
    "operationalResolvedAt" IS NULL
    OR ("status"::text = 'failedBeforeSend' AND "operationalResolutionCode" = 'failedBeforeSendReviewed')
    OR ("status"::text = 'rejected' AND "operationalResolutionCode" = 'providerRejectedReviewed')
    OR ("status"::text = 'uncertain' AND "operationalResolutionCode" = 'uncertainProviderStateReconciled')
  );

ALTER TABLE "AvailabilityReminderAttempt"
  ADD CONSTRAINT "AvailabilityReminderAttempt_operationalResolvedById_fkey"
  FOREIGN KEY ("operationalResolvedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "AvailabilityReminderAttempt_terminal_resolution"
  ON "AvailabilityReminderAttempt"("status", "operationalResolvedAt", "createdAt", "id");
CREATE INDEX "AvailabilityReminderAttempt_operational_resolver"
  ON "AvailabilityReminderAttempt"("operationalResolvedById", "operationalResolvedAt");

-- Once the provider boundary has produced a terminal fact, neither a manual
-- action nor a later worker may rewrite it into a resendable or more favorable
-- state. Operational resolution fields remain independently writable/audited.
CREATE OR REPLACE FUNCTION "prevent_availability_reminder_terminal_fact_rewrite"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status"::text IN ('sent', 'skipped', 'failedBeforeSend', 'rejected', 'uncertain')
    AND (
      NEW."handoffId" IS DISTINCT FROM OLD."handoffId"
      OR NEW."subscriptionGrantId" IS DISTINCT FROM OLD."subscriptionGrantId"
      OR NEW."status" IS DISTINCT FROM OLD."status"
      OR NEW."outcomeReason" IS DISTINCT FROM OLD."outcomeReason"
      OR NEW."authorizationConsumedAt" IS DISTINCT FROM OLD."authorizationConsumedAt"
      OR NEW."sendLeaseToken" IS DISTINCT FROM OLD."sendLeaseToken"
      OR NEW."sendLeaseExpiresAt" IS DISTINCT FROM OLD."sendLeaseExpiresAt"
      OR NEW."providerAttemptStartedAt" IS DISTINCT FROM OLD."providerAttemptStartedAt"
      OR NEW."providerResolvedAt" IS DISTINCT FROM OLD."providerResolvedAt"
      OR NEW."providerMessageId" IS DISTINCT FROM OLD."providerMessageId"
      OR NEW."providerErrorCode" IS DISTINCT FROM OLD."providerErrorCode"
    )
  THEN
    RAISE EXCEPTION 'availability reminder terminal provider facts are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."operationalResolvedAt" IS NOT NULL
    AND (
      NEW."operationalResolvedAt" IS DISTINCT FROM OLD."operationalResolvedAt"
      OR NEW."operationalResolvedById" IS DISTINCT FROM OLD."operationalResolvedById"
      OR NEW."operationalResolutionCode" IS DISTINCT FROM OLD."operationalResolutionCode"
      OR NEW."operationalResolutionNote" IS DISTINCT FROM OLD."operationalResolutionNote"
      OR NEW."operationalEvidenceRef" IS DISTINCT FROM OLD."operationalEvidenceRef"
    )
  THEN
    RAISE EXCEPTION 'availability reminder operational resolution is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AvailabilityReminderAttempt_terminal_fact_immutable"
BEFORE UPDATE ON "AvailabilityReminderAttempt"
FOR EACH ROW
EXECUTE FUNCTION "prevent_availability_reminder_terminal_fact_rewrite"();
