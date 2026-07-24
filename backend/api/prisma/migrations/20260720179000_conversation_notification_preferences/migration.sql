-- Participant-owned conversation muting. A row exists only while the owner
-- has muted the conversation; deleting it restores the default behavior.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'messageReceived';

CREATE TABLE "ConversationNotificationPreference" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mutedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationNotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConversationNotificationPreference_conversationId_userId_key"
ON "ConversationNotificationPreference"("conversationId", "userId");

CREATE INDEX "ConversationNotificationPreference_userId_idx"
ON "ConversationNotificationPreference"("userId");

ALTER TABLE "ConversationNotificationPreference"
ADD CONSTRAINT "ConversationNotificationPreference_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConversationNotificationPreference"
ADD CONSTRAINT "ConversationNotificationPreference_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
