-- Availability windows are explicit UTC instants. The public API expands a
-- window into service-duration candidates, leaving legacy availableTimes
-- untouched for clients that have not yet adopted structured scheduling.
CREATE TABLE "CompanionAvailabilityWindow" (
  "id" TEXT NOT NULL,
  "companionId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "capacity" INTEGER NOT NULL DEFAULT 1,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CompanionAvailabilityWindow_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CompanionAvailabilityWindow_time_range_check" CHECK ("endsAt" > "startsAt"),
  CONSTRAINT "CompanionAvailabilityWindow_capacity_check" CHECK ("capacity" >= 1 AND "capacity" <= 20)
);

CREATE INDEX "CompanionAvailabilityWindow_companionId_isActive_startsAt_idx"
  ON "CompanionAvailabilityWindow"("companionId", "isActive", "startsAt");
CREATE INDEX "CompanionAvailabilityWindow_companionId_isActive_endsAt_idx"
  ON "CompanionAvailabilityWindow"("companionId", "isActive", "endsAt");

ALTER TABLE "CompanionAvailabilityWindow"
  ADD CONSTRAINT "CompanionAvailabilityWindow_companionId_fkey"
  FOREIGN KEY ("companionId") REFERENCES "CompanionProfile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
