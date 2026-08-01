CREATE TYPE "VoiceAttendanceParticipantRole" AS ENUM ('customer', 'companion', 'system');
CREATE TYPE "VoiceAttendanceEventSource" AS ENUM ('provider', 'client');
CREATE TYPE "VoiceAttendanceEventType" AS ENUM ('roomCreated', 'roomDismissed', 'join', 'leave', 'reconnect', 'heartbeat', 'audioStarted', 'audioStopped');
CREATE TYPE "AttendanceDisputeIssue" AS ENUM ('companionAbsent', 'customerAbsent', 'lateArrival', 'technicalFailure', 'earlyExit', 'serviceMismatch', 'safetyBoundary', 'other');
CREATE TYPE "AttendanceDisputeStatus" AS ENUM ('evidenceCollection', 'counterpartyResponse', 'review', 'decided', 'appealed', 'final');
CREATE TYPE "AttendanceDisputeDecision" AS ENUM ('noRefund', 'fullRefund');
CREATE TYPE "AttendanceDisputeStatementKind" AS ENUM ('initial', 'evidence', 'counterpartyResponse', 'appeal', 'appealResponse');

ALTER TABLE "Order"
  ADD COLUMN "fulfillmentPolicyVersionSnapshot" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "fulfillmentTimezoneSnapshot" TEXT NOT NULL DEFAULT 'Asia/Shanghai';

CREATE TABLE "VoiceAttendanceEvent" (
  "id" TEXT NOT NULL,
  "voiceSessionId" TEXT NOT NULL,
  "participantUserId" TEXT,
  "participantRole" "VoiceAttendanceParticipantRole" NOT NULL,
  "type" "VoiceAttendanceEventType" NOT NULL,
  "source" "VoiceAttendanceEventSource" NOT NULL,
  "providerEventId" TEXT,
  "clientEventId" TEXT,
  "providerOccurredAt" TIMESTAMP(3),
  "clientClaimedAt" TIMESTAMP(3),
  "serverReceivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "providerReasonCode" INTEGER,
  "providerUniqueId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VoiceAttendanceEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AttendanceDispute" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "openedByUserId" TEXT NOT NULL,
  "openedByRole" "VoiceAttendanceParticipantRole" NOT NULL,
  "counterpartyUserId" TEXT NOT NULL,
  "issue" "AttendanceDisputeIssue" NOT NULL,
  "status" "AttendanceDisputeStatus" NOT NULL DEFAULT 'evidenceCollection',
  "policyVersionSnapshot" TEXT NOT NULL,
  "timezoneSnapshot" TEXT NOT NULL,
  "evidenceDueAt" TIMESTAMP(3) NOT NULL,
  "counterpartyResponseDueAt" TIMESTAMP(3) NOT NULL,
  "assignedToUserId" TEXT,
  "assignedAt" TIMESTAMP(3),
  "decision" "AttendanceDisputeDecision",
  "decisionReason" TEXT,
  "decidedByUserId" TEXT,
  "decidedAt" TIMESTAMP(3),
  "appealDeadlineAt" TIMESTAMP(3),
  "appealedByUserId" TEXT,
  "appealedAt" TIMESTAMP(3),
  "appealResponseDueAt" TIMESTAMP(3),
  "appealAssignedToUserId" TEXT,
  "appealAssignedAt" TIMESTAMP(3),
  "appealReviewedByUserId" TEXT,
  "appealReviewedAt" TIMESTAMP(3),
  "finalDecision" "AttendanceDisputeDecision",
  "finalReason" TEXT,
  "finalizedAt" TIMESTAMP(3),
  "refundTransactionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AttendanceDispute_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AttendanceDisputeStatement" (
  "id" TEXT NOT NULL,
  "disputeId" TEXT NOT NULL,
  "submittedByUserId" TEXT NOT NULL,
  "kind" "AttendanceDisputeStatementKind" NOT NULL,
  "statement" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttendanceDisputeStatement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VoiceAttendanceEvent_providerEventId_key" ON "VoiceAttendanceEvent"("providerEventId");
CREATE UNIQUE INDEX "VoiceAttendanceEvent_voiceSessionId_participantUserId_clien_key" ON "VoiceAttendanceEvent"("voiceSessionId", "participantUserId", "clientEventId");
CREATE INDEX "VoiceAttendanceEvent_voiceSessionId_participantRole_provide_idx" ON "VoiceAttendanceEvent"("voiceSessionId", "participantRole", "providerOccurredAt");
CREATE INDEX "VoiceAttendanceEvent_participantUserId_serverReceivedAt_idx" ON "VoiceAttendanceEvent"("participantUserId", "serverReceivedAt");

CREATE UNIQUE INDEX "AttendanceDispute_orderId_key" ON "AttendanceDispute"("orderId");
CREATE UNIQUE INDEX "AttendanceDispute_refundTransactionId_key" ON "AttendanceDispute"("refundTransactionId");
CREATE INDEX "AttendanceDispute_status_evidenceDueAt_counterpartyResponse_idx" ON "AttendanceDispute"("status", "evidenceDueAt", "counterpartyResponseDueAt");
CREATE INDEX "AttendanceDispute_assignedToUserId_status_createdAt_idx" ON "AttendanceDispute"("assignedToUserId", "status", "createdAt");
CREATE INDEX "AttendanceDispute_appealAssignedToUserId_status_createdAt_idx" ON "AttendanceDispute"("appealAssignedToUserId", "status", "createdAt");
CREATE INDEX "AttendanceDispute_openedByUserId_createdAt_idx" ON "AttendanceDispute"("openedByUserId", "createdAt");
CREATE INDEX "AttendanceDispute_counterpartyUserId_createdAt_idx" ON "AttendanceDispute"("counterpartyUserId", "createdAt");

CREATE INDEX "AttendanceDisputeStatement_disputeId_createdAt_idx" ON "AttendanceDisputeStatement"("disputeId", "createdAt");
CREATE INDEX "AttendanceDisputeStatement_submittedByUserId_createdAt_idx" ON "AttendanceDisputeStatement"("submittedByUserId", "createdAt");

ALTER TABLE "VoiceAttendanceEvent" ADD CONSTRAINT "VoiceAttendanceEvent_voiceSessionId_fkey" FOREIGN KEY ("voiceSessionId") REFERENCES "VoiceSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VoiceAttendanceEvent" ADD CONSTRAINT "VoiceAttendanceEvent_participantUserId_fkey" FOREIGN KEY ("participantUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AttendanceDispute" ADD CONSTRAINT "AttendanceDispute_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceDispute" ADD CONSTRAINT "AttendanceDispute_openedByUserId_fkey" FOREIGN KEY ("openedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendanceDispute" ADD CONSTRAINT "AttendanceDispute_counterpartyUserId_fkey" FOREIGN KEY ("counterpartyUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendanceDispute" ADD CONSTRAINT "AttendanceDispute_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendanceDispute" ADD CONSTRAINT "AttendanceDispute_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendanceDispute" ADD CONSTRAINT "AttendanceDispute_appealAssignedToUserId_fkey" FOREIGN KEY ("appealAssignedToUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendanceDispute" ADD CONSTRAINT "AttendanceDispute_appealReviewedByUserId_fkey" FOREIGN KEY ("appealReviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendanceDispute" ADD CONSTRAINT "AttendanceDispute_refundTransactionId_fkey" FOREIGN KEY ("refundTransactionId") REFERENCES "RefundTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AttendanceDisputeStatement" ADD CONSTRAINT "AttendanceDisputeStatement_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "AttendanceDispute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceDisputeStatement" ADD CONSTRAINT "AttendanceDisputeStatement_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
