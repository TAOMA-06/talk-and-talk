-- WeChat grants authorize one concrete template, not a mutable logical key.
-- Existing grants intentionally remain unmatched and expire without use.
ALTER TABLE "WeChatSubscriptionGrant" ADD COLUMN "templateId" TEXT;

DROP INDEX IF EXISTS "WeChatSubscriptionGrant_userId_templateKey_consumedAt_grantedAt_idx";
CREATE INDEX "WeChatSubscriptionGrant_userId_templateKey_templateId_consumedAt_grantedAt_idx"
ON "WeChatSubscriptionGrant"("userId", "templateKey", "templateId", "consumedAt", "grantedAt");
