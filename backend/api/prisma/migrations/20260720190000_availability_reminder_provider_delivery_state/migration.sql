-- A provider call is represented separately from grant consumption. Once the
-- remote boundary is crossed, a process crash is always quarantined rather
-- than retried automatically, because one-time subscription sends may already
-- have reached WeChat.
ALTER TYPE "AvailabilityReminderAttemptStatus" ADD VALUE IF NOT EXISTS 'sending';
ALTER TYPE "AvailabilityReminderAttemptStatus" ADD VALUE IF NOT EXISTS 'sent';
ALTER TYPE "AvailabilityReminderAttemptStatus" ADD VALUE IF NOT EXISTS 'failedBeforeSend';
ALTER TYPE "AvailabilityReminderAttemptStatus" ADD VALUE IF NOT EXISTS 'rejected';

ALTER TYPE "AvailabilityReminderAttemptOutcomeReason" ADD VALUE IF NOT EXISTS 'providerSkipped';
ALTER TYPE "AvailabilityReminderAttemptOutcomeReason" ADD VALUE IF NOT EXISTS 'providerPreSendFailed';
ALTER TYPE "AvailabilityReminderAttemptOutcomeReason" ADD VALUE IF NOT EXISTS 'providerRejected';
ALTER TYPE "AvailabilityReminderAttemptOutcomeReason" ADD VALUE IF NOT EXISTS 'providerUnknown';

ALTER TABLE "AvailabilityReminderAttempt"
ADD COLUMN "providerAttemptStartedAt" TIMESTAMP(3),
ADD COLUMN "providerResolvedAt" TIMESTAMP(3),
ADD COLUMN "providerMessageId" TEXT,
ADD COLUMN "providerErrorCode" TEXT;

CREATE INDEX "AvailabilityReminderAttempt_status_providerAttemptStartedAt_idx"
ON "AvailabilityReminderAttempt"("status", "providerAttemptStartedAt");
