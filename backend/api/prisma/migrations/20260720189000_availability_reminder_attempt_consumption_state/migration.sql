-- A consumed availability-reminder authorization is never treated as proof of
-- a remote send. A short private lease grants a future provider stage the
-- right to attempt delivery; an expired lease becomes uncertain, never ready
-- again, so a crash cannot silently cause a duplicate send.
ALTER TYPE "AvailabilityReminderAttemptStatus" ADD VALUE IF NOT EXISTS 'readyToSend';
ALTER TYPE "AvailabilityReminderAttemptStatus" ADD VALUE IF NOT EXISTS 'skipped';
ALTER TYPE "AvailabilityReminderAttemptStatus" ADD VALUE IF NOT EXISTS 'uncertain';

CREATE TYPE "AvailabilityReminderAttemptOutcomeReason" AS ENUM (
    'favoriteUnavailable',
    'authorizationUnavailable',
    'availabilityUnavailable',
    'rateLimited',
    'handoffUnavailable',
    'preflightUnavailable',
    'sendLeaseExpired'
);

ALTER TABLE "AvailabilityReminderAttempt"
ADD COLUMN "outcomeReason" "AvailabilityReminderAttemptOutcomeReason",
ADD COLUMN "authorizationConsumedAt" TIMESTAMP(3),
ADD COLUMN "sendLeaseToken" TEXT,
ADD COLUMN "sendLeaseExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "AvailabilityReminderAttempt_sendLeaseToken_key"
ON "AvailabilityReminderAttempt"("sendLeaseToken");

CREATE INDEX "AvailabilityReminderAttempt_status_sendLeaseExpiresAt_idx"
ON "AvailabilityReminderAttempt"("status", "sendLeaseExpiresAt");
