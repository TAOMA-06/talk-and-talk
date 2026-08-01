ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'support';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'finance';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'supply';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'operations';

CREATE TYPE "DataRightsRequestType" AS ENUM ('access', 'export', 'correction', 'deletion');
CREATE TYPE "DataRightsRequestStatus" AS ENUM ('submitted', 'inReview', 'needsInformation', 'completed', 'rejected');
CREATE TYPE "InvoiceRequestStatus" AS ENUM ('submitted', 'inReview', 'issued', 'rejected', 'voided');

ALTER TABLE "RefreshToken"
  ADD COLUMN "sessionLabel" TEXT,
  ADD COLUMN "clientPlatform" TEXT,
  ADD COLUMN "lastUsedAt" TIMESTAMP(3);

UPDATE "RefreshToken"
SET "lastUsedAt" = "createdAt"
WHERE "lastUsedAt" IS NULL;

ALTER TABLE "RefreshToken"
  ALTER COLUMN "lastUsedAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "lastUsedAt" SET NOT NULL;

CREATE INDEX "RefreshToken_userId_revokedAt_expiresAt_idx"
  ON "RefreshToken"("userId", "revokedAt", "expiresAt");
DROP INDEX IF EXISTS "RefreshToken_userId_idx";

CREATE TABLE "DataRightsRequest" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "DataRightsRequestType" NOT NULL,
  "status" "DataRightsRequestStatus" NOT NULL DEFAULT 'submitted',
  "description" TEXT NOT NULL,
  "statusReason" TEXT,
  "handledById" TEXT,
  "handledAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DataRightsRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InvoiceRequest" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "paymentTransactionId" TEXT NOT NULL,
  "status" "InvoiceRequestStatus" NOT NULL DEFAULT 'submitted',
  "invoiceTitle" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "paymentPaidAt" TIMESTAMP(3) NOT NULL,
  "serviceTitleSnapshot" TEXT NOT NULL,
  "serviceDeliveryModeSnapshot" TEXT,
  "serviceDurationMinutesSnapshot" INTEGER NOT NULL,
  "companionNameSnapshot" TEXT NOT NULL,
  "statusReason" TEXT,
  "handledById" TEXT,
  "handledAt" TIMESTAMP(3),
  "issuedAt" TIMESTAMP(3),
  "voidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InvoiceRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DataRightsRequestFollowUp" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "statement" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DataRightsRequestFollowUp_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DataRightsRequest_userId_createdAt_idx" ON "DataRightsRequest"("userId", "createdAt");
CREATE INDEX "DataRightsRequest_status_createdAt_idx" ON "DataRightsRequest"("status", "createdAt");
CREATE INDEX "DataRightsRequest_handledById_status_idx" ON "DataRightsRequest"("handledById", "status");
CREATE INDEX "DataRightsRequestFollowUp_requestId_createdAt_idx"
  ON "DataRightsRequestFollowUp"("requestId", "createdAt");
CREATE INDEX "DataRightsRequestFollowUp_userId_createdAt_idx"
  ON "DataRightsRequestFollowUp"("userId", "createdAt");
CREATE INDEX "InvoiceRequest_userId_createdAt_idx" ON "InvoiceRequest"("userId", "createdAt");
CREATE INDEX "InvoiceRequest_orderId_createdAt_idx" ON "InvoiceRequest"("orderId", "createdAt");
CREATE INDEX "InvoiceRequest_status_createdAt_idx" ON "InvoiceRequest"("status", "createdAt");
CREATE INDEX "InvoiceRequest_handledById_status_idx" ON "InvoiceRequest"("handledById", "status");
CREATE INDEX "InvoiceRequest_paymentTransactionId_idx" ON "InvoiceRequest"("paymentTransactionId");

ALTER TABLE "DataRightsRequest"
  ADD CONSTRAINT "DataRightsRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DataRightsRequest"
  ADD CONSTRAINT "DataRightsRequest_handledById_fkey"
  FOREIGN KEY ("handledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DataRightsRequestFollowUp"
  ADD CONSTRAINT "DataRightsRequestFollowUp_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "DataRightsRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DataRightsRequestFollowUp"
  ADD CONSTRAINT "DataRightsRequestFollowUp_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InvoiceRequest"
  ADD CONSTRAINT "InvoiceRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InvoiceRequest"
  ADD CONSTRAINT "InvoiceRequest_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InvoiceRequest"
  ADD CONSTRAINT "InvoiceRequest_paymentTransactionId_fkey"
  FOREIGN KEY ("paymentTransactionId") REFERENCES "PaymentTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InvoiceRequest"
  ADD CONSTRAINT "InvoiceRequest_handledById_fkey"
  FOREIGN KEY ("handledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
