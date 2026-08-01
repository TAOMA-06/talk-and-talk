-- Bound the operational cost of paginated review-staff directories and their
-- per-page assignment/session/suspension aggregates.
CREATE INDEX "ReviewStaff_status_role_displayName_username_id_idx"
ON "ReviewStaff"("status", "role", "displayName", "username", "id");

CREATE INDEX "ReviewSession_reviewerId_revokedAt_idx"
ON "ReviewSession"("reviewerId", "revokedAt");

CREATE INDEX "ReviewAuditLog_resourceType_resourceId_action_createdAt_idx"
ON "ReviewAuditLog"("resourceType", "resourceId", "action", "createdAt");

CREATE INDEX "ModerationCase_assignedToUserId_status_idx"
ON "ModerationCase"("assignedToUserId", "status");
