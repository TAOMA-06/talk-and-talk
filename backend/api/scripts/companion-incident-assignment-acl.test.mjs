import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(apiRoot, "..", "..");
const read = (path) => readFile(join(repoRoot, path), "utf8");

test("companion incidents have one current assignee, private claim summaries and assignment-scoped evidence", async () => {
  const [schema, migration, service, lockOrder, controller, evidence, openapi, adminHtml, adminScript] =
    await Promise.all([
      read("backend/api/prisma/schema.prisma"),
      read("backend/api/prisma/migrations/20260825040000_companion_incident_assignment_acl/migration.sql"),
      read("backend/api/src/commercial/companion-lifecycle.service.ts"),
      read("backend/api/src/admin/staff-credential-lock-order.ts"),
      read("backend/api/src/commercial/companion-lifecycle-admin.controller.ts"),
      read("backend/api/src/moderation/media/controlled-case-evidence.service.ts"),
      read("shared/contracts/openapi/v1.yaml"),
      read("backend/api/public/admin/index.html"),
      read("backend/api/public/admin/assets/app.js")
    ]);

  assert.match(schema, /assignedToUserId\s+String\?/);
  assert.match(schema, /assignedAt\s+DateTime\?/);
  assert.match(migration, /CompanionIncidentReport_claimable_queue/);
  assert.match(migration, /companion incident assignee must be active supply staff or an active administrator/);
  assert.match(migration, /require handoff before staff offboarding/);
  assert.match(service, /scope: "claimableSummary"/);
  const claimable = service.slice(
    service.indexOf("async claimableIncidents"),
    service.indexOf("async adminIncident", service.indexOf("async claimableIncidents"))
  );
  assert.match(claimable, /select: \{ id: true, status: true, createdAt: true, orderId: true \}/);
  assert.doesNotMatch(claimable, /summary: true|category: true|companionId: true|evidenceAttachments/);
  assert.match(service, /assignedToUserId: actorId/);
  assert.match(service, /lockStaffCredentialRowsInOrder\(db, \[actorId, input\.assignedToUserId\]\)/);
  assert.match(lockOrder, /new Set/);
  assert.match(lockOrder, /\.sort\(\)/);
  assert.match(lockOrder, /StaffCredential[\s\S]*FOR UPDATE/);
  assert.match(controller, /@Get\("incidents\/claimable"\)/);
  assert.match(controller, /@Post\("incidents\/:id\/claims"\)/);
  assert.match(controller, /@Post\("incidents\/:id\/assignments"\)/);
  assert.match(evidence, /user\.role === "supply" && incident\.assignedToUserId === user\.id/);
  assert.doesNotMatch(evidence, /\|\| user\.role === "supply";/);

  for (const route of [
    "/admin/commercial/companion-lifecycle/incidents/claimable:",
    "/admin/commercial/companion-lifecycle/incidents/{id}:",
    "/admin/commercial/companion-lifecycle/incidents/{id}/claims:",
    "/admin/commercial/companion-lifecycle/incidents/{id}/assignments:"
  ]) assert.ok(openapi.includes(`  ${route}`), `missing ${route}`);

  assert.match(adminHtml, /id="incidentClaimablePanel" class="panel hidden"/);
  assert.match(adminHtml, /不会返回陪伴者、类别、正文、订单号或附件标识/);
  assert.match(adminScript, /scope.*claimableSummary|正文与附件：认领后可见/s);
  assert.match(adminScript, /incidents\/\$\{encodeURIComponent\(item\.id\)\}\/claims/);
  assert.match(adminScript, /incidents\/\$\{encodeURIComponent\(item\.id\)\}\/assignments/);
});

test("commercial staff offboarding counts and transfers unresolved companion incidents", async () => {
  const [service, openapi, adminScript] = await Promise.all([
    read("backend/api/src/admin/staff-offboarding.service.ts"),
    read("shared/contracts/openapi/v1.yaml"),
    read("backend/api/public/admin/assets/app.js")
  ]);
  assert.match(service, /companionIncidents: number/);
  assert.match(service, /db\.companionIncidentReport\.groupBy/);
  assert.match(service, /db\.companionIncidentReport\.updateMany/);
  assert.match(service, /assignedToUserId: replacementUserId, assignedAt: now/);
  assert.match(openapi, /companionIncidents: \{ type: integer, minimum: 0 \}/);
  assert.match(adminScript, /companionIncidents: "陪伴者事件"/);
});
