CREATE TYPE "CompanionRecoveryStatus" AS ENUM ('due', 'pendingVerification', 'recovered');

CREATE TABLE "CompanionRecovery" (
  "id" TEXT NOT NULL,
  "refundId" TEXT NOT NULL,
  "earningId" TEXT NOT NULL,
  "companionId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "status" "CompanionRecoveryStatus" NOT NULL DEFAULT 'due',
  "evidenceReference" TEXT,
  "evidenceSubmittedAt" TIMESTAMP(3),
  "evidenceSubmittedById" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "verifiedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanionRecovery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanionRecovery_refundId_key" ON "CompanionRecovery"("refundId");
CREATE UNIQUE INDEX "CompanionRecovery_evidenceReference_key" ON "CompanionRecovery"("evidenceReference");
CREATE INDEX "CompanionRecovery_companionId_status_createdAt_idx" ON "CompanionRecovery"("companionId", "status", "createdAt");
CREATE INDEX "CompanionRecovery_status_createdAt_idx" ON "CompanionRecovery"("status", "createdAt");

ALTER TABLE "CompanionRecovery"
ADD CONSTRAINT "CompanionRecovery_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "RefundTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CompanionRecovery"
ADD CONSTRAINT "CompanionRecovery_earningId_fkey" FOREIGN KEY ("earningId") REFERENCES "CompanionEarning"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CompanionRecovery"
ADD CONSTRAINT "CompanionRecovery_companionId_fkey" FOREIGN KEY ("companionId") REFERENCES "CompanionProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
