-- Review staff are deliberately independent from consumer-facing users.  This
-- migration does not copy StaffCredential rows: each reviewer must be
-- provisioned afresh with a separate password, TOTP seed, and review JWT keys.
CREATE TYPE "ReviewStaffRole" AS ENUM ('reviewer', 'lead');
CREATE TYPE "ReviewStaffStatus" AS ENUM ('active', 'suspended');

CREATE TABLE "ReviewStaff" (
  "id" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "role" "ReviewStaffRole" NOT NULL DEFAULT 'reviewer',
  "status" "ReviewStaffStatus" NOT NULL DEFAULT 'active',
  "passwordHash" TEXT NOT NULL,
  "totpSecretCiphertext" TEXT NOT NULL,
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  "lastLoginAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReviewStaff_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReviewSession" (
  "id" TEXT NOT NULL,
  "reviewerId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReviewSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReviewAuditLog" (
  "id" TEXT NOT NULL,
  "reviewerId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReviewAuditLog_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ModerationActionLog" ADD COLUMN "reviewerId" TEXT;
ALTER TABLE "ModerationLabel" ADD COLUMN "reviewerId" TEXT;

CREATE UNIQUE INDEX "ReviewStaff_username_key" ON "ReviewStaff"("username");
CREATE INDEX "ReviewStaff_username_lockedUntil_idx" ON "ReviewStaff"("username", "lockedUntil");
CREATE INDEX "ReviewStaff_status_role_idx" ON "ReviewStaff"("status", "role");
CREATE UNIQUE INDEX "ReviewSession_tokenHash_key" ON "ReviewSession"("tokenHash");
CREATE INDEX "ReviewSession_reviewerId_idx" ON "ReviewSession"("reviewerId");
CREATE INDEX "ReviewAuditLog_reviewerId_createdAt_idx" ON "ReviewAuditLog"("reviewerId", "createdAt");
CREATE INDEX "ReviewAuditLog_resourceType_resourceId_idx" ON "ReviewAuditLog"("resourceType", "resourceId");
CREATE INDEX "ReviewAuditLog_createdAt_idx" ON "ReviewAuditLog"("createdAt");
CREATE INDEX "ModerationActionLog_reviewerId_createdAt_idx" ON "ModerationActionLog"("reviewerId", "createdAt");
CREATE INDEX "ModerationLabel_reviewerId_createdAt_idx" ON "ModerationLabel"("reviewerId", "createdAt");

ALTER TABLE "ReviewSession" ADD CONSTRAINT "ReviewSession_reviewerId_fkey"
  FOREIGN KEY ("reviewerId") REFERENCES "ReviewStaff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewAuditLog" ADD CONSTRAINT "ReviewAuditLog_reviewerId_fkey"
  FOREIGN KEY ("reviewerId") REFERENCES "ReviewStaff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ModerationActionLog" ADD CONSTRAINT "ModerationActionLog_reviewerId_fkey"
  FOREIGN KEY ("reviewerId") REFERENCES "ReviewStaff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ModerationLabel" ADD CONSTRAINT "ModerationLabel_reviewerId_fkey"
  FOREIGN KEY ("reviewerId") REFERENCES "ReviewStaff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
