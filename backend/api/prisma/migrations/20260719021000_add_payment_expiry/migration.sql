ALTER TABLE "PaymentTransaction" ADD COLUMN "expiresAt" TIMESTAMP(3);

-- Give legacy initiated rows the same conservative expiry policy as new
-- prepay orders. They are not closed locally until WeChat confirms close.
UPDATE "PaymentTransaction"
SET "expiresAt" = "createdAt" + INTERVAL '15 minutes'
WHERE "status" = 'initiated' AND "expiresAt" IS NULL;

CREATE INDEX "PaymentTransaction_status_expiresAt_idx"
ON "PaymentTransaction"("status", "expiresAt");
