-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('text', 'system', 'safety');

-- CreateEnum
CREATE TYPE "ModerationDecision" AS ENUM ('allow', 'warn', 'block', 'review');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "ModerationSource" AS ENUM ('chat', 'community', 'report', 'profile');

-- CreateEnum
CREATE TYPE "ModerationCaseStatus" AS ENUM ('pending', 'autoReviewing', 'humanReview', 'resolved', 'dismissed');

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderName" TEXT,
    "content" TEXT NOT NULL,
    "type" "MessageType" NOT NULL DEFAULT 'text',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageReadState" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageReadState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationCase" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL,
    "status" "ModerationCaseStatus" NOT NULL DEFAULT 'pending',
    "source" "ModerationSource" NOT NULL,
    "content" TEXT NOT NULL,
    "targetId" TEXT,
    "aiScore" DOUBLE PRECISION NOT NULL,
    "aiReason" TEXT NOT NULL,
    "decision" "ModerationDecision" NOT NULL,
    "matchedRules" TEXT[],
    "usedAI" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_userId_externalId_key" ON "Conversation"("userId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_userId_companionId_key" ON "Conversation"("userId", "companionId");

-- CreateIndex
CREATE INDEX "Conversation_userId_updatedAt_idx" ON "Conversation"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "Conversation_companionId_idx" ON "Conversation"("companionId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_id_idx" ON "Message"("conversationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Message_senderId_idx" ON "Message"("senderId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageReadState_conversationId_userId_key" ON "MessageReadState"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "MessageReadState_userId_idx" ON "MessageReadState"("userId");

-- CreateIndex
CREATE INDEX "ModerationCase_source_status_idx" ON "ModerationCase"("source", "status");

-- CreateIndex
CREATE INDEX "ModerationCase_targetId_idx" ON "ModerationCase"("targetId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_companionId_fkey" FOREIGN KEY ("companionId") REFERENCES "CompanionProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageReadState" ADD CONSTRAINT "MessageReadState_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageReadState" ADD CONSTRAINT "MessageReadState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
