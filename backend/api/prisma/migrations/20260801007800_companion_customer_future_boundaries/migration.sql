-- A reason-free, companion-owned boundary for future orders and recommendation
-- delivery. Existing transactional, conversation, support and safety records
-- deliberately have no foreign key to this table and therefore remain intact.
CREATE TABLE "CompanionCustomerFutureBoundary" (
  "id" TEXT NOT NULL,
  "companionId" TEXT NOT NULL,
  "customerUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CompanionCustomerFutureBoundary_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanionCustomerFutureBoundary_companionId_customerUserId_key"
  ON "CompanionCustomerFutureBoundary"("companionId", "customerUserId");
CREATE INDEX "CompanionCustomerFutureBoundary_customerUserId_createdAt_idx"
  ON "CompanionCustomerFutureBoundary"("customerUserId", "createdAt");
CREATE INDEX "CompanionCustomerFutureBoundary_companionId_createdAt_idx"
  ON "CompanionCustomerFutureBoundary"("companionId", "createdAt");

ALTER TABLE "CompanionCustomerFutureBoundary"
  ADD CONSTRAINT "CompanionCustomerFutureBoundary_companionId_fkey"
    FOREIGN KEY ("companionId") REFERENCES "CompanionProfile"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CompanionCustomerFutureBoundary_customerUserId_fkey"
    FOREIGN KEY ("customerUserId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
