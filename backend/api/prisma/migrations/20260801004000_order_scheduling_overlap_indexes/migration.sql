-- Supports status-aware bounded schedule scans and the real interval-overlap
-- predicate used for legacy orders whose duration can exceed today's API cap.
CREATE INDEX "Order_companion_status_scheduledAt_id"
  ON "Order"("companionId", "status", "scheduledAt", "id");

CREATE INDEX "Order_companion_status_scheduledEnd_id"
  ON "Order"(
    "companionId",
    "status",
    ("scheduledAt" + ("durationMinutes" * INTERVAL '1 minute')),
    "id"
  )
  WHERE "durationMinutes" > 0;
