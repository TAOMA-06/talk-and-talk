-- Chat moderation v2 keeps existing text messages visible while introducing
-- sender-only pending states, media assets, appeals, and chat-only restrictions.

ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'image';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'audio';

CREATE TYPE "MessageModerationStatus" AS ENUM ('queued', 'pendingReview', 'published', 'blocked', 'removed');
CREATE TYPE "MessageVisibility" AS ENUM ('participants', 'senderOnly', 'staffOnly');
CREATE TYPE "MediaAssetKind" AS ENUM ('image', 'audio');
CREATE TYPE "MediaAssetStatus" AS ENUM ('reserved', 'uploaded', 'scanning', 'approved', 'blocked', 'expired', 'failed');
CREATE TYPE "ModerationPriority" AS ENUM ('normal', 'high', 'critical');
CREATE TYPE "ModerationAppealStatus" AS ENUM ('pending', 'upheld', 'overturned', 'dismissed');
CREATE TYPE "ChatRestrictionSource" AS ENUM ('automatic', 'manual');

ALTER TABLE "Message"
  ADD COLUMN "moderationStatus" "MessageModerationStatus" NOT NULL DEFAULT 'published',
  ADD COLUMN "visibility" "MessageVisibility" NOT NULL DEFAULT 'participants',
  ADD COLUMN "moderationDecision" "ModerationDecision",
  ADD COLUMN "policyVersion" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3);

ALTER TABLE "ModerationCase"
  ADD COLUMN "conversationId" TEXT,
  ADD COLUMN "subjectUserId" TEXT,
  ADD COLUMN "reporterUserId" TEXT,
  ADD COLUMN "priority" "ModerationPriority" NOT NULL DEFAULT 'normal',
  ADD COLUMN "dueAt" TIMESTAMP(3),
  ADD COLUMN "assignedToUserId" TEXT,
  ADD COLUMN "policyVersion" TEXT NOT NULL DEFAULT 'chat-v2',
  ADD COLUMN "provider" TEXT,
  ADD COLUMN "providerVersion" TEXT;

CREATE TABLE "MediaAsset" (
  "id" TEXT NOT NULL,
  "uploaderId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "messageId" TEXT,
  "kind" "MediaAssetKind" NOT NULL,
  "status" "MediaAssetStatus" NOT NULL DEFAULT 'reserved',
  "storageKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "durationMs" INTEGER,
  "extractedText" TEXT,
  "analysis" JSONB,
  "provider" TEXT,
  "providerVersion" TEXT,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "lastError" TEXT,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModerationAppeal" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "subjectUserId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "ModerationAppealStatus" NOT NULL DEFAULT 'pending',
  "reviewerId" TEXT,
  "reviewNote" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ModerationAppeal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatRestriction" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "caseId" TEXT,
  "source" "ChatRestrictionSource" NOT NULL DEFAULT 'automatic',
  "reason" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "liftedAt" TIMESTAMP(3),
  "liftedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ChatRestriction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MediaAsset_storageKey_key" ON "MediaAsset"("storageKey");
CREATE INDEX "Message_conversationId_moderationStatus_createdAt_idx" ON "Message"("conversationId", "moderationStatus", "createdAt");
CREATE INDEX "MediaAsset_conversationId_status_createdAt_idx" ON "MediaAsset"("conversationId", "status", "createdAt");
CREATE INDEX "MediaAsset_uploaderId_createdAt_idx" ON "MediaAsset"("uploaderId", "createdAt");
CREATE INDEX "MediaAsset_messageId_idx" ON "MediaAsset"("messageId");
CREATE INDEX "MediaAsset_expiresAt_idx" ON "MediaAsset"("expiresAt");
CREATE INDEX "ModerationCase_conversationId_idx" ON "ModerationCase"("conversationId");
CREATE INDEX "ModerationCase_subjectUserId_createdAt_idx" ON "ModerationCase"("subjectUserId", "createdAt");
CREATE INDEX "ModerationCase_reporterUserId_createdAt_idx" ON "ModerationCase"("reporterUserId", "createdAt");
CREATE INDEX "ModerationCase_priority_dueAt_idx" ON "ModerationCase"("priority", "dueAt");
CREATE UNIQUE INDEX "ModerationAppeal_caseId_key" ON "ModerationAppeal"("caseId");
CREATE INDEX "ModerationAppeal_subjectUserId_createdAt_idx" ON "ModerationAppeal"("subjectUserId", "createdAt");
CREATE INDEX "ModerationAppeal_status_createdAt_idx" ON "ModerationAppeal"("status", "createdAt");
CREATE INDEX "ChatRestriction_userId_endsAt_idx" ON "ChatRestriction"("userId", "endsAt");
CREATE INDEX "ChatRestriction_caseId_idx" ON "ChatRestriction"("caseId");

ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "MediaAsset_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "MediaAsset_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "MediaAsset_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ModerationCase"
  ADD CONSTRAINT "ModerationCase_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ModerationCase_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ModerationAppeal"
  ADD CONSTRAINT "ModerationAppeal_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ModerationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ModerationAppeal_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatRestriction"
  ADD CONSTRAINT "ChatRestriction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ChatRestriction_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ModerationCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
