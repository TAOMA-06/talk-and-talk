-- A client retry must resolve to the original order instead of creating a
-- second financial intent. NULL preserves compatibility with historical and
-- non-Mini-Program callers; the commercial client always supplies the key.
ALTER TABLE "Order" ADD COLUMN "clientRequestId" TEXT;

CREATE UNIQUE INDEX "Order_userId_clientRequestId_key"
ON "Order"("userId", "clientRequestId");
