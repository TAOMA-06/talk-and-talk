-- An inert, one-to-one internal handoff for a candidate that has already
-- passed preflight. This is deliberately separate from Notification and
-- NotificationDelivery so creating it cannot trigger an external send.
CREATE TABLE "AvailabilityReminderHandoff" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvailabilityReminderHandoff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AvailabilityReminderHandoff_candidateId_key"
ON "AvailabilityReminderHandoff"("candidateId");

CREATE INDEX "AvailabilityReminderHandoff_createdAt_idx"
ON "AvailabilityReminderHandoff"("createdAt");

ALTER TABLE "AvailabilityReminderHandoff"
ADD CONSTRAINT "AvailabilityReminderHandoff_candidateId_fkey"
FOREIGN KEY ("candidateId") REFERENCES "AvailabilityReminderCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
