CREATE TYPE "UserAccountActionKind" AS ENUM ('restriction', 'ban');
CREATE TYPE "UserAccountAppealStatus" AS ENUM ('pending', 'upheld', 'overturned', 'dismissed');

CREATE TABLE "UserAccountAction" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" "UserAccountActionKind" NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endsAt" TIMESTAMP(3),
  "appealDeadlineAt" TIMESTAMP(3) NOT NULL,
  "createdById" TEXT,
  "revokedAt" TIMESTAMP(3),
  "revokedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserAccountAction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserAccountAction_reason_code_check" CHECK (length(btrim("reasonCode")) > 0),
  CONSTRAINT "UserAccountAction_message_check" CHECK (length(btrim("message")) > 0),
  CONSTRAINT "UserAccountAction_policy_version_check" CHECK (length(btrim("policyVersion")) > 0),
  CONSTRAINT "UserAccountAction_window_check" CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt"),
  CONSTRAINT "UserAccountAction_appeal_window_check" CHECK ("appealDeadlineAt" >= "startsAt"),
  CONSTRAINT "UserAccountAction_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserAccountAction_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "UserAccountAction_revokedById_fkey"
    FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "UserAccountAppeal" (
  "id" TEXT NOT NULL,
  "actionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "statement" TEXT NOT NULL,
  "status" "UserAccountAppealStatus" NOT NULL DEFAULT 'pending',
  "reviewDueAt" TIMESTAMP(3) NOT NULL,
  "assignedToUserId" TEXT,
  "assignedAt" TIMESTAMP(3),
  "resolution" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  "policyVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserAccountAppeal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserAccountAppeal_statement_check" CHECK (length(btrim("statement")) > 0),
  CONSTRAINT "UserAccountAppeal_policy_version_check" CHECK (length(btrim("policyVersion")) > 0),
  CONSTRAINT "UserAccountAppeal_review_due_check" CHECK ("reviewDueAt" >= "createdAt"),
  CONSTRAINT "UserAccountAppeal_assignment_check" CHECK (
    ("assignedToUserId" IS NULL AND "assignedAt" IS NULL)
    OR ("assignedToUserId" IS NOT NULL AND "assignedAt" IS NOT NULL)
  ),
  CONSTRAINT "UserAccountAppeal_resolution_check" CHECK (
    ("status" = 'pending' AND "resolution" IS NULL AND "resolvedAt" IS NULL AND "resolvedById" IS NULL)
    OR ("status" <> 'pending' AND "resolution" IS NOT NULL AND "resolvedAt" IS NOT NULL)
  ),
  CONSTRAINT "UserAccountAppeal_actionId_fkey"
    FOREIGN KEY ("actionId") REFERENCES "UserAccountAction"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserAccountAppeal_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserAccountAppeal_assignedToUserId_fkey"
    FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "UserAccountAppeal_resolvedById_fkey"
    FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Existing ordinary consumers receive a fresh 30-day appeal window when this
-- formal process is introduced. Companion, staff and deletion-finalization
-- states remain owned by their dedicated workflows and are deliberately not
-- converted into consumer account actions.
INSERT INTO "UserAccountAction" (
  "id",
  "userId",
  "kind",
  "reasonCode",
  "message",
  "policyVersion",
  "startsAt",
  "appealDeadlineAt",
  "createdAt",
  "updatedAt"
)
SELECT
  'legacy-user-account-action-' || u."id",
  u."id",
  CASE
    WHEN u."accountStatus" = 'banned' THEN 'ban'::"UserAccountActionKind"
    ELSE 'restriction'::"UserAccountActionKind"
  END,
  'LEGACY_ACCOUNT_STATUS',
  '该账号状态在正式处置与申诉流程上线前已被调整；现已补发完整申诉期限。',
  '2026.1',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP + INTERVAL '30 days',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" AS u
WHERE u."role" = 'user'
  AND u."accountStatus" IN ('restricted', 'banned')
  AND NOT EXISTS (
    SELECT 1 FROM "StaffCredential" AS sc WHERE sc."userId" = u."id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "CompanionProfile" AS cp WHERE cp."ownerUserId" = u."id"
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "AccountDeletionRequest" AS adr
    WHERE adr."userId" = u."id"
      AND adr."status" IN ('processing', 'completed')
  );

CREATE UNIQUE INDEX "UserAccountAction_one_active_per_user_key"
  ON "UserAccountAction"("userId") WHERE "revokedAt" IS NULL;
CREATE INDEX "UserAccountAction_userId_revokedAt_startsAt_idx"
  ON "UserAccountAction"("userId", "revokedAt", "startsAt");
CREATE INDEX "UserAccountAction_kind_revokedAt_createdAt_idx"
  ON "UserAccountAction"("kind", "revokedAt", "createdAt");
CREATE INDEX "UserAccountAction_appealDeadlineAt_idx"
  ON "UserAccountAction"("appealDeadlineAt");

CREATE UNIQUE INDEX "UserAccountAppeal_actionId_key"
  ON "UserAccountAppeal"("actionId");
CREATE INDEX "UserAccountAppeal_userId_status_createdAt_idx"
  ON "UserAccountAppeal"("userId", "status", "createdAt");
CREATE INDEX "UserAccountAppeal_status_reviewDueAt_createdAt_idx"
  ON "UserAccountAppeal"("status", "reviewDueAt", "createdAt");
CREATE INDEX "UserAccountAppeal_assignedToUserId_status_reviewDueAt_idx"
  ON "UserAccountAppeal"("assignedToUserId", "status", "reviewDueAt");
