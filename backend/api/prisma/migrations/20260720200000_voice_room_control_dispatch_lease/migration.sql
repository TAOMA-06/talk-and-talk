-- A provider-wide lease prevents multiple horizontally scaled API replicas
-- from dispatching independent batches to TRTC at the same time. It contains
-- no customer, audio, or credential data.
CREATE TABLE "VoiceRoomControlDispatchLease" (
  "id" TEXT NOT NULL,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VoiceRoomControlDispatchLease_pkey" PRIMARY KEY ("id")
);
