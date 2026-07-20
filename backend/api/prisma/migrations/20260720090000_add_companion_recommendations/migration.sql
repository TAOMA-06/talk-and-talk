-- Companion recommendation v1: explicit preferences, behavioral feedback,
-- durable ranked-request snapshots, and bounded operational policies.

CREATE TYPE "RecommendationPlacement" AS ENUM ('discoverHome', 'communityRelated', 'orderFollowup');
CREATE TYPE "RecommendationPolicyStatus" AS ENUM ('active', 'paused');
CREATE TYPE "RecommendationTagSource" AS ENUM ('behavioral');

ALTER TABLE "CompanionProfile"
  ADD COLUMN "topicIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Backfill the existing fixed order-theme taxonomy without changing source
-- specialties. Profiles with no recognizable specialty remain eligible for
-- generic discovery but do not receive topic-affinity score until curated.
UPDATE "CompanionProfile"
SET "topicIds" = array_remove(ARRAY[
  CASE WHEN "specialties" && ARRAY['情绪倾听']::TEXT[] THEN 't1' ELSE NULL END,
  CASE WHEN "specialties" && ARRAY['职场减压']::TEXT[] THEN 't2' ELSE NULL END,
  CASE WHEN "specialties" && ARRAY['睡前语音']::TEXT[] THEN 't3' ELSE NULL END,
  CASE WHEN "specialties" && ARRAY['学习陪伴']::TEXT[] THEN 't4' ELSE NULL END,
  CASE WHEN "specialties" && ARRAY['运动鼓励']::TEXT[] THEN 't5' ELSE NULL END,
  CASE WHEN "specialties" && ARRAY['兴趣聊天']::TEXT[] THEN 't6' ELSE NULL END
]::TEXT[], NULL);

CREATE TABLE "UserRecommendationPreference" (
  "userId" TEXT NOT NULL,
  "personalizationEnabled" BOOLEAN NOT NULL DEFAULT true,
  "topicIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "city" TEXT,
  "maxPricePerHalfHour" INTEGER,
  "preferredTimeSlots" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserRecommendationPreference_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "UserRecommendationTag" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "topicId" TEXT NOT NULL,
  "source" "RecommendationTagSource" NOT NULL DEFAULT 'behavioral',
  "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "disabledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserRecommendationTag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecommendationRequest" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "placement" "RecommendationPlacement" NOT NULL,
  "context" JSONB,
  "algorithmVersion" TEXT NOT NULL,
  "personalized" BOOLEAN NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecommendationRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecommendationImpression" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "companionId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "reasonCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "servedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "viewedAt" TIMESTAMP(3),
  "clickedAt" TIMESTAMP(3),
  CONSTRAINT "RecommendationImpression_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompanionRecommendationPolicy" (
  "id" TEXT NOT NULL,
  "companionId" TEXT NOT NULL,
  "placement" "RecommendationPlacement" NOT NULL,
  "status" "RecommendationPolicyStatus" NOT NULL DEFAULT 'active',
  "boostBps" INTEGER NOT NULL DEFAULT 0,
  "dailyCap" INTEGER,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanionRecommendationPolicy_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Order"
  ADD COLUMN "recommendationImpressionId" TEXT;

CREATE UNIQUE INDEX "Order_recommendationImpressionId_key" ON "Order"("recommendationImpressionId");
CREATE UNIQUE INDEX "UserRecommendationTag_userId_topicId_source_key" ON "UserRecommendationTag"("userId", "topicId", "source");
CREATE INDEX "UserRecommendationTag_userId_disabledAt_updatedAt_idx" ON "UserRecommendationTag"("userId", "disabledAt", "updatedAt");
CREATE INDEX "RecommendationRequest_userId_expiresAt_idx" ON "RecommendationRequest"("userId", "expiresAt");
CREATE INDEX "RecommendationRequest_placement_createdAt_idx" ON "RecommendationRequest"("placement", "createdAt");
CREATE UNIQUE INDEX "RecommendationImpression_requestId_companionId_key" ON "RecommendationImpression"("requestId", "companionId");
CREATE INDEX "RecommendationImpression_requestId_position_idx" ON "RecommendationImpression"("requestId", "position");
CREATE INDEX "RecommendationImpression_companionId_viewedAt_idx" ON "RecommendationImpression"("companionId", "viewedAt");
CREATE INDEX "RecommendationImpression_servedAt_idx" ON "RecommendationImpression"("servedAt");
CREATE UNIQUE INDEX "CompanionRecommendationPolicy_companionId_placement_key" ON "CompanionRecommendationPolicy"("companionId", "placement");
CREATE INDEX "CompanionRecommendationPolicy_placement_status_startsAt_endsAt_idx" ON "CompanionRecommendationPolicy"("placement", "status", "startsAt", "endsAt");

ALTER TABLE "UserRecommendationPreference"
  ADD CONSTRAINT "UserRecommendationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserRecommendationTag"
  ADD CONSTRAINT "UserRecommendationTag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecommendationRequest"
  ADD CONSTRAINT "RecommendationRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecommendationImpression"
  ADD CONSTRAINT "RecommendationImpression_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "RecommendationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "RecommendationImpression_companionId_fkey" FOREIGN KEY ("companionId") REFERENCES "CompanionProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanionRecommendationPolicy"
  ADD CONSTRAINT "CompanionRecommendationPolicy_companionId_fkey" FOREIGN KEY ("companionId") REFERENCES "CompanionProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_recommendationImpressionId_fkey" FOREIGN KEY ("recommendationImpressionId") REFERENCES "RecommendationImpression"("id") ON DELETE SET NULL ON UPDATE CASCADE;
