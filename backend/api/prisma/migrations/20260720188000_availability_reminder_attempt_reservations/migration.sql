-- A reservation is a durable internal binding only. It is intentionally not a
-- notification or provider delivery, and does not alter grant consumption.
CREATE TYPE "AvailabilityReminderAttemptStatus" AS ENUM ('reserved');

CREATE TABLE "AvailabilityReminderAttempt" (
    "id" TEXT NOT NULL,
    "handoffId" TEXT NOT NULL,
    "subscriptionGrantId" TEXT NOT NULL,
    "status" "AvailabilityReminderAttemptStatus" NOT NULL DEFAULT 'reserved',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvailabilityReminderAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AvailabilityReminderAttempt_handoffId_key"
ON "AvailabilityReminderAttempt"("handoffId");

CREATE UNIQUE INDEX "AvailabilityReminderAttempt_subscriptionGrantId_key"
ON "AvailabilityReminderAttempt"("subscriptionGrantId");

CREATE INDEX "AvailabilityReminderAttempt_status_createdAt_idx"
ON "AvailabilityReminderAttempt"("status", "createdAt");

ALTER TABLE "AvailabilityReminderAttempt"
ADD CONSTRAINT "AvailabilityReminderAttempt_handoffId_fkey"
FOREIGN KEY ("handoffId") REFERENCES "AvailabilityReminderHandoff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AvailabilityReminderAttempt"
ADD CONSTRAINT "AvailabilityReminderAttempt_subscriptionGrantId_fkey"
FOREIGN KEY ("subscriptionGrantId") REFERENCES "WeChatSubscriptionGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
