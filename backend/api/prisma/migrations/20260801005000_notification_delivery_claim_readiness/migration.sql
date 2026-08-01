-- The delivery worker claims and recovers bounded, stable batches. Include the
-- id tie-breaker in both partial queue traversals so ten or more replicas can
-- skip locked rows without repeatedly scanning the same oldest prefix.
DROP INDEX IF EXISTS "NotificationDelivery_status_nextAttemptAt_idx";
DROP INDEX IF EXISTS "NotificationDelivery_leaseExpiresAt_idx";

CREATE INDEX "NotificationDelivery_status_nextAttemptAt_id_idx"
  ON "NotificationDelivery"("status", "nextAttemptAt", "id");

CREATE INDEX "NotificationDelivery_status_leaseExpiresAt_id_idx"
  ON "NotificationDelivery"("status", "leaseExpiresAt", "id");
