ALTER TABLE "AccountDeletionRequest"
  ADD COLUMN "processingStartedById" TEXT,
  ADD COLUMN "processingStartedAt" TIMESTAMP(3),
  ADD COLUMN "completedById" TEXT,
  ADD COLUMN "completedAt" TIMESTAMP(3);

WITH first_started AS (
  SELECT DISTINCT ON (log."resourceId")
    log."resourceId",
    log."actorId",
    log."createdAt"
  FROM "AuditLog" AS log
  JOIN "User" AS actor ON actor."id" = log."actorId"
  WHERE log."resourceType" = 'accountDeletionRequest'
    AND log."action" = 'account.deletion_processing_started'
    AND log."actorId" IS NOT NULL
  ORDER BY log."resourceId", log."createdAt" ASC, log."id" ASC
)
UPDATE "AccountDeletionRequest" AS request
SET
  "processingStartedById" = event."actorId",
  "processingStartedAt" = event."createdAt"
FROM first_started AS event
WHERE event."resourceId" = request."id"
  AND request."status" IN ('processing', 'completed');

WITH first_completed AS (
  SELECT DISTINCT ON (log."resourceId")
    log."resourceId",
    log."actorId",
    log."createdAt"
  FROM "AuditLog" AS log
  JOIN "User" AS actor ON actor."id" = log."actorId"
  WHERE log."resourceType" = 'accountDeletionRequest'
    AND log."action" = 'account.deletion_completed'
    AND log."actorId" IS NOT NULL
  ORDER BY log."resourceId", log."createdAt" ASC, log."id" ASC
)
UPDATE "AccountDeletionRequest" AS request
SET
  "completedById" = event."actorId",
  "completedAt" = event."createdAt"
FROM first_completed AS event
WHERE event."resourceId" = request."id"
  AND request."status" = 'completed';

CREATE INDEX "AccountDeletionRequest_processingStartedById_status_idx"
  ON "AccountDeletionRequest"("processingStartedById", "status");
CREATE INDEX "AccountDeletionRequest_completedById_completedAt_idx"
  ON "AccountDeletionRequest"("completedById", "completedAt");

ALTER TABLE "AccountDeletionRequest"
  ADD CONSTRAINT "AccountDeletionRequest_processingStartedById_fkey"
  FOREIGN KEY ("processingStartedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountDeletionRequest"
  ADD CONSTRAINT "AccountDeletionRequest_completedById_fkey"
  FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
