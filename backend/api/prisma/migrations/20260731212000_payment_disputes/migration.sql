CREATE TYPE "PaymentDisputeStatus" AS ENUM ('pendingSync', 'open', 'processing', 'resolved', 'syncFailed');
CREATE TYPE "PaymentDisputeFundingStatus" AS ENUM ('unlinked', 'held', 'recoveryRequired', 'released');
CREATE TYPE "PaymentDisputeReplyStatus" AS ENUM ('submitting', 'submitted', 'outcomeUnknown');

ALTER TYPE "CompanionRecoveryReason" ADD VALUE 'paymentDisputeAfterPayout';
ALTER TABLE "CompanionRecovery" ALTER COLUMN "refundId" DROP NOT NULL;

CREATE TABLE "PaymentDispute" (
  "id" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "providerDisputeId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "orderId" TEXT,
  "paymentId" TEXT,
  "outTradeNo" TEXT,
  "status" "PaymentDisputeStatus" NOT NULL DEFAULT 'pendingSync',
  "providerStatus" TEXT,
  "problemType" TEXT,
  "complaintDetail" TEXT,
  "complaintOccurredAt" TIMESTAMP(3),
  "firstResponseDueAt" TIMESTAMP(3),
  "resolutionDueAt" TIMESTAMP(3),
  "firstRespondedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "incomingUserResponse" BOOLEAN NOT NULL DEFAULT false,
  "complaintCount" INTEGER NOT NULL DEFAULT 1,
  "complaintFullRefunded" BOOLEAN NOT NULL DEFAULT false,
  "requiresImmediateService" BOOLEAN NOT NULL DEFAULT false,
  "inPlatformService" BOOLEAN NOT NULL DEFAULT false,
  "applyRefundAmountCents" INTEGER,
  "latestActionType" TEXT,
  "fundingStatus" "PaymentDisputeFundingStatus" NOT NULL DEFAULT 'unlinked',
  "assignedSupportUserId" TEXT,
  "assignedAt" TIMESTAMP(3),
  "completionRequestId" TEXT,
  "completionStatus" "PaymentDisputeReplyStatus",
  "completionProviderReference" TEXT,
  "completionRequestedById" TEXT,
  "completionRequestedAt" TIMESTAMP(3),
  "providerQueryAttempts" INTEGER NOT NULL DEFAULT 0,
  "lastProviderSyncAt" TIMESTAMP(3),
  "nextReconcileAt" TIMESTAMP(3),
  "reconcileLeaseToken" TEXT,
  "reconcileLeaseUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentDispute_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentDisputeReply" (
  "id" TEXT NOT NULL,
  "disputeId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "clientRequestId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "status" "PaymentDisputeReplyStatus" NOT NULL DEFAULT 'submitting',
  "providerReference" TEXT,
  "submittedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentDisputeReply_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentDisputeAttachment" (
  "id" TEXT NOT NULL,
  "disputeId" TEXT NOT NULL,
  "replyId" TEXT,
  "source" TEXT NOT NULL,
  "mediaType" TEXT NOT NULL,
  "providerMediaId" TEXT,
  "remoteUrlDigest" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentDisputeAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentDisputeNotification" (
  "id" TEXT NOT NULL,
  "disputeId" TEXT NOT NULL,
  "providerNotificationId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "actionType" TEXT NOT NULL,
  "summary" TEXT,
  "rawDigest" TEXT NOT NULL,
  "providerCreatedAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentDisputeNotification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentDisputeNegotiationEvent" (
  "id" TEXT NOT NULL,
  "disputeId" TEXT NOT NULL,
  "providerLogId" TEXT NOT NULL,
  "operator" TEXT NOT NULL,
  "operateType" TEXT NOT NULL,
  "operateDetails" TEXT,
  "operatedAt" TIMESTAMP(3),
  "mediaDigests" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentDisputeNegotiationEvent_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CompanionRecovery" ADD COLUMN "disputeId" TEXT;

CREATE UNIQUE INDEX "PaymentDispute_idempotencyKey_key" ON "PaymentDispute"("idempotencyKey");
CREATE UNIQUE INDEX "PaymentDispute_channel_providerDisputeId_key" ON "PaymentDispute"("channel", "providerDisputeId");
CREATE UNIQUE INDEX "PaymentDispute_completionRequestId_key" ON "PaymentDispute"("completionRequestId");
CREATE INDEX "PaymentDispute_status_resolutionDueAt_idx" ON "PaymentDispute"("status", "resolutionDueAt");
CREATE INDEX "PaymentDispute_nextReconcileAt_reconcileLeaseUntil_idx" ON "PaymentDispute"("nextReconcileAt", "reconcileLeaseUntil");
CREATE INDEX "PaymentDispute_orderId_status_idx" ON "PaymentDispute"("orderId", "status");
CREATE INDEX "PaymentDispute_paymentId_idx" ON "PaymentDispute"("paymentId");
CREATE INDEX "PaymentDispute_outTradeNo_idx" ON "PaymentDispute"("outTradeNo");
CREATE INDEX "PaymentDispute_assignedSupportUserId_status_idx" ON "PaymentDispute"("assignedSupportUserId", "status");

CREATE UNIQUE INDEX "PaymentDisputeReply_clientRequestId_key" ON "PaymentDisputeReply"("clientRequestId");
CREATE INDEX "PaymentDisputeReply_disputeId_createdAt_idx" ON "PaymentDisputeReply"("disputeId", "createdAt");
CREATE INDEX "PaymentDisputeReply_actorId_createdAt_idx" ON "PaymentDisputeReply"("actorId", "createdAt");

CREATE UNIQUE INDEX "PaymentDisputeAttachment_disputeId_source_providerMediaId_key" ON "PaymentDisputeAttachment"("disputeId", "source", "providerMediaId");
CREATE UNIQUE INDEX "PaymentDisputeAttachment_disputeId_source_remoteUrlDigest_key" ON "PaymentDisputeAttachment"("disputeId", "source", "remoteUrlDigest");
CREATE INDEX "PaymentDisputeAttachment_replyId_idx" ON "PaymentDisputeAttachment"("replyId");

CREATE UNIQUE INDEX "PaymentDisputeNotification_providerNotificationId_key" ON "PaymentDisputeNotification"("providerNotificationId");
CREATE INDEX "PaymentDisputeNotification_disputeId_receivedAt_idx" ON "PaymentDisputeNotification"("disputeId", "receivedAt");

CREATE UNIQUE INDEX "PaymentDisputeNegotiationEvent_disputeId_providerLogId_key" ON "PaymentDisputeNegotiationEvent"("disputeId", "providerLogId");
CREATE INDEX "PaymentDisputeNegotiationEvent_disputeId_operatedAt_idx" ON "PaymentDisputeNegotiationEvent"("disputeId", "operatedAt");

CREATE UNIQUE INDEX "CompanionRecovery_disputeId_key" ON "CompanionRecovery"("disputeId");
CREATE INDEX "CompanionRecovery_disputeId_idx" ON "CompanionRecovery"("disputeId");

ALTER TABLE "PaymentDispute" ADD CONSTRAINT "PaymentDispute_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentDispute" ADD CONSTRAINT "PaymentDispute_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "PaymentTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentDisputeReply" ADD CONSTRAINT "PaymentDisputeReply_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "PaymentDispute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentDisputeReply" ADD CONSTRAINT "PaymentDisputeReply_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentDisputeAttachment" ADD CONSTRAINT "PaymentDisputeAttachment_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "PaymentDispute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentDisputeAttachment" ADD CONSTRAINT "PaymentDisputeAttachment_replyId_fkey" FOREIGN KEY ("replyId") REFERENCES "PaymentDisputeReply"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentDisputeNotification" ADD CONSTRAINT "PaymentDisputeNotification_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "PaymentDispute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentDisputeNegotiationEvent" ADD CONSTRAINT "PaymentDisputeNegotiationEvent_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "PaymentDispute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanionRecovery" ADD CONSTRAINT "CompanionRecovery_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "PaymentDispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CompanionRecovery" ADD CONSTRAINT "CompanionRecovery_source_check"
  CHECK (("refundId" IS NOT NULL)::integer + ("disputeId" IS NOT NULL)::integer = 1);
