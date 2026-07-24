-- Reporter-owned receipts make repeat community reports idempotent without
-- placing reason text or a social/reporting graph on the public post.
CREATE TABLE "CommunityPostReport" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "reporterUserId" TEXT NOT NULL,
    "moderationCaseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityPostReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommunityPostReport_moderationCaseId_key"
  ON "CommunityPostReport"("moderationCaseId");
CREATE UNIQUE INDEX "CommunityPostReport_postId_reporterUserId_key"
  ON "CommunityPostReport"("postId", "reporterUserId");
CREATE INDEX "CommunityPostReport_reporterUserId_createdAt_idx"
  ON "CommunityPostReport"("reporterUserId", "createdAt");
CREATE INDEX "CommunityPostReport_postId_createdAt_idx"
  ON "CommunityPostReport"("postId", "createdAt");

ALTER TABLE "CommunityPostReport" ADD CONSTRAINT "CommunityPostReport_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "CommunityPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityPostReport" ADD CONSTRAINT "CommunityPostReport_reporterUserId_fkey"
  FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityPostReport" ADD CONSTRAINT "CommunityPostReport_moderationCaseId_fkey"
  FOREIGN KEY ("moderationCaseId") REFERENCES "ModerationCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
