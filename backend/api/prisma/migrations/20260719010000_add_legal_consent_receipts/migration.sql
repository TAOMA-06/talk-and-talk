-- CreateEnum
CREATE TYPE "LegalConsentSource" AS ENUM ('wechatMiniProgram');

-- CreateTable
CREATE TABLE "LegalConsentReceipt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "privacyVersion" TEXT NOT NULL,
    "termsVersion" TEXT NOT NULL,
    "privacyAccepted" BOOLEAN NOT NULL,
    "termsAccepted" BOOLEAN NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "privacyUrl" TEXT NOT NULL,
    "termsUrl" TEXT NOT NULL,
    "source" "LegalConsentSource" NOT NULL DEFAULT 'wechatMiniProgram',

    CONSTRAINT "LegalConsentReceipt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LegalConsentReceipt_acceptance_check" CHECK ("privacyAccepted" = TRUE AND "termsAccepted" = TRUE)
);

-- CreateIndex
CREATE UNIQUE INDEX "LegalConsentReceipt_userId_version_key" ON "LegalConsentReceipt"("userId", "version");

-- CreateIndex
CREATE INDEX "LegalConsentReceipt_userId_consentedAt_idx" ON "LegalConsentReceipt"("userId", "consentedAt");

-- AddForeignKey
ALTER TABLE "LegalConsentReceipt" ADD CONSTRAINT "LegalConsentReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
