-- Availability reminder fanout must never enumerate every bookmark in the
-- owner calendar transaction. One durable job is expanded by a bounded,
-- lease-protected worker after that transaction commits.
CREATE TYPE "AvailabilityReminderFanoutStatus" AS ENUM (
  'pending',
  'processing',
  'retryScheduled',
  'completed',
  'failed'
);

CREATE TABLE "AvailabilityReminderFanoutJob" (
  "id" TEXT NOT NULL,
  "companionId" TEXT NOT NULL,
  "availabilityWindowId" TEXT NOT NULL,
  "availabilityWindowUpdatedAt" TIMESTAMP(3) NOT NULL,
  "audienceCutoffAt" TIMESTAMP(3) NOT NULL,
  "status" "AvailabilityReminderFanoutStatus" NOT NULL DEFAULT 'pending',
  "cursorUserId" TEXT,
  "cursorFavoriteId" TEXT,
  "scannedCount" INTEGER NOT NULL DEFAULT 0,
  "candidateCreatedCount" INTEGER NOT NULL DEFAULT 0,
  "failureCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AvailabilityReminderFanoutJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AvailabilityReminderFanoutJob_nonnegative_counts" CHECK (
    "scannedCount" >= 0 AND "candidateCreatedCount" >= 0 AND "failureCount" >= 0
  ),
  CONSTRAINT "AvailabilityReminderFanoutJob_cursor_pair" CHECK (
    ("cursorUserId" IS NULL AND "cursorFavoriteId" IS NULL)
    OR ("cursorUserId" IS NOT NULL AND "cursorFavoriteId" IS NOT NULL)
  ),
  CONSTRAINT "AvailabilityReminderFanoutJob_lease_state" CHECK (
    ("status" = 'processing' AND "leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL)
    OR
    ("status" <> 'processing' AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL)
  ),
  CONSTRAINT "AvailabilityReminderFanoutJob_terminal_state" CHECK (
    ("status" = 'completed' AND "completedAt" IS NOT NULL AND "failedAt" IS NULL)
    OR
    ("status" = 'failed' AND "failedAt" IS NOT NULL AND "completedAt" IS NULL)
    OR
    ("status" NOT IN ('completed', 'failed') AND "completedAt" IS NULL AND "failedAt" IS NULL)
  )
);

CREATE UNIQUE INDEX "AvailabilityReminderFanoutJob_windowId_windowUpdatedAt"
ON "AvailabilityReminderFanoutJob"("availabilityWindowId", "availabilityWindowUpdatedAt");

CREATE UNIQUE INDEX "AvailabilityReminderFanoutJob_leaseToken_key"
ON "AvailabilityReminderFanoutJob"("leaseToken");

CREATE INDEX "AvailabilityReminderFanoutJob_due"
ON "AvailabilityReminderFanoutJob"("status", "nextAttemptAt", "updatedAt", "id");

CREATE INDEX "AvailabilityReminderFanoutJob_lease"
ON "AvailabilityReminderFanoutJob"("status", "leaseExpiresAt");

CREATE INDEX "AvailabilityReminderFanoutJob_companion_createdAt_id"
ON "AvailabilityReminderFanoutJob"("companionId", "createdAt", "id");

CREATE INDEX "CompanionFavorite_reminder_fanout_keyset"
ON "CompanionFavorite"("companionId", "availabilityReminderEnabled", "userId", "id");

ALTER TABLE "AvailabilityReminderFanoutJob"
ADD CONSTRAINT "AvailabilityReminderFanoutJob_companionId_fkey"
FOREIGN KEY ("companionId") REFERENCES "CompanionProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AvailabilityReminderFanoutJob"
ADD CONSTRAINT "AvailabilityReminderFanoutJob_availabilityWindowId_fkey"
FOREIGN KEY ("availabilityWindowId") REFERENCES "CompanionAvailabilityWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
