CREATE TABLE "StaffCredential" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "totpSecretCiphertext" TEXT NOT NULL,
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  "lastLoginAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StaffCredential_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StaffCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "StaffCredential_userId_key" ON "StaffCredential"("userId");
CREATE UNIQUE INDEX "StaffCredential_username_key" ON "StaffCredential"("username");
CREATE INDEX "StaffCredential_username_lockedUntil_idx" ON "StaffCredential"("username", "lockedUntil");
