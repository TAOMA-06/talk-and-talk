CREATE TYPE "IdentityVerificationRequestStatus" AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE "IdentityVerificationRequest" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "requestedIsVerified" BOOLEAN NOT NULL,
  "previousIsVerified" BOOLEAN NOT NULL,
  "status" "IdentityVerificationRequestStatus" NOT NULL DEFAULT 'pending',
  "reason" TEXT NOT NULL,
  "evidenceReference" TEXT NOT NULL,
  "submittedById" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "IdentityVerificationRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IdentityVerificationRequest_evidenceReference_key"
  ON "IdentityVerificationRequest"("evidenceReference");
CREATE UNIQUE INDEX "IdentityVerificationRequest_one_pending_per_user_key"
  ON "IdentityVerificationRequest"("userId")
  WHERE "status" = 'pending';
CREATE INDEX "IdentityVerificationRequest_status_submittedAt_idx"
  ON "IdentityVerificationRequest"("status", "submittedAt");
CREATE INDEX "IdentityVerificationRequest_userId_status_createdAt_idx"
  ON "IdentityVerificationRequest"("userId", "status", "createdAt");
CREATE INDEX "IdentityVerificationRequest_submittedById_createdAt_idx"
  ON "IdentityVerificationRequest"("submittedById", "createdAt");
CREATE INDEX "IdentityVerificationRequest_reviewedById_reviewedAt_idx"
  ON "IdentityVerificationRequest"("reviewedById", "reviewedAt");

ALTER TABLE "IdentityVerificationRequest"
  ADD CONSTRAINT "IdentityVerificationRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IdentityVerificationRequest"
  ADD CONSTRAINT "IdentityVerificationRequest_submittedById_fkey"
  FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IdentityVerificationRequest"
  ADD CONSTRAINT "IdentityVerificationRequest_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
