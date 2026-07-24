-- The preflight result is internal, final candidate state. It is intentionally
-- not a Notification, NotificationDelivery, schedule, or provider-send record.
CREATE TYPE "AvailabilityReminderCandidateDecision" AS ENUM ('pending', 'eligible', 'skipped');

CREATE TYPE "AvailabilityReminderCandidateSkipReason" AS ENUM (
    'favoriteUnavailable',
    'authorizationUnavailable',
    'availabilityUnavailable',
    'rateLimited'
);

ALTER TABLE "CompanionFavorite"
ADD COLUMN "availabilityReminderLastDeliveredAt" TIMESTAMP(3);

ALTER TABLE "AvailabilityReminderCandidate"
ADD COLUMN "preflightDecision" "AvailabilityReminderCandidateDecision" NOT NULL DEFAULT 'pending',
ADD COLUMN "preflightReason" "AvailabilityReminderCandidateSkipReason",
ADD COLUMN "preflightedAt" TIMESTAMP(3);

CREATE INDEX "AvailabilityReminderCandidate_preflightDecision_createdAt_idx"
ON "AvailabilityReminderCandidate"("preflightDecision", "createdAt");
