-- A candidate is private operational context for a future delivery stage. It
-- is deliberately not a notification, schedule, delivery, or user-visible
-- event, and it carries no chat, order body, or profile-content data.
CREATE TABLE "AvailabilityReminderCandidate" (
    "id" TEXT NOT NULL,
    "favoriteId" TEXT NOT NULL,
    "companionId" TEXT NOT NULL,
    "availabilityWindowId" TEXT NOT NULL,
    "availabilityWindowUpdatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvailabilityReminderCandidate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AvailabilityReminderCandidate_favoriteId_availabilityWindowId_availabilityWindowUpdatedAt_key"
ON "AvailabilityReminderCandidate"("favoriteId", "availabilityWindowId", "availabilityWindowUpdatedAt");

CREATE INDEX "AvailabilityReminderCandidate_favoriteId_createdAt_idx"
ON "AvailabilityReminderCandidate"("favoriteId", "createdAt");

CREATE INDEX "AvailabilityReminderCandidate_companionId_createdAt_idx"
ON "AvailabilityReminderCandidate"("companionId", "createdAt");

CREATE INDEX "AvailabilityReminderCandidate_availabilityWindowId_createdAt_idx"
ON "AvailabilityReminderCandidate"("availabilityWindowId", "createdAt");

ALTER TABLE "AvailabilityReminderCandidate"
ADD CONSTRAINT "AvailabilityReminderCandidate_favoriteId_fkey"
FOREIGN KEY ("favoriteId") REFERENCES "CompanionFavorite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AvailabilityReminderCandidate"
ADD CONSTRAINT "AvailabilityReminderCandidate_companionId_fkey"
FOREIGN KEY ("companionId") REFERENCES "CompanionProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AvailabilityReminderCandidate"
ADD CONSTRAINT "AvailabilityReminderCandidate_availabilityWindowId_fkey"
FOREIGN KEY ("availabilityWindowId") REFERENCES "CompanionAvailabilityWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
