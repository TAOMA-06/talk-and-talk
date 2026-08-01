CREATE TABLE "UserCompanionRecommendationExclusion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companionId" TEXT NOT NULL,
    "companionNameSnapshot" TEXT NOT NULL,
    "companionRoleSnapshot" TEXT NOT NULL,
    "companionInitialsSnapshot" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCompanionRecommendationExclusion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserCompanionRecommendationExclusion_userId_companionId_key"
ON "UserCompanionRecommendationExclusion"("userId", "companionId");

CREATE INDEX "UserCompanionRecommendationExclusion_userId_createdAt_idx"
ON "UserCompanionRecommendationExclusion"("userId", "createdAt");

CREATE INDEX "UserCompanionRecommendationExclusion_companionId_idx"
ON "UserCompanionRecommendationExclusion"("companionId");

ALTER TABLE "UserCompanionRecommendationExclusion"
ADD CONSTRAINT "UserCompanionRecommendationExclusion_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserCompanionRecommendationExclusion"
ADD CONSTRAINT "UserCompanionRecommendationExclusion_companionId_fkey"
FOREIGN KEY ("companionId") REFERENCES "CompanionProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
