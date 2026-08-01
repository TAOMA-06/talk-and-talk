ALTER TABLE "ModerationCase"
  ADD COLUMN "appealDeadlineAt" TIMESTAMP(3),
  ADD COLUMN "appealPolicyVersion" TEXT;

ALTER TABLE "ModerationAppeal"
  ADD COLUMN "originalReviewerId" TEXT,
  ADD COLUMN "reviewDueAt" TIMESTAMP(3),
  ADD COLUMN "policyVersion" TEXT NOT NULL DEFAULT '2026.1';

UPDATE "ModerationCase" AS mc
SET
  "appealDeadlineAt" = COALESCE(mc."resolvedAt", mc."createdAt") + INTERVAL '30 days',
  "appealPolicyVersion" = '2026.1'
WHERE
  mc."decision" = 'block'
  OR EXISTS (
    SELECT 1
    FROM "ModerationActionLog" AS mal
    WHERE mal."caseId" = mc."id"
      AND mal."action" IN ('confirmViolation', 'rejectMessage', 'restrict24h', 'restrict7d')
  );

UPDATE "ModerationAppeal" AS ma
SET
  "reviewDueAt" = ma."createdAt" + INTERVAL '72 hours',
  "originalReviewerId" = (
    SELECT mal."reviewerId"
    FROM "ModerationActionLog" AS mal
    WHERE mal."caseId" = ma."caseId"
      AND mal."action" IN ('confirmViolation', 'rejectMessage', 'restrict24h', 'restrict7d')
    ORDER BY mal."createdAt" DESC
    LIMIT 1
  );

ALTER TABLE "ModerationAppeal"
  ALTER COLUMN "reviewDueAt" SET NOT NULL,
  ADD CONSTRAINT "ModerationAppeal_review_due_check"
    CHECK ("reviewDueAt" >= "createdAt"),
  ADD CONSTRAINT "ModerationAppeal_policy_version_check"
    CHECK (length(btrim("policyVersion")) > 0);

CREATE INDEX "ModerationCase_appealDeadlineAt_idx"
  ON "ModerationCase"("appealDeadlineAt");

CREATE INDEX "ModerationAppeal_status_reviewDueAt_idx"
  ON "ModerationAppeal"("status", "reviewDueAt");
