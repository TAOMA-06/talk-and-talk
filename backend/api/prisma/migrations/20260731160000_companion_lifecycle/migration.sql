CREATE TYPE "CompanionVoiceIntroStatus" AS ENUM (
  'notSubmitted',
  'pendingReview',
  'approved',
  'rejected'
);

CREATE TYPE "CompanionTrainingStatus" AS ENUM ('inProgress', 'passed', 'expired');
CREATE TYPE "CompanionAccountActionKind" AS ENUM ('warning', 'serviceRestriction', 'suspension');
CREATE TYPE "CompanionAppealStatus" AS ENUM ('pending', 'upheld', 'overturned', 'dismissed');
CREATE TYPE "CompanionIncidentCategory" AS ENUM (
  'technicalIssue',
  'lateArrival',
  'noShow',
  'harassment',
  'safetyBoundary',
  'other'
);
CREATE TYPE "CompanionIncidentStatus" AS ENUM ('open', 'inReview', 'resolved', 'closed');
CREATE TYPE "CompanionWithdrawalStatus" AS ENUM (
  'requested',
  'reviewing',
  'approved',
  'processing',
  'paid',
  'rejected',
  'cancelled'
);

ALTER TABLE "CompanionProfile"
  ADD COLUMN "livedExperience" TEXT,
  ADD COLUMN "serviceBoundaries" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "voiceIntroAssetRef" TEXT,
  ADD COLUMN "voiceIntroDurationSeconds" INTEGER,
  ADD COLUMN "voiceIntroStatus" "CompanionVoiceIntroStatus" NOT NULL DEFAULT 'notSubmitted',
  ADD CONSTRAINT "CompanionProfile_voiceIntroDurationSeconds_check"
    CHECK ("voiceIntroDurationSeconds" IS NULL OR (
      "voiceIntroDurationSeconds" >= 1 AND "voiceIntroDurationSeconds" <= 600
    ));

ALTER TABLE "CompanionCommercialProfile"
  ADD COLUMN "nextReviewDueAt" TIMESTAMP(3);

CREATE TABLE "CompanionTrainingRecord" (
  "id" TEXT NOT NULL,
  "companionId" TEXT NOT NULL,
  "moduleCode" TEXT NOT NULL,
  "moduleVersion" TEXT NOT NULL,
  "status" "CompanionTrainingStatus" NOT NULL DEFAULT 'inProgress',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "bestScore" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptedAt" TIMESTAMP(3),
  "passedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanionTrainingRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CompanionTrainingRecord_attemptCount_check" CHECK ("attemptCount" >= 0),
  CONSTRAINT "CompanionTrainingRecord_bestScore_check" CHECK ("bestScore" >= 0 AND "bestScore" <= 100),
  CONSTRAINT "CompanionTrainingRecord_companionId_fkey"
    FOREIGN KEY ("companionId") REFERENCES "CompanionProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CompanionTrainingRecord_companionId_moduleCode_moduleVersion_key"
  ON "CompanionTrainingRecord"("companionId", "moduleCode", "moduleVersion");
CREATE INDEX "CompanionTrainingRecord_companionId_status_expiresAt_idx"
  ON "CompanionTrainingRecord"("companionId", "status", "expiresAt");

CREATE TABLE "CompanionAccountAction" (
  "id" TEXT NOT NULL,
  "companionId" TEXT NOT NULL,
  "kind" "CompanionAccountActionKind" NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endsAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "revokedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanionAccountAction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CompanionAccountAction_window_check" CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt"),
  CONSTRAINT "CompanionAccountAction_companionId_fkey"
    FOREIGN KEY ("companionId") REFERENCES "CompanionProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CompanionAccountAction_companionId_revokedAt_startsAt_idx"
  ON "CompanionAccountAction"("companionId", "revokedAt", "startsAt");
CREATE INDEX "CompanionAccountAction_kind_revokedAt_createdAt_idx"
  ON "CompanionAccountAction"("kind", "revokedAt", "createdAt");

CREATE TABLE "CompanionAccountAppeal" (
  "id" TEXT NOT NULL,
  "actionId" TEXT NOT NULL,
  "companionId" TEXT NOT NULL,
  "statement" TEXT NOT NULL,
  "evidenceReferences" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" "CompanionAppealStatus" NOT NULL DEFAULT 'pending',
  "resolution" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanionAccountAppeal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CompanionAccountAppeal_actionId_fkey"
    FOREIGN KEY ("actionId") REFERENCES "CompanionAccountAction"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CompanionAccountAppeal_companionId_fkey"
    FOREIGN KEY ("companionId") REFERENCES "CompanionProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CompanionAccountAppeal_actionId_companionId_key"
  ON "CompanionAccountAppeal"("actionId", "companionId");
CREATE INDEX "CompanionAccountAppeal_companionId_status_createdAt_idx"
  ON "CompanionAccountAppeal"("companionId", "status", "createdAt");
CREATE INDEX "CompanionAccountAppeal_status_createdAt_idx"
  ON "CompanionAccountAppeal"("status", "createdAt");

CREATE TABLE "CompanionIncidentReport" (
  "id" TEXT NOT NULL,
  "companionId" TEXT NOT NULL,
  "orderId" TEXT,
  "category" "CompanionIncidentCategory" NOT NULL,
  "summary" TEXT NOT NULL,
  "evidenceReferences" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" "CompanionIncidentStatus" NOT NULL DEFAULT 'open',
  "resolution" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanionIncidentReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CompanionIncidentReport_companionId_fkey"
    FOREIGN KEY ("companionId") REFERENCES "CompanionProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CompanionIncidentReport_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "CompanionIncidentReport_companionId_status_createdAt_idx"
  ON "CompanionIncidentReport"("companionId", "status", "createdAt");
CREATE INDEX "CompanionIncidentReport_status_createdAt_idx"
  ON "CompanionIncidentReport"("status", "createdAt");
CREATE INDEX "CompanionIncidentReport_orderId_idx" ON "CompanionIncidentReport"("orderId");

CREATE TABLE "CompanionWithdrawalRequest" (
  "id" TEXT NOT NULL,
  "companionId" TEXT NOT NULL,
  "earningIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "amountCents" INTEGER NOT NULL,
  "settlementRecipientMasked" TEXT NOT NULL,
  "status" "CompanionWithdrawalStatus" NOT NULL DEFAULT 'requested',
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" TEXT,
  "processedAt" TIMESTAMP(3),
  "payoutReferenceMasked" TEXT,
  "rejectionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanionWithdrawalRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CompanionWithdrawalRequest_amountCents_check" CHECK ("amountCents" > 0),
  CONSTRAINT "CompanionWithdrawalRequest_earningIds_check" CHECK (cardinality("earningIds") > 0),
  CONSTRAINT "CompanionWithdrawalRequest_companionId_fkey"
    FOREIGN KEY ("companionId") REFERENCES "CompanionProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "CompanionWithdrawalRequest_companionId_status_createdAt_idx"
  ON "CompanionWithdrawalRequest"("companionId", "status", "createdAt");
CREATE INDEX "CompanionWithdrawalRequest_status_createdAt_idx"
  ON "CompanionWithdrawalRequest"("status", "createdAt");
