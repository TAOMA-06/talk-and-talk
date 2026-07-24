-- A participant-owned, active-only boundary for one platform conversation.
-- Deleting the row restores normal conversation behavior; no block history is retained.
CREATE TABLE "ConversationBlock" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "blockedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationBlock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConversationBlock_conversationId_blockedByUserId_key"
  ON "ConversationBlock"("conversationId", "blockedByUserId");
CREATE INDEX "ConversationBlock_blockedByUserId_createdAt_idx"
  ON "ConversationBlock"("blockedByUserId", "createdAt");

ALTER TABLE "ConversationBlock" ADD CONSTRAINT "ConversationBlock_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationBlock" ADD CONSTRAINT "ConversationBlock_blockedByUserId_fkey"
  FOREIGN KEY ("blockedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
