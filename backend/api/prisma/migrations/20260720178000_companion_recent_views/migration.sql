CREATE TABLE "CompanionRecentView" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companionId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanionRecentView_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanionRecentView_userId_companionId_key"
ON "CompanionRecentView"("userId", "companionId");

CREATE INDEX "CompanionRecentView_userId_viewedAt_idx"
ON "CompanionRecentView"("userId", "viewedAt");

CREATE INDEX "CompanionRecentView_companionId_idx"
ON "CompanionRecentView"("companionId");

ALTER TABLE "CompanionRecentView"
ADD CONSTRAINT "CompanionRecentView_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanionRecentView"
ADD CONSTRAINT "CompanionRecentView_companionId_fkey"
FOREIGN KEY ("companionId") REFERENCES "CompanionProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
