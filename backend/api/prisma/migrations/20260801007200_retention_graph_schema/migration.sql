-- Normalize identity-bearing retention edges and add durable, bounded worker
-- state before any new guards or backfills become active.

ALTER TABLE "CompanionProfile"
ADD COLUMN "ratingSum" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "MediaAsset"
ADD COLUMN "storageDeleteRequestedAt" TIMESTAMP(3),
ADD COLUMN "storageDeletedAt" TIMESTAMP(3),
ADD COLUMN "storageDeleteLeaseToken" TEXT,
ADD COLUMN "storageDeleteLeaseExpiresAt" TIMESTAMP(3),
ADD COLUMN "storageDeleteAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "storageDeleteNextAttemptAt" TIMESTAMP(3),
ADD COLUMN "storageDeleteLastErrorCode" TEXT;

CREATE UNIQUE INDEX "MediaAsset_storageDeleteLeaseToken_key"
ON "MediaAsset"("storageDeleteLeaseToken");
CREATE INDEX "MediaAsset_storage_delete_due"
ON "MediaAsset"("storageDeletedAt", "expiresAt", "storageDeleteNextAttemptAt", "id");
CREATE INDEX "MediaAsset_storage_delete_lease"
ON "MediaAsset"("storageDeleteLeaseExpiresAt", "id");

CREATE TABLE "AuditSubjectReference" (
  "id" TEXT NOT NULL,
  "auditLogId" TEXT NOT NULL,
  "subjectUserId" TEXT NOT NULL,
  "relationKind" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditSubjectReference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuditSubjectReference_auditLogId_subjectUserId_key"
ON "AuditSubjectReference"("auditLogId", "subjectUserId");
CREATE INDEX "AuditSubjectReference_subjectUserId_auditLogId_idx"
ON "AuditSubjectReference"("subjectUserId", "auditLogId");
ALTER TABLE "AuditSubjectReference"
ADD CONSTRAINT "AuditSubjectReference_auditLogId_fkey"
FOREIGN KEY ("auditLogId") REFERENCES "AuditLog"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditSubjectReference"
ADD CONSTRAINT "AuditSubjectReference_subjectUserId_fkey"
FOREIGN KEY ("subjectUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AuditSubjectReferenceBackfillState" (
  "id" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "cursorCreatedAt" TIMESTAMP(3),
  "cursorId" TEXT,
  "processedCount" INTEGER NOT NULL DEFAULT 0,
  "completedAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuditSubjectReferenceBackfillState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuditSubjectReferenceBackfillState_version_key"
ON "AuditSubjectReferenceBackfillState"("version");

CREATE TABLE "AccountDeletionRetentionSnapshotProgress" (
  "id" TEXT NOT NULL,
  "deletionRequestId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "highWaterAt" TIMESTAMP(3) NOT NULL,
  "cursorCreatedAt" TIMESTAMP(3),
  "cursorId" TEXT,
  "observedCount" INTEGER NOT NULL DEFAULT 0,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountDeletionRetentionSnapshotProgress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RetentionSnapshotProgress_request_category_source_key"
ON "AccountDeletionRetentionSnapshotProgress"("deletionRequestId", "category", "sourceKey");
CREATE INDEX "AccountDeletionRetentionSnapshotProgress_request_category_due"
ON "AccountDeletionRetentionSnapshotProgress"(
  "deletionRequestId", "category", "completedAt", "sourceKey"
);
ALTER TABLE "AccountDeletionRetentionSnapshotProgress"
ADD CONSTRAINT "AccountDeletionRetentionSnapshotProgress_request_fkey"
FOREIGN KEY ("deletionRequestId") REFERENCES "AccountDeletionRequest"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Retained dispute and reschedule records keep their business evidence while
-- allowing a subject identity edge to be detached at retention expiry.
ALTER TABLE "AttendanceDispute"
DROP CONSTRAINT "AttendanceDispute_openedByUserId_fkey",
DROP CONSTRAINT "AttendanceDispute_counterpartyUserId_fkey",
DROP CONSTRAINT "AttendanceDispute_assignedToUserId_fkey",
DROP CONSTRAINT "AttendanceDispute_decidedByUserId_fkey",
DROP CONSTRAINT IF EXISTS "AttendanceDispute_appealedByUserId_fkey",
DROP CONSTRAINT "AttendanceDispute_appealAssignedToUserId_fkey",
DROP CONSTRAINT "AttendanceDispute_appealReviewedByUserId_fkey";

ALTER TABLE "AttendanceDispute"
ALTER COLUMN "openedByUserId" DROP NOT NULL,
ALTER COLUMN "counterpartyUserId" DROP NOT NULL;

ALTER TABLE "AttendanceDispute"
ADD CONSTRAINT "AttendanceDispute_openedByUserId_fkey"
FOREIGN KEY ("openedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "AttendanceDispute_counterpartyUserId_fkey"
FOREIGN KEY ("counterpartyUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "AttendanceDispute_assignedToUserId_fkey"
FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "AttendanceDispute_decidedByUserId_fkey"
FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "AttendanceDispute_appealedByUserId_fkey"
FOREIGN KEY ("appealedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "AttendanceDispute_appealAssignedToUserId_fkey"
FOREIGN KEY ("appealAssignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "AttendanceDispute_appealReviewedByUserId_fkey"
FOREIGN KEY ("appealReviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "AttendanceDispute_decidedByUserId_createdAt_idx"
ON "AttendanceDispute"("decidedByUserId", "createdAt");
CREATE INDEX "AttendanceDispute_appealedByUserId_createdAt_idx"
ON "AttendanceDispute"("appealedByUserId", "createdAt");
CREATE INDEX "AttendanceDispute_appealReviewedByUserId_createdAt_idx"
ON "AttendanceDispute"("appealReviewedByUserId", "createdAt");

ALTER TABLE "OrderRescheduleRequest"
ALTER COLUMN "requestedByUserId" DROP NOT NULL;

ALTER TABLE "OrderRescheduleRequest"
DROP CONSTRAINT IF EXISTS "OrderRescheduleRequest_requestedByUserId_fkey",
DROP CONSTRAINT IF EXISTS "OrderRescheduleRequest_respondedByUserId_fkey";

ALTER TABLE "OrderRescheduleRequest"
ADD CONSTRAINT "OrderRescheduleRequest_requestedByUserId_fkey"
FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "OrderRescheduleRequest_respondedByUserId_fkey"
FOREIGN KEY ("respondedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX "OrderRescheduleRequest_requestedByUserId_createdAt_idx";
CREATE INDEX "OrderRescheduleRequest_requestedByUserId_createdAt_id_idx"
ON "OrderRescheduleRequest"("requestedByUserId", "createdAt", "id");
CREATE INDEX "OrderRescheduleRequest_respondedByUserId_respondedAt_id_idx"
ON "OrderRescheduleRequest"("respondedByUserId", "respondedAt", "id");

-- Match the production keyset queries rather than retaining prefix-only
-- indexes that force a tie sort under a high write volume.
DROP INDEX "Review_companionId_createdAt_idx";
DROP INDEX "Review_userId_createdAt_idx";
CREATE INDEX "Review_companionId_createdAt_id_idx"
ON "Review"("companionId", "createdAt", "id");
CREATE INDEX "Review_userId_createdAt_id_idx"
ON "Review"("userId", "createdAt", "id");

DROP INDEX "AuditLog_createdAt_idx";
CREATE INDEX "AuditLog_createdAt_id_idx"
ON "AuditLog"("createdAt", "id");

-- A verification code is issued before identity resolution and therefore must
-- not be guessed onto a User. These two indexes cover exact active lookup and
-- global expiry cleanup without introducing a false ownership edge.
DROP INDEX "VerificationCode_phone_createdAt_idx";
CREATE INDEX "VerificationCode_active_lookup"
ON "VerificationCode"("phone", "consumedAt", "expiresAt", "createdAt", "id");
CREATE INDEX "VerificationCode_retention_due"
ON "VerificationCode"("expiresAt", "id");
