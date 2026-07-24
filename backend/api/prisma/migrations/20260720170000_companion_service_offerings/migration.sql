-- A companion can expose multiple independently priced services without
-- changing the legacy order contract during the transition.
CREATE TYPE "CompanionServiceOfferingMode" AS ENUM ('text', 'voice');

CREATE TABLE "CompanionServiceOffering" (
  "id" TEXT NOT NULL,
  "companionId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "deliveryMode" "CompanionServiceOfferingMode" NOT NULL,
  "durationMinutes" INTEGER NOT NULL,
  "priceCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'CNY',
  "topicIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CompanionServiceOffering_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CompanionServiceOffering_durationMinutes_check" CHECK ("durationMinutes" >= 30 AND "durationMinutes" <= 240 AND "durationMinutes" % 30 = 0),
  CONSTRAINT "CompanionServiceOffering_priceCents_check" CHECK ("priceCents" > 0),
  CONSTRAINT "CompanionServiceOffering_sortOrder_check" CHECK ("sortOrder" >= 0),
  CONSTRAINT "CompanionServiceOffering_currency_check" CHECK ("currency" = 'CNY')
);

CREATE UNIQUE INDEX "CompanionServiceOffering_companionId_code_key"
  ON "CompanionServiceOffering"("companionId", "code");
CREATE INDEX "CompanionServiceOffering_companionId_isActive_sortOrder_idx"
  ON "CompanionServiceOffering"("companionId", "isActive", "sortOrder");

ALTER TABLE "CompanionServiceOffering"
  ADD CONSTRAINT "CompanionServiceOffering_companionId_fkey"
  FOREIGN KEY ("companionId") REFERENCES "CompanionProfile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve existing public pricing during rollout. New service management can
-- replace this standard offering later, while historical orders keep using
-- their own price and duration snapshots.
INSERT INTO "CompanionServiceOffering" (
  "id", "companionId", "code", "title", "deliveryMode", "durationMinutes",
  "priceCents", "currency", "topicIds", "isActive", "sortOrder", "createdAt", "updatedAt"
)
SELECT
  CONCAT('legacy-standard-', "id"),
  "id",
  'legacy-standard',
  '线上文字陪伴',
  'text'::"CompanionServiceOfferingMode",
  30,
  "pricePerHalfHour" * 100,
  'CNY',
  "topicIds",
  true,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "CompanionProfile"
ON CONFLICT ("companionId", "code") DO NOTHING;
