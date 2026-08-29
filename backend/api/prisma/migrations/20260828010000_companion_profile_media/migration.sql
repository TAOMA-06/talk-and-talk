ALTER TYPE "MediaAssetPurpose" ADD VALUE IF NOT EXISTS 'companionAvatar';
ALTER TYPE "MediaAssetPurpose" ADD VALUE IF NOT EXISTS 'companionCover';

ALTER TABLE "MediaAsset"
  ADD COLUMN "profileCompanionId" TEXT;

ALTER TABLE "CompanionProfile"
  ADD COLUMN "avatarAssetId" TEXT,
  ADD COLUMN "coverAssetId" TEXT;

ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "MediaAsset_profileCompanionId_fkey"
    FOREIGN KEY ("profileCompanionId") REFERENCES "CompanionProfile"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CompanionProfile"
  ADD CONSTRAINT "CompanionProfile_avatarAssetId_fkey"
    FOREIGN KEY ("avatarAssetId") REFERENCES "MediaAsset"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "CompanionProfile_coverAssetId_fkey"
    FOREIGN KEY ("coverAssetId") REFERENCES "MediaAsset"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "CompanionProfile_avatarAssetId_key"
  ON "CompanionProfile"("avatarAssetId");
CREATE UNIQUE INDEX "CompanionProfile_coverAssetId_key"
  ON "CompanionProfile"("coverAssetId");
CREATE INDEX "MediaAsset_companion_profile_media_scope"
  ON "MediaAsset"("purpose", "profileCompanionId", "uploaderId", "status", "createdAt");

ALTER TABLE "MediaAsset"
  DROP CONSTRAINT "MediaAsset_controlled_purpose_scope_check";

ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "MediaAsset_controlled_purpose_scope_check" CHECK (
    (
      "purpose"::TEXT = 'chatMessage'
      AND "conversationId" IS NOT NULL
      AND "supportTicketId" IS NULL
      AND "attendanceDisputeId" IS NULL
      AND "companionId" IS NULL
      AND "userAccountActionId" IS NULL
      AND "companionAccountActionId" IS NULL
      AND "profileCompanionId" IS NULL
    ) OR (
      "purpose"::TEXT = 'orderSupportFact'
      AND "conversationId" IS NULL AND "messageId" IS NULL
      AND "supportTicketId" IS NOT NULL
      AND "attendanceDisputeId" IS NULL AND "companionId" IS NULL
      AND "userAccountActionId" IS NULL AND "companionAccountActionId" IS NULL
      AND "profileCompanionId" IS NULL AND "uploadExpiresAt" IS NOT NULL
    ) OR (
      "purpose"::TEXT = 'attendanceDisputeStatement'
      AND "conversationId" IS NULL AND "messageId" IS NULL
      AND "supportTicketId" IS NULL
      AND "attendanceDisputeId" IS NOT NULL
      AND "companionId" IS NULL AND "userAccountActionId" IS NULL
      AND "companionAccountActionId" IS NULL AND "profileCompanionId" IS NULL
      AND "uploadExpiresAt" IS NOT NULL
    ) OR (
      "purpose"::TEXT = 'companionIncidentReport'
      AND "conversationId" IS NULL AND "messageId" IS NULL
      AND "supportTicketId" IS NULL AND "attendanceDisputeId" IS NULL
      AND "companionId" IS NOT NULL
      AND "userAccountActionId" IS NULL AND "companionAccountActionId" IS NULL
      AND "profileCompanionId" IS NULL AND "uploadExpiresAt" IS NOT NULL
    ) OR (
      "purpose"::TEXT = 'userAccountAppeal'
      AND "conversationId" IS NULL AND "messageId" IS NULL
      AND "supportTicketId" IS NULL AND "attendanceDisputeId" IS NULL
      AND "companionId" IS NULL AND "userAccountActionId" IS NOT NULL
      AND "companionAccountActionId" IS NULL AND "profileCompanionId" IS NULL
      AND "uploadExpiresAt" IS NOT NULL
    ) OR (
      "purpose"::TEXT = 'companionAccountAppeal'
      AND "conversationId" IS NULL AND "messageId" IS NULL
      AND "supportTicketId" IS NULL AND "attendanceDisputeId" IS NULL
      AND "companionId" IS NULL AND "userAccountActionId" IS NULL
      AND "companionAccountActionId" IS NOT NULL AND "profileCompanionId" IS NULL
      AND "uploadExpiresAt" IS NOT NULL
    ) OR (
      "purpose"::TEXT IN ('companionAvatar', 'companionCover')
      AND "conversationId" IS NULL AND "messageId" IS NULL
      AND "supportTicketId" IS NULL AND "attendanceDisputeId" IS NULL
      AND "companionId" IS NULL AND "userAccountActionId" IS NULL
      AND "companionAccountActionId" IS NULL AND "profileCompanionId" IS NOT NULL
      AND "uploadExpiresAt" IS NOT NULL
    )
  );

ALTER TABLE "MediaAsset"
  DROP CONSTRAINT "MediaAsset_controlled_storage_key_check";

ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "MediaAsset_controlled_storage_key_check" CHECK (
    "purpose"::TEXT = 'chatMessage'
    OR "storageKey" LIKE 'case-evidence/%'
    OR (
      "purpose"::TEXT IN ('companionAvatar', 'companionCover')
      AND "storageKey" LIKE 'profile-media/%'
    )
  );
