-- A voice room is an order-scoped provider resource, never a general chat
-- room. Access eligibility remains derived from the order state; this table
-- stores only the stable opaque room identity and non-sensitive access facts.
CREATE TABLE "VoiceSession" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'trtc',
  "roomId" TEXT NOT NULL,
  "firstAccessedAt" TIMESTAMP(3),
  "lastAccessedAt" TIMESTAMP(3),
  "accessCount" INTEGER NOT NULL DEFAULT 0,
  "terminationRequestedAt" TIMESTAMP(3),
  "terminationCompletedAt" TIMESTAMP(3),
  "terminationReason" TEXT,
  "terminationAttempts" INTEGER NOT NULL DEFAULT 0,
  "terminationNextAttemptAt" TIMESTAMP(3),
  "terminationLeaseUntil" TIMESTAMP(3),
  "terminationLastError" TEXT,
  "terminationProviderRequestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VoiceSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VoiceSession_orderId_key" ON "VoiceSession"("orderId");
CREATE UNIQUE INDEX "VoiceSession_roomId_key" ON "VoiceSession"("roomId");
CREATE INDEX "VoiceSession_terminationCompletedAt_terminationNextAttemptAt_terminationLeaseUntil_idx"
  ON "VoiceSession"("terminationCompletedAt", "terminationNextAttemptAt", "terminationLeaseUntil");

ALTER TABLE "VoiceSession"
  ADD CONSTRAINT "VoiceSession_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
