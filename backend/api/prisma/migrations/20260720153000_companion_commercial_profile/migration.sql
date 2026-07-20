CREATE TYPE "CompanionCommercialStatus" AS ENUM ('pendingReview', 'verified', 'suspended');

CREATE TABLE "CompanionCommercialProfile" (
  "companionId" TEXT NOT NULL,
  "status" "CompanionCommercialStatus" NOT NULL DEFAULT 'pendingReview',
  "settlementRecipientRef" TEXT NOT NULL,
  "settlementRecipientMasked" TEXT NOT NULL,
  "taxProfileRef" TEXT NOT NULL,
  "identityEvidenceRef" TEXT NOT NULL,
  "serviceAgreementVersion" TEXT NOT NULL,
  "serviceAgreementEvidenceRef" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submittedById" TEXT NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "verifiedById" TEXT,
  "suspendedAt" TIMESTAMP(3),
  "suspendedById" TEXT,
  "suspendedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanionCommercialProfile_pkey" PRIMARY KEY ("companionId")
);

CREATE UNIQUE INDEX "CompanionCommercialProfile_settlementRecipientRef_key"
ON "CompanionCommercialProfile"("settlementRecipientRef");
CREATE INDEX "CompanionCommercialProfile_status_updatedAt_idx"
ON "CompanionCommercialProfile"("status", "updatedAt");

ALTER TABLE "CompanionCommercialProfile"
ADD CONSTRAINT "CompanionCommercialProfile_companionId_fkey" FOREIGN KEY ("companionId") REFERENCES "CompanionProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Order"
  ADD COLUMN "settlementRecipientRefSnapshot" TEXT,
  ADD COLUMN "settlementRecipientMaskedSnapshot" TEXT,
  ADD COLUMN "taxProfileRefSnapshot" TEXT,
  ADD COLUMN "serviceAgreementVersionSnapshot" TEXT;

ALTER TABLE "CompanionEarning"
  ADD COLUMN "settlementRecipientRefSnapshot" TEXT,
  ADD COLUMN "settlementRecipientMaskedSnapshot" TEXT,
  ADD COLUMN "taxProfileRefSnapshot" TEXT,
  ADD COLUMN "serviceAgreementVersionSnapshot" TEXT,
  ADD COLUMN "paidAmountCents" INTEGER,
  ADD COLUMN "paidRecipientRef" TEXT,
  ADD COLUMN "payoutEvidenceDigest" TEXT;

CREATE UNIQUE INDEX "CompanionEarning_paidReference_key" ON "CompanionEarning"("paidReference");
