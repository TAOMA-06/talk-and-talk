-- Rescheduling is modeled independently from the financial Order status
-- machine. It preserves both the original and requested appointments and lets
-- the UI show a concise participant-facing timeline without exposing AuditLog
-- records or staff-only evidence.
CREATE TYPE "OrderRescheduleRequestStatus" AS ENUM ('pending', 'accepted', 'rejected', 'expired', 'cancelled');
CREATE TYPE "OrderRescheduleRequesterRole" AS ENUM ('customer', 'companion');
CREATE TYPE "OrderTimelineEventType" AS ENUM ('orderCreated', 'rescheduleRequested', 'rescheduleAccepted', 'rescheduleRejected', 'rescheduleExpired', 'rescheduleCancelled');
CREATE TYPE "OrderTimelineActorRole" AS ENUM ('customer', 'companion', 'system');

CREATE TABLE "OrderRescheduleRequest" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "requestedByRole" "OrderRescheduleRequesterRole" NOT NULL,
  "originalScheduledAt" TIMESTAMP(3) NOT NULL,
  "requestedScheduledAt" TIMESTAMP(3) NOT NULL,
  "requestedAvailabilityWindowId" TEXT,
  "requestedAvailabilityWindowStartsAtSnapshot" TIMESTAMP(3),
  "requestedAvailabilityWindowEndsAtSnapshot" TIMESTAMP(3),
  "requestedAvailabilityWindowCapacitySnapshot" INTEGER,
  "status" "OrderRescheduleRequestStatus" NOT NULL DEFAULT 'pending',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "respondedAt" TIMESTAMP(3),
  "respondedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrderRescheduleRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderRescheduleRequest_requestedAvailability_snapshot_check"
    CHECK (
      (
        "requestedAvailabilityWindowId" IS NULL
        AND "requestedAvailabilityWindowStartsAtSnapshot" IS NULL
        AND "requestedAvailabilityWindowEndsAtSnapshot" IS NULL
        AND "requestedAvailabilityWindowCapacitySnapshot" IS NULL
      )
      OR (
        "requestedAvailabilityWindowId" IS NOT NULL
        AND "requestedAvailabilityWindowStartsAtSnapshot" IS NOT NULL
        AND "requestedAvailabilityWindowEndsAtSnapshot" IS NOT NULL
        AND "requestedAvailabilityWindowCapacitySnapshot" IS NOT NULL
        AND "requestedAvailabilityWindowEndsAtSnapshot" > "requestedAvailabilityWindowStartsAtSnapshot"
        AND "requestedAvailabilityWindowCapacitySnapshot" >= 1
        AND "requestedAvailabilityWindowCapacitySnapshot" <= 20
      )
    )
);

CREATE TABLE "OrderTimelineEvent" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "type" "OrderTimelineEventType" NOT NULL,
  "actorId" TEXT,
  "actorRole" "OrderTimelineActorRole" NOT NULL,
  "rescheduleRequestId" TEXT,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrderTimelineEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderRescheduleRequest_orderId_status_expiresAt_idx"
  ON "OrderRescheduleRequest"("orderId", "status", "expiresAt");
CREATE INDEX "OrderRescheduleRequest_requestedByUserId_createdAt_idx"
  ON "OrderRescheduleRequest"("requestedByUserId", "createdAt");
-- Only one open negotiation may exist for an order. Later write endpoints use
-- this as their final cross-process guard, in addition to transaction locks.
CREATE UNIQUE INDEX "OrderRescheduleRequest_one_pending_per_order"
  ON "OrderRescheduleRequest"("orderId") WHERE "status" = 'pending';
CREATE INDEX "OrderTimelineEvent_orderId_createdAt_id_idx"
  ON "OrderTimelineEvent"("orderId", "createdAt", "id");
CREATE INDEX "OrderTimelineEvent_rescheduleRequestId_idx"
  ON "OrderTimelineEvent"("rescheduleRequestId");

ALTER TABLE "OrderRescheduleRequest"
  ADD CONSTRAINT "OrderRescheduleRequest_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderTimelineEvent"
  ADD CONSTRAINT "OrderTimelineEvent_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "OrderTimelineEvent_rescheduleRequestId_fkey"
  FOREIGN KEY ("rescheduleRequestId") REFERENCES "OrderRescheduleRequest"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
