-- Commercial pilot foundation: reliable notification delivery, operational
-- support records, and an auditable (manual) companion settlement ledger.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'supportUpdate';

CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('pending', 'processing', 'sent', 'skipped', 'failed');
CREATE TYPE "CompanionEarningStatus" AS ENUM ('pending', 'available', 'held', 'paid', 'void');
CREATE TYPE "SupportTicketCategory" AS ENUM ('orderIssue', 'refund', 'safety', 'privacy', 'general');
CREATE TYPE "SupportTicketStatus" AS ENUM ('open', 'inProgress', 'resolved', 'closed');
CREATE TYPE "SupportTicketPriority" AS ENUM ('normal', 'high', 'urgent');
CREATE TYPE "LegalDocumentKind" AS ENUM ('terms', 'privacy', 'platformRules');

ALTER TABLE "Order"
  ADD COLUMN "companionResponseDeadlineAt" TIMESTAMP(3),
  ADD COLUMN "serviceStartedAt" TIMESTAMP(3),
  ADD COLUMN "platformFeeBps" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "platformFeeCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "companionPayableCents" INTEGER NOT NULL DEFAULT 0;

-- Existing unconfirmed requests were created before the explicit response
-- SLA existed. Give them the historical 10-minute window (capped by the
-- payment cutoff); overdue records are then safely cancelled by the worker.
UPDATE "Order"
SET "companionResponseDeadlineAt" = LEAST(
  "scheduledAt" - INTERVAL '5 minutes',
  "createdAt" + INTERVAL '10 minutes'
)
WHERE "status" = 'pending'
  AND "companionConfirmedAt" IS NULL
  AND "companionResponseDeadlineAt" IS NULL;

-- Historical orders predate the fee snapshot. They are not automatically
-- enrolled into the new payout ledger, but their order-level payable snapshot
-- remains truthful (zero platform fee) for support and reconciliation views.
UPDATE "Order"
SET "companionPayableCents" = "amountCents"
WHERE "companionPayableCents" = 0;

ALTER TABLE "Notification" ADD COLUMN "eventKey" TEXT;

CREATE TABLE "NotificationDelivery" (
  "id" TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "templateKey" TEXT NOT NULL,
  "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'pending',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "providerMessageId" TEXT,
  "errorCode" TEXT,
  "lastError" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WeChatSubscriptionGrant" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "templateKey" TEXT NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "consumedAt" TIMESTAMP(3),
  "consumedByDeliveryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WeChatSubscriptionGrant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompanionEarning" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "companionId" TEXT NOT NULL,
  "grossCents" INTEGER NOT NULL,
  "platformFeeBps" INTEGER NOT NULL,
  "platformFeeCents" INTEGER NOT NULL,
  "payableCents" INTEGER NOT NULL,
  "status" "CompanionEarningStatus" NOT NULL DEFAULT 'pending',
  "availableAt" TIMESTAMP(3) NOT NULL,
  "payoutSubmittedAt" TIMESTAMP(3),
  "payoutSubmittedById" TEXT,
  "paidAt" TIMESTAMP(3),
  "paidReference" TEXT,
  "holdReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CompanionEarning_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportTicket" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "orderId" TEXT,
  "category" "SupportTicketCategory" NOT NULL,
  "priority" "SupportTicketPriority" NOT NULL DEFAULT 'normal',
  "status" "SupportTicketStatus" NOT NULL DEFAULT 'open',
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "assignedToUserId" TEXT,
  "dueAt" TIMESTAMP(3),
  "resolution" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LegalDocumentVersion" (
  "id" TEXT NOT NULL,
  "documentType" "LegalDocumentKind" NOT NULL,
  "version" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "html" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LegalDocumentVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Notification_eventKey_key" ON "Notification"("eventKey");
CREATE UNIQUE INDEX "NotificationDelivery_notificationId_templateKey_key" ON "NotificationDelivery"("notificationId", "templateKey");
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "NotificationDelivery"("status", "nextAttemptAt");
CREATE INDEX "NotificationDelivery_userId_createdAt_idx" ON "NotificationDelivery"("userId", "createdAt");
CREATE INDEX "NotificationDelivery_leaseExpiresAt_idx" ON "NotificationDelivery"("leaseExpiresAt");
CREATE UNIQUE INDEX "WeChatSubscriptionGrant_consumedByDeliveryId_key" ON "WeChatSubscriptionGrant"("consumedByDeliveryId");
CREATE INDEX "WeChatSubscriptionGrant_userId_templateKey_consumedAt_grantedAt_idx" ON "WeChatSubscriptionGrant"("userId", "templateKey", "consumedAt", "grantedAt");
CREATE UNIQUE INDEX "CompanionEarning_orderId_key" ON "CompanionEarning"("orderId");
CREATE INDEX "CompanionEarning_companionId_status_availableAt_idx" ON "CompanionEarning"("companionId", "status", "availableAt");
CREATE INDEX "CompanionEarning_status_availableAt_idx" ON "CompanionEarning"("status", "availableAt");
CREATE INDEX "SupportTicket_userId_createdAt_idx" ON "SupportTicket"("userId", "createdAt");
CREATE INDEX "SupportTicket_orderId_status_idx" ON "SupportTicket"("orderId", "status");
CREATE INDEX "SupportTicket_status_priority_dueAt_idx" ON "SupportTicket"("status", "priority", "dueAt");
CREATE INDEX "SupportTicket_assignedToUserId_status_idx" ON "SupportTicket"("assignedToUserId", "status");
CREATE UNIQUE INDEX "LegalDocumentVersion_documentType_version_key" ON "LegalDocumentVersion"("documentType", "version");
CREATE INDEX "LegalDocumentVersion_version_publishedAt_idx" ON "LegalDocumentVersion"("version", "publishedAt");
CREATE INDEX "Order_status_companionResponseDeadlineAt_idx" ON "Order"("status", "companionResponseDeadlineAt");

ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_notificationId_fkey"
  FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WeChatSubscriptionGrant" ADD CONSTRAINT "WeChatSubscriptionGrant_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanionEarning" ADD CONSTRAINT "CompanionEarning_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanionEarning" ADD CONSTRAINT "CompanionEarning_companionId_fkey"
  FOREIGN KEY ("companionId") REFERENCES "CompanionProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_assignedToUserId_fkey"
  FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
