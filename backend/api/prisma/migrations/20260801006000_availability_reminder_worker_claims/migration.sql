-- Every asynchronous reminder stage owns a separate durable work lease. These
-- claims coordinate replicas only; they never replace the final send lease or
-- the one-time subscription-grant transaction.
ALTER TABLE "AvailabilityReminderCandidate"
  ADD COLUMN "preparationLeaseToken" TEXT,
  ADD COLUMN "preparationLeaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "preparationFailureCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "preparationNextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "preparationLastErrorCode" TEXT,
  ADD COLUMN "preparationFailedAt" TIMESTAMP(3);

ALTER TABLE "AvailabilityReminderHandoff"
  ADD COLUMN "reservationLeaseToken" TEXT,
  ADD COLUMN "reservationLeaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "reservationFailureCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reservationNextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "reservationLastErrorCode" TEXT,
  ADD COLUMN "reservationFailedAt" TIMESTAMP(3);

ALTER TABLE "AvailabilityReminderAttempt"
  ADD COLUMN "deliveryClaimToken" TEXT,
  ADD COLUMN "deliveryClaimExpiresAt" TIMESTAMP(3),
  ADD COLUMN "deliveryFailureCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deliveryNextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "deliveryLastErrorCode" TEXT,
  ADD COLUMN "deliveryFailedAt" TIMESTAMP(3);

ALTER TABLE "AvailabilityReminderCandidate"
  ADD CONSTRAINT "AvailabilityReminderCandidate_preparation_lease_complete"
  CHECK (("preparationLeaseToken" IS NULL) = ("preparationLeaseExpiresAt" IS NULL)),
  ADD CONSTRAINT "AvailabilityReminderCandidate_preparation_failure_nonnegative"
  CHECK ("preparationFailureCount" >= 0),
  ADD CONSTRAINT "AvailabilityReminderCandidate_preparation_terminal_has_error"
  CHECK ("preparationFailedAt" IS NULL OR "preparationLastErrorCode" IS NOT NULL);

ALTER TABLE "AvailabilityReminderHandoff"
  ADD CONSTRAINT "AvailabilityReminderHandoff_reservation_lease_complete"
  CHECK (("reservationLeaseToken" IS NULL) = ("reservationLeaseExpiresAt" IS NULL)),
  ADD CONSTRAINT "AvailabilityReminderHandoff_reservation_failure_nonnegative"
  CHECK ("reservationFailureCount" >= 0),
  ADD CONSTRAINT "AvailabilityReminderHandoff_reservation_terminal_has_error"
  CHECK ("reservationFailedAt" IS NULL OR "reservationLastErrorCode" IS NOT NULL);

ALTER TABLE "AvailabilityReminderAttempt"
  ADD CONSTRAINT "AvailabilityReminderAttempt_delivery_claim_complete"
  CHECK (("deliveryClaimToken" IS NULL) = ("deliveryClaimExpiresAt" IS NULL)),
  ADD CONSTRAINT "AvailabilityReminderAttempt_delivery_failure_nonnegative"
  CHECK ("deliveryFailureCount" >= 0),
  ADD CONSTRAINT "AvailabilityReminderAttempt_delivery_terminal_has_error"
  CHECK ("deliveryFailedAt" IS NULL OR "deliveryLastErrorCode" IS NOT NULL);

CREATE UNIQUE INDEX "AvailabilityReminderCandidate_preparation_token"
  ON "AvailabilityReminderCandidate"("preparationLeaseToken");
CREATE UNIQUE INDEX "AvailabilityReminderHandoff_reservation_token"
  ON "AvailabilityReminderHandoff"("reservationLeaseToken");
CREATE UNIQUE INDEX "AvailabilityReminderAttempt_delivery_token"
  ON "AvailabilityReminderAttempt"("deliveryClaimToken");

CREATE INDEX "AvailabilityReminderCandidate_preparation_due"
  ON "AvailabilityReminderCandidate"(
    "preflightDecision", "preparationNextAttemptAt", "createdAt", "id"
  );
CREATE INDEX "AvailabilityReminderCandidate_preparation_lease"
  ON "AvailabilityReminderCandidate"("preparationLeaseExpiresAt");

CREATE INDEX "AvailabilityReminderHandoff_worker_due"
  ON "AvailabilityReminderHandoff"(
    "reservationProcessedAt", "reservationNextAttemptAt", "createdAt", "id"
  );
CREATE INDEX "AvailabilityReminderHandoff_worker_lease"
  ON "AvailabilityReminderHandoff"("reservationLeaseExpiresAt");

CREATE INDEX "AvailabilityReminderAttempt_delivery_due"
  ON "AvailabilityReminderAttempt"(
    "status", "deliveryNextAttemptAt", "createdAt", "id"
  );
CREATE INDEX "AvailabilityReminderAttempt_delivery_claim"
  ON "AvailabilityReminderAttempt"("deliveryClaimExpiresAt");
