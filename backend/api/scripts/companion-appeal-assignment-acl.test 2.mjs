import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (path) => readFile(join(repoRoot, path), "utf8");

test("companion appeals require one independent current assignee before evidence or resolution", async () => {
  const [schema, migration, service, controller, evidence, offboarding, auditRegistry, openapi, html, admin] =
    await Promise.all([
      read("backend/api/prisma/schema.prisma"),
      read("backend/api/prisma/migrations/20260826010000_companion_appeal_assignment_acl/migration.sql"),
      read("backend/api/src/commercial/companion-lifecycle.service.ts"),
      read("backend/api/src/commercial/companion-lifecycle-admin.controller.ts"),
      read("backend/api/src/moderation/media/controlled-case-evidence.service.ts"),
      read("backend/api/src/admin/staff-offboarding.service.ts"),
      read("backend/api/src/common/audit/audit-subject-reference.ts"),
      read("shared/contracts/openapi/v1.yaml"),
      read("backend/api/public/admin/index.html"),
      read("backend/api/public/admin/assets/app.js")
    ]);

  assert.match(schema, /model CompanionAccountAppeal[\s\S]*assignedToUserId\s+String\?/);
  assert.match(schema, /CompanionAccountAppealAssignee/);
  assert.match(migration, /CompanionAccountAppeal_claimable_queue/);
  assert.match(migration, /assignee must be active supply or admin staff/);
  assert.match(migration, /assignee must be independent from the original action creator/);
  assert.match(migration, /require handoff before staff offboarding/);

  const claimable = service.slice(
    service.indexOf("async claimableAppeals"),
    service.indexOf("async claimAppeal", service.indexOf("async claimableAppeals"))
  );
  assert.match(claimable, /select: \{ id: true, status: true, reviewDueAt: true, createdAt: true \}/);
  assert.doesNotMatch(claimable, /statement: true|companionId: true|evidenceAttachments|actionId: true/);
  assert.match(service, /actor\.role === "supply" \? \{ assignedToUserId: actorId \}/);
  assert.match(service, /existing\.assignedToUserId !== actorId/);
  assert.match(service, /FOR UPDATE OF action SKIP LOCKED/);
  assert.match(evidence, /companionAppeal\.assignedToUserId === user\.id/);

  assert.match(offboarding, /companionAccountAppeals: number/);
  assert.match(offboarding, /db\.companionAccountAppeal\.groupBy/);
  assert.match(offboarding, /companionAccountAppealsUnassignedForIndependence/);
  for (const action of [
    "commercial.companion_action_appeal_claimed",
    "commercial.companion_action_appeal_assigned"
  ]) assert.match(auditRegistry, new RegExp(action.replaceAll(".", "\\.")));

  for (const route of [
    "/admin/commercial/companion-lifecycle/appeals/claimable:",
    "/admin/commercial/companion-lifecycle/appeals/{id}/claims:",
    "/admin/commercial/companion-lifecycle/appeals/{id}/assignments:"
  ]) assert.ok(openapi.includes(`  ${route}`), `missing ${route}`);
  assert.match(controller, /@Get\("appeals\/claimable"\)/);
  assert.match(controller, /@Post\("appeals\/:id\/claims"\)/);
  assert.match(controller, /@Post\("appeals\/:id\/assignments"\)/);
  assert.match(html, /id="companionAppealClaimablePanel" class="panel hidden"/);
  assert.match(admin, /陪伴者、正文与附件：认领后可见/);
  assert.match(admin, /appeals\/\$\{encodeURIComponent\(item\.id\)\}\/claims/);
  assert.match(admin, /appeals\/\$\{encodeURIComponent\(item\.id\)\}\/assignments/);
});

test("media and suspension-expiry workers use bounded database claims and retained deadlines", async () => {
  const [mediaService, boundedErasure, readiness, lifecycle, expiryWorker] = await Promise.all([
    read("backend/api/src/moderation/media/media-asset.service.ts"),
    read("backend/api/src/common/privacy/bounded-erasure.ts"),
    read("backend/api/src/commercial/commercial.service.ts"),
    read("backend/api/src/commercial/companion-lifecycle.service.ts"),
    read("backend/api/src/commercial/companion-action-expiry.worker.ts")
  ]);
  assert.match(
    mediaService,
    /due_assets AS MATERIALIZED[\s\S]*ORDER BY asset\."expiresAt", asset\."id"[\s\S]*LIMIT \$2[\s\S]*due_bound_records/
  );
  assert.match(mediaService, /effectiveRetentionEndsAt/);
  assert.match(mediaService, /locked_records\."retentionEndsAt" <= CURRENT_TIMESTAMP/);
  assert.match(boundedErasure, /asset\."expiresAt" IS DISTINCT FROM/);
  assert.match(readiness, /storageDeleteLastErrorCode: \{ not: null \}/);
  assert.match(readiness, /storageDeleteOutcomeUnknownAt: \{ not: null \}/);
  assert.match(readiness, /lastError: "storage_delete_failed"/);
  assert.match(lifecycle, /FOR UPDATE OF action SKIP LOCKED/);
  assert.match(lifecycle, /LIMIT \$\{boundedBatchSize\}/);
  assert.match(expiryWorker, /if \(result\.hasMore\) this\.scheduleContinuation\(\)/);
  assert.match(expiryWorker, /EXPIRY_CONTINUATION_DELAY_MS = 1_000/);
});
