-- Multiple independent reporter receipts may safely point at one still-open
-- community-report case. The per-post/per-reporter unique key remains the
-- user-facing deduplication boundary.
DROP INDEX "CommunityPostReport_moderationCaseId_key";

CREATE INDEX "CommunityPostReport_moderationCaseId_createdAt_idx"
  ON "CommunityPostReport"("moderationCaseId", "createdAt");
