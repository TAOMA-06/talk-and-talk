-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN "age" INTEGER;

-- CreateEnum
CREATE TYPE "Availability" AS ENUM ('online', 'available', 'busy');

-- CreateTable
CREATE TABLE "CompanionProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "initials" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "pricePerHalfHour" INTEGER NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "bio" TEXT NOT NULL,
    "availableTimes" TEXT[],
    "languages" TEXT[],
    "specialties" TEXT[],
    "completedOrders" INTEGER NOT NULL DEFAULT 0,
    "responseTime" TEXT NOT NULL,
    "distanceKm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "availability" "Availability" NOT NULL DEFAULT 'available',
    "cityDistrict" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanionProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceTag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanionServiceTag" (
    "companionId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "CompanionServiceTag_pkey" PRIMARY KEY ("companionId","tagId")
);

-- CreateIndex
CREATE INDEX "CompanionProfile_isPublished_availability_idx" ON "CompanionProfile"("isPublished", "availability");

-- CreateIndex
CREATE INDEX "CompanionProfile_isOnline_idx" ON "CompanionProfile"("isOnline");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceTag_name_key" ON "ServiceTag"("name");

-- CreateIndex
CREATE INDEX "CompanionServiceTag_tagId_idx" ON "CompanionServiceTag"("tagId");

-- AddForeignKey
ALTER TABLE "CompanionServiceTag" ADD CONSTRAINT "CompanionServiceTag_companionId_fkey" FOREIGN KEY ("companionId") REFERENCES "CompanionProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanionServiceTag" ADD CONSTRAINT "CompanionServiceTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "ServiceTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
