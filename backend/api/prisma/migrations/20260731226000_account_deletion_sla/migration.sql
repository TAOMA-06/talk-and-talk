-- Version every deletion request against the published 15-weekday policy and
-- persist its deadline so later policy changes cannot rewrite historical SLA.
ALTER TABLE "AccountDeletionRequest"
  ADD COLUMN "dueAt" TIMESTAMP(3),
  ADD COLUMN "policyVersion" TEXT;

WITH ranked_deadlines AS (
  SELECT
    request."id",
    request."createdAt" + offsets.day_offset * INTERVAL '1 day' AS due_at,
    ROW_NUMBER() OVER (
      PARTITION BY request."id"
      ORDER BY offsets.day_offset
    ) AS business_day
  FROM "AccountDeletionRequest" AS request
  CROSS JOIN generate_series(1, 30) AS offsets(day_offset)
  WHERE EXTRACT(
    ISODOW FROM request."createdAt"
      + offsets.day_offset * INTERVAL '1 day'
      + INTERVAL '8 hours'
  ) BETWEEN 1 AND 5
)
UPDATE "AccountDeletionRequest" AS request
SET
  "dueAt" = ranked_deadlines.due_at,
  "policyVersion" = '2026.1'
FROM ranked_deadlines
WHERE request."id" = ranked_deadlines."id"
  AND ranked_deadlines.business_day = 15;

ALTER TABLE "AccountDeletionRequest"
  ALTER COLUMN "dueAt" SET NOT NULL,
  ALTER COLUMN "policyVersion" SET NOT NULL;

CREATE INDEX "AccountDeletionRequest_status_dueAt_idx"
  ON "AccountDeletionRequest"("status", "dueAt");
