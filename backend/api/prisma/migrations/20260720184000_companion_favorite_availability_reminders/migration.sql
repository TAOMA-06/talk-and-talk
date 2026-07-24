-- A customer may arm one private, one-time subscription grant for one
-- currently saved companion. This migration only stores intent; it does not
-- create notification deliveries or a schedule.
ALTER TABLE "CompanionFavorite"
ADD COLUMN "availabilityReminderEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "availabilityReminderGrantId" TEXT,
ADD COLUMN "availabilityReminderUpdatedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "CompanionFavorite_availabilityReminderGrantId_key"
ON "CompanionFavorite"("availabilityReminderGrantId");

CREATE INDEX "CompanionFavorite_companionId_availabilityReminderEnabled_idx"
ON "CompanionFavorite"("companionId", "availabilityReminderEnabled");
