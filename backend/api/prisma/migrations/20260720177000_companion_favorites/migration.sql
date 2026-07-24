CREATE TABLE "CompanionFavorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanionFavorite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanionFavorite_userId_companionId_key"
ON "CompanionFavorite"("userId", "companionId");

CREATE INDEX "CompanionFavorite_userId_createdAt_idx"
ON "CompanionFavorite"("userId", "createdAt");

CREATE INDEX "CompanionFavorite_companionId_idx"
ON "CompanionFavorite"("companionId");

ALTER TABLE "CompanionFavorite"
ADD CONSTRAINT "CompanionFavorite_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanionFavorite"
ADD CONSTRAINT "CompanionFavorite_companionId_fkey"
FOREIGN KEY ("companionId") REFERENCES "CompanionProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
