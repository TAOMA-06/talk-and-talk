ALTER TABLE "CompanionAccountAction"
ADD COLUMN "appealDeadlineAt" TIMESTAMP(3);

UPDATE "CompanionAccountAction"
SET "appealDeadlineAt" = "createdAt" + INTERVAL '30 days'
WHERE "appealDeadlineAt" IS NULL;

ALTER TABLE "CompanionAccountAction"
ALTER COLUMN "appealDeadlineAt" SET NOT NULL;

ALTER TABLE "CompanionAccountAppeal"
ADD COLUMN "reviewDueAt" TIMESTAMP(3);

UPDATE "CompanionAccountAppeal"
SET "reviewDueAt" = "createdAt" + INTERVAL '72 hours'
WHERE "reviewDueAt" IS NULL;

ALTER TABLE "CompanionAccountAppeal"
ALTER COLUMN "reviewDueAt" SET NOT NULL;

CREATE INDEX "CompanionAccountAction_appealDeadlineAt_idx"
ON "CompanionAccountAction"("appealDeadlineAt");

DROP INDEX IF EXISTS "CompanionAccountAppeal_status_createdAt_idx";

CREATE INDEX "CompanionAccountAppeal_status_reviewDueAt_idx"
ON "CompanionAccountAppeal"("status", "reviewDueAt");
