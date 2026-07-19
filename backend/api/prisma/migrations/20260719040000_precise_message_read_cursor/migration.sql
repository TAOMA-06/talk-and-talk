-- Keep the message id alongside readAt so messages sharing a millisecond can
-- still be marked and counted with the same (createdAt, id) order as pagination.
ALTER TABLE "MessageReadState"
ADD COLUMN "lastReadMessageId" TEXT;
