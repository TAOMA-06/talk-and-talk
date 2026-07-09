-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationLabel" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "expectedDecision" "ModerationDecision" NOT NULL,
    "actualDecision" "ModerationDecision" NOT NULL,
    "note" TEXT,
    "caseId" TEXT,
    "actorId" TEXT,
    "source" "ModerationSource",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationLabel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_resourceType_resourceId_idx" ON "AuditLog"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "ModerationLabel_createdAt_idx" ON "ModerationLabel"("createdAt");

-- CreateIndex
CREATE INDEX "ModerationLabel_caseId_idx" ON "ModerationLabel"("caseId");

-- CreateIndex
CREATE INDEX "ModerationCase_status_createdAt_idx" ON "ModerationCase"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationCase_riskLevel_createdAt_idx" ON "ModerationCase"("riskLevel", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationCase_createdAt_idx" ON "ModerationCase"("createdAt");
