ALTER TYPE "RefundTxnStatus" ADD VALUE IF NOT EXISTS 'pendingReview';
ALTER TYPE "RefundTxnStatus" ADD VALUE IF NOT EXISTS 'rejected';

CREATE TYPE "CommunityPostKind" AS ENUM ('femaleRequest', 'malePromotion');
CREATE TYPE "CommunityPostStatus" AS ENUM ('pending', 'approved', 'rejected');

ALTER TABLE "CompanionProfile" ADD COLUMN "ownerUserId" TEXT;
CREATE UNIQUE INDEX "CompanionProfile_ownerUserId_key" ON "CompanionProfile"("ownerUserId");
CREATE INDEX "CompanionProfile_ownerUserId_idx" ON "CompanionProfile"("ownerUserId");
ALTER TABLE "CompanionProfile" ADD CONSTRAINT "CompanionProfile_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Order"
  ADD COLUMN "scheduledAt" TIMESTAMP(3),
  ADD COLUMN "companionNameSnapshot" TEXT,
  ADD COLUMN "companionRoleSnapshot" TEXT,
  ADD COLUMN "companionInitialsSnapshot" TEXT,
  ADD COLUMN "themeNameSnapshot" TEXT;

UPDATE "Order" AS o SET
  "scheduledAt" = o."createdAt",
  "companionNameSnapshot" = c."name",
  "companionRoleSnapshot" = c."role",
  "companionInitialsSnapshot" = c."initials",
  "themeNameSnapshot" = CASE o."themeId"
    WHEN 't1' THEN '情绪倾听'
    WHEN 't2' THEN '职场减压'
    WHEN 't3' THEN '睡前语音'
    WHEN 't4' THEN '学习陪伴'
    WHEN 't5' THEN '运动鼓励'
    WHEN 't6' THEN '兴趣聊天'
    ELSE '线上沟通'
  END
FROM "CompanionProfile" AS c
WHERE c."id" = o."companionId";

ALTER TABLE "Order"
  ALTER COLUMN "scheduledAt" SET NOT NULL,
  ALTER COLUMN "companionNameSnapshot" SET NOT NULL,
  ALTER COLUMN "companionRoleSnapshot" SET NOT NULL,
  ALTER COLUMN "companionInitialsSnapshot" SET NOT NULL,
  ALTER COLUMN "themeNameSnapshot" SET NOT NULL;

ALTER TABLE "RefundTransaction"
  ADD COLUMN "reviewedById" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewNote" TEXT,
  ADD COLUMN "failureReason" TEXT;

CREATE TABLE "CommunityPost" (
  "id" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "kind" "CommunityPostKind" NOT NULL,
  "topic" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "coverImageUrl" TEXT,
  "coverAspectRatio" DOUBLE PRECISION,
  "status" "CommunityPostStatus" NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunityPost_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommunityPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CommunityPost_status_createdAt_idx" ON "CommunityPost"("status", "createdAt");
CREATE INDEX "CommunityPost_authorId_createdAt_idx" ON "CommunityPost"("authorId", "createdAt");

CREATE TABLE "CommunityLike" (
  "postId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunityLike_pkey" PRIMARY KEY ("postId", "userId"),
  CONSTRAINT "CommunityLike_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CommunityPost"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CommunityLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CommunityLike_userId_idx" ON "CommunityLike"("userId");

CREATE TABLE "Review" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "companionId" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Review_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Review_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Review_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Review_companionId_fkey" FOREIGN KEY ("companionId") REFERENCES "CompanionProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Review_orderId_key" ON "Review"("orderId");
CREATE INDEX "Review_companionId_createdAt_idx" ON "Review"("companionId", "createdAt");
CREATE INDEX "Review_userId_createdAt_idx" ON "Review"("userId", "createdAt");
