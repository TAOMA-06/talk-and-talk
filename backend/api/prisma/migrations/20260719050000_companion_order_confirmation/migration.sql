ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "companionConfirmedAt" TIMESTAMP(3);

-- A published listing without an accountable, verified owner cannot accept or
-- deliver a commercial order. Hide legacy orphan listings during migration.
UPDATE "CompanionProfile"
SET "isPublished" = FALSE
WHERE "ownerUserId" IS NULL;

-- Existing unpaid orders require an explicit fresh confirmation. Already paid
-- orders are historical evidence that the service was accepted.
UPDATE "Order"
SET "companionConfirmedAt" = COALESCE("paidAt", "updatedAt")
WHERE "status" IN ('paid', 'inService', 'completed', 'refunded');

CREATE INDEX IF NOT EXISTS "Order_companionId_companionConfirmedAt_idx"
  ON "Order"("companionId", "companionConfirmedAt");
