-- Weekly availability rules and one-off blackouts are planning inputs only.
-- They do not replace existing explicit windows, create orders, or provide a
-- public availability guarantee until a later materialization feature exists.
CREATE TABLE "CompanionRecurringAvailabilityRule" (
  "id" TEXT NOT NULL,
  "companionId" TEXT NOT NULL,
  "weekday" INTEGER NOT NULL,
  "startsAtMinute" INTEGER NOT NULL,
  "endsAtMinute" INTEGER NOT NULL,
  "capacity" INTEGER NOT NULL DEFAULT 1,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CompanionRecurringAvailabilityRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CompanionRecurringAvailabilityRule_weekday_check" CHECK ("weekday" >= 0 AND "weekday" <= 6),
  CONSTRAINT "CompanionRecurringAvailabilityRule_start_minute_check" CHECK (
    "startsAtMinute" >= 0 AND "startsAtMinute" <= 1410 AND "startsAtMinute" % 30 = 0
  ),
  CONSTRAINT "CompanionRecurringAvailabilityRule_end_minute_check" CHECK (
    "endsAtMinute" >= 30 AND "endsAtMinute" <= 1440 AND "endsAtMinute" % 30 = 0
  ),
  CONSTRAINT "CompanionRecurringAvailabilityRule_range_check" CHECK ("endsAtMinute" > "startsAtMinute"),
  CONSTRAINT "CompanionRecurringAvailabilityRule_capacity_check" CHECK ("capacity" >= 1 AND "capacity" <= 10),
  CONSTRAINT "CompanionRecurringAvailabilityRule_timezone_check" CHECK ("timezone" = 'Asia/Shanghai')
);

CREATE INDEX "CompanionRecurringAvailabilityRule_companionId_isActive_weekday_startsAtMinute_idx"
  ON "CompanionRecurringAvailabilityRule"("companionId", "isActive", "weekday", "startsAtMinute");

ALTER TABLE "CompanionRecurringAvailabilityRule"
  ADD CONSTRAINT "CompanionRecurringAvailabilityRule_companionId_fkey"
  FOREIGN KEY ("companionId") REFERENCES "CompanionProfile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CompanionAvailabilityBlackout" (
  "id" TEXT NOT NULL,
  "companionId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CompanionAvailabilityBlackout_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CompanionAvailabilityBlackout_range_check" CHECK ("endsAt" > "startsAt"),
  CONSTRAINT "CompanionAvailabilityBlackout_start_alignment_check" CHECK (
    EXTRACT(EPOCH FROM "startsAt")::BIGINT % 1800 = 0
  ),
  CONSTRAINT "CompanionAvailabilityBlackout_end_alignment_check" CHECK (
    EXTRACT(EPOCH FROM "endsAt")::BIGINT % 1800 = 0
  ),
  CONSTRAINT "CompanionAvailabilityBlackout_duration_check" CHECK ("endsAt" <= "startsAt" + INTERVAL '31 days'),
  CONSTRAINT "CompanionAvailabilityBlackout_timezone_check" CHECK ("timezone" = 'Asia/Shanghai')
);

CREATE INDEX "CompanionAvailabilityBlackout_companionId_isActive_startsAt_idx"
  ON "CompanionAvailabilityBlackout"("companionId", "isActive", "startsAt");
CREATE INDEX "CompanionAvailabilityBlackout_companionId_isActive_endsAt_idx"
  ON "CompanionAvailabilityBlackout"("companionId", "isActive", "endsAt");

ALTER TABLE "CompanionAvailabilityBlackout"
  ADD CONSTRAINT "CompanionAvailabilityBlackout_companionId_fkey"
  FOREIGN KEY ("companionId") REFERENCES "CompanionProfile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
