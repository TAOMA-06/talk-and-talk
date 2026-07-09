-- AlterTable
ALTER TABLE "ModerationCase" ADD COLUMN "messageId" TEXT;

-- CreateTable
CREATE TABLE "ModerationEvidence" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationActionLog" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModerationEvidence_caseId_idx" ON "ModerationEvidence"("caseId");

-- CreateIndex
CREATE INDEX "ModerationActionLog_caseId_idx" ON "ModerationActionLog"("caseId");

-- AddForeignKey
ALTER TABLE "ModerationEvidence" ADD CONSTRAINT "ModerationEvidence_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ModerationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationActionLog" ADD CONSTRAINT "ModerationActionLog_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ModerationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
