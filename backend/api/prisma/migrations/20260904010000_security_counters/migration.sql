CREATE TABLE "SecurityCounter" (
    "keyHash" CHAR(64) NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityCounter_pkey" PRIMARY KEY ("keyHash"),
    CONSTRAINT "SecurityCounter_value_check" CHECK ("value" >= 1)
);

CREATE INDEX "SecurityCounter_expiry"
ON "SecurityCounter"("expiresAt", "keyHash");
