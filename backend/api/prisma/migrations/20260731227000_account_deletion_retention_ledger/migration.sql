ALTER TABLE "User"
ADD COLUMN "dataProcessingRestrictedAt" TIMESTAMP(3),
ADD COLUMN "deletionCompletedAt" TIMESTAMP(3);

CREATE TABLE "AccountDataRetentionRecord" (
  "id" TEXT NOT NULL,
  "deletionRequestId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "disposition" TEXT NOT NULL,
  "legalBasisCode" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "policyApprovalStatus" TEXT NOT NULL,
  "policyApprovalReference" TEXT,
  "recordCount" INTEGER NOT NULL,
  "processingRestrictedAt" TIMESTAMP(3) NOT NULL,
  "retentionEndsAt" TIMESTAMP(3),
  "expiryProcessedAt" TIMESTAMP(3),
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountDataRetentionRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountDataRetentionRecord_deletionRequestId_category_key"
ON "AccountDataRetentionRecord"("deletionRequestId", "category");
CREATE INDEX "AccountDataRetentionRecord_userId_disposition_idx"
ON "AccountDataRetentionRecord"("userId", "disposition");
CREATE INDEX "AccountDataRetentionRecord_disposition_retentionEndsAt_expiryProcessedAt_idx"
ON "AccountDataRetentionRecord"("disposition", "retentionEndsAt", "expiryProcessedAt");
CREATE INDEX "AccountDataRetentionRecord_policyApprovalStatus_createdAt_idx"
ON "AccountDataRetentionRecord"("policyApprovalStatus", "createdAt");

ALTER TABLE "AccountDataRetentionRecord"
ADD CONSTRAINT "AccountDataRetentionRecord_deletionRequestId_fkey"
FOREIGN KEY ("deletionRequestId") REFERENCES "AccountDeletionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AccountDataRetentionRecord"
ADD CONSTRAINT "AccountDataRetentionRecord_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AccountDataRetentionRecord"
ADD CONSTRAINT "AccountDataRetentionRecord_disposition_check"
CHECK ("disposition" IN ('deleted', 'retainedRestricted', 'anonymized'));

ALTER TABLE "AccountDataRetentionRecord"
ADD CONSTRAINT "AccountDataRetentionRecord_approval_check"
CHECK ("policyApprovalStatus" IN ('approved', 'pendingLegalApproval'));

ALTER TABLE "AccountDataRetentionRecord"
ADD CONSTRAINT "AccountDataRetentionRecord_count_check"
CHECK ("recordCount" >= 0);
