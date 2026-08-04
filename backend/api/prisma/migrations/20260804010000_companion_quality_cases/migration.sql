CREATE TYPE "CompanionQualityGrade" AS ENUM (
  'noIssue',
  'needsRemediation',
  'restrictIntake',
  'delist'
);

CREATE TYPE "CompanionQualityCaseStatus" AS ENUM ('open', 'closed');

CREATE TYPE "CompanionRemediationTaskStatus" AS ENUM (
  'open',
  'completed',
  'overdue',
  'waived'
);

CREATE TABLE "CompanionQualityCase" (
  "id" TEXT NOT NULL,
  "companionId" TEXT NOT NULL,
  "grade" "CompanionQualityGrade" NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "sourceIncidentId" TEXT,
  "sourceActionId" TEXT,
  "createdById" TEXT NOT NULL,
  "status" "CompanionQualityCaseStatus" NOT NULL DEFAULT 'open',
  "closedAt" TIMESTAMP(3),
  "closedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanionQualityCase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CompanionQualityCase_companionId_fkey"
    FOREIGN KEY ("companionId") REFERENCES "CompanionProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CompanionQualityCase_sourceIncidentId_fkey"
    FOREIGN KEY ("sourceIncidentId") REFERENCES "CompanionIncidentReport"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CompanionQualityCase_sourceActionId_fkey"
    FOREIGN KEY ("sourceActionId") REFERENCES "CompanionAccountAction"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "CompanionQualityCase_companionId_status_idx"
  ON "CompanionQualityCase"("companionId", "status");
CREATE INDEX "CompanionQualityCase_status_createdAt_idx"
  ON "CompanionQualityCase"("status", "createdAt");
CREATE INDEX "CompanionQualityCase_grade_status_idx"
  ON "CompanionQualityCase"("grade", "status");

CREATE TABLE "CompanionRemediationTask" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "moduleCode" TEXT,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "status" "CompanionRemediationTaskStatus" NOT NULL DEFAULT 'open',
  "completedAt" TIMESTAMP(3),
  "evidenceRef" TEXT,
  "completedByCompanion" BOOLEAN NOT NULL DEFAULT false,
  "waivedAt" TIMESTAMP(3),
  "waivedById" TEXT,
  "waiverReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanionRemediationTask_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CompanionRemediationTask_caseId_fkey"
    FOREIGN KEY ("caseId") REFERENCES "CompanionQualityCase"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CompanionRemediationTask_caseId_status_idx"
  ON "CompanionRemediationTask"("caseId", "status");
CREATE INDEX "CompanionRemediationTask_status_dueAt_idx"
  ON "CompanionRemediationTask"("status", "dueAt");
