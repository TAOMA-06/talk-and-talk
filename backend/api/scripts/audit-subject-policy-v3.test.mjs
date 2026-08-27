import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, "..");
const migrationsRoot = join(apiRoot, "prisma", "migrations");
const v2Migration = "20260801007600_audit_subject_policy_registry";
const v3Migration = "20260825050000_audit_subject_policy_registry_v3";

const expectedDelta = [
  "commercial.companion_action_reactivation_completed|companionId|companion",
  "commercial.companion_incident_assigned|assignedToUserId|user",
  "commercial.companion_incident_assigned|companionId|companion",
  "commercial.companion_incident_assigned|previousAssignedToUserId|user",
  "commercial.companion_incident_claimed|assignedToUserId|user",
  "commercial.companion_incident_claimed|companionId|companion",
  "commercial.companion_suspension_expiry_reactivation_required|companionId|companion",
  "favorite.availability_reminder_disabled|companionId|companion",
  "favorite.availability_reminder_enabled|companionId|companion"
].sort();

function sqlRules(source) {
  const start = source.indexOf('controlled_rules("action"');
  const end = source.indexOf("), subject_candidates AS", start);
  return [...source.slice(start, end).matchAll(
    /\('([^']+)', '([^']+)', '(user|companion)'\)/g
  )].map((match) => `${match[1]}|${match[2]}|${match[3]}`).sort();
}

function extensionRules(source) {
  return [...source.matchAll(
    /AUDIT_SUBJECT_POLICY_EXTENSION\|([^|\s]+)\|([^|\s]+)\|(user|companion)/g
  )].map((match) => `${match[1]}|${match[2]}|${match[3]}`).sort();
}

test("controlled-v3 is forward-only, bounded, complete and exact", async () => {
  const [v2, v3, registry, favorites] = await Promise.all([
    readFile(join(migrationsRoot, v2Migration, "migration.sql"), "utf8"),
    readFile(join(migrationsRoot, v3Migration, "migration.sql"), "utf8"),
    readFile(join(apiRoot, "src/common/audit/audit-subject-reference.ts"), "utf8"),
    readFile(join(apiRoot, "src/favorites/favorites.service.ts"), "utf8")
  ]);

  assert.doesNotMatch(v2, /controlled-v3|availability_reminder_enabled|companion_incident_claimed/);
  assert.match(v3, /'controlled-v3', 'controlled-v3'/);
  assert.match(v3, /backfill_audit_subject_references_v3/);
  assert.match(v3, /backfill_audit_subject_references_v2"\(bounded_batch_size\)/);
  assert.match(v3, /LEAST\(GREATEST\(COALESCE\(batch_size, 250\), 1\), 250\)/);
  assert.match(v3, /\(log\."createdAt", log\."id"\) >/);
  assert.match(v3, /ORDER BY log\."createdAt", log\."id"/);
  assert.match(v3, /ON CONFLICT \("auditLogId", "subjectUserId"\) DO UPDATE/);
  assert.match(v3, /bool_or\("source" = 'actor'\).*bool_or\("source" = 'subject'\)/s);
  assert.deepEqual(sqlRules(v3), expectedDelta);
  assert.deepEqual(extensionRules(v3), expectedDelta);

  for (const action of [
    "favorite.availability_reminder_enabled",
    "favorite.availability_reminder_disabled"
  ]) {
    assert.match(
      registry,
      new RegExp(`"${action.replaceAll(".", "\\.")}": \\[\\{ key: "companionId", identifierKind: "companion" \\}\\]`)
    );
  }
  const actorOnly = registry.slice(
    registry.indexOf("const ACTOR_ONLY_AUDIT_ACTIONS"),
    registry.indexOf("const SYSTEM_WITH_SUBJECT_AUDIT_ACTIONS")
  );
  assert.doesNotMatch(actorOnly, /favorite\.availability_reminder_(?:enabled|disabled)/);
  assert.match(favorites, /subjectUserIds: \[userId, companion\?\.ownerUserId\]/);
});
