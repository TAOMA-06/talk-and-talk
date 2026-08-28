import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import pg from "pg";

import { assertIsolatedPostgresPreflightEnvironment } from "./isolated-postgres-preflight-environment.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, "..");
const migrationsRoot = join(apiRoot, "prisma", "migrations");
const targetMigration = "20260825050000_audit_subject_policy_registry_v3";
const integrationUrl = String(
  process.env.AUDIT_SUBJECT_POLICY_V3_TEST_DATABASE_URL
    ?? process.env.TEST_DATABASE_URL
    ?? ""
).trim();

test("controlled-v3 backfills bounded aliases and multiple subjects without false associations", async (t) => {
  await assertIsolatedPostgresPreflightEnvironment();
  const schemaName = `audit_subject_v3_${randomBytes(8).toString("hex")}`;
  const client = new pg.Client({ connectionString: integrationUrl });
  await client.connect();
  t.after(async () => {
    await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await client.end();
  });
  await client.query(`CREATE SCHEMA "${schemaName}"`);
  await client.query(`SET search_path TO "${schemaName}"`);
  await client.query("SET statement_timeout TO '30s'");

  const directories = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name <= targetMigration)
    .map((entry) => entry.name)
    .sort();
  assert.ok(directories.includes(targetMigration));
  for (const directory of directories) {
    await client.query(await readFile(join(migrationsRoot, directory, "migration.sql"), "utf8"));
  }

  await client.query(`
    INSERT INTO "User" ("id", "role", "accountStatus", "createdAt", "updatedAt") VALUES
      ('actor-customer', 'user', 'active', NOW(), NOW()),
      ('actor-alias', 'companion', 'active', NOW(), NOW()),
      ('companion-owner', 'companion', 'active', NOW(), NOW()),
      ('support-old', 'support', 'active', NOW(), NOW()),
      ('support-new', 'support', 'active', NOW(), NOW()),
      ('unrelated-user', 'user', 'active', NOW(), NOW());

    INSERT INTO "CompanionProfile" (
      "id", "ownerUserId", "name", "role", "initials", "pricePerHalfHour",
      "bio", "availableTimes", "languages", "specialties", "responseTime",
      "cityDistrict", "createdAt", "updatedAt"
    ) VALUES
      ('comp-main', 'companion-owner', 'Main', 'listener', 'MN', 39,
       'bio', '{}', '{}', '{}', '10m', 'test', NOW(), NOW()),
      ('comp-alias', 'actor-alias', 'Alias', 'listener', 'AL', 39,
       'bio', '{}', '{}', '{}', '10m', 'test', NOW(), NOW());

    INSERT INTO "AuditLog" (
      "id", "actorId", "action", "resourceType", "resourceId", "metadata", "createdAt"
    ) VALUES
      ('log-v2-saved', 'actor-customer', 'favorite.companion_saved',
       'companionFavorite', 'fav-1', '{"companionId":"comp-main"}', '2026-08-25 00:00:01+00'),
      ('log-favorite-enabled', 'actor-customer', 'favorite.availability_reminder_enabled',
       'companionFavorite', 'fav-1', '{"companionId":"comp-main"}', '2026-08-25 00:00:02+00'),
      ('log-favorite-alias', 'actor-alias', 'favorite.availability_reminder_disabled',
       'companionFavorite', 'fav-2', '{"companionId":"comp-alias"}', '2026-08-25 00:00:03+00'),
      ('log-incident-assigned', 'support-new', 'commercial.companion_incident_assigned',
       'companionIncidentReport', 'incident-1',
       '{"companionId":"comp-main","previousAssignedToUserId":"support-old","assignedToUserId":"support-new"}',
       '2026-08-25 00:00:04+00'),
      ('log-incident-claimed', 'support-new', 'commercial.companion_incident_claimed',
       'companionIncidentReport', 'incident-2',
       '{"companionId":"comp-main","assignedToUserId":"support-new"}',
       '2026-08-25 00:00:05+00'),
      ('log-unrelated-action', 'actor-customer', 'account.session_revoked',
       'refreshToken', 'session-1', '{"companionId":"comp-main"}', '2026-08-25 00:00:06+00'),
      ('log-invalid-companion', 'actor-customer', 'favorite.availability_reminder_enabled',
       'companionFavorite', 'fav-3', '{"companionId":"missing-companion"}', '2026-08-25 00:00:07+00'),
      ('log-nested-key', 'actor-customer', 'favorite.availability_reminder_enabled',
       'companionFavorite', 'fav-4', '{"context":{"companionId":"comp-main"}}', '2026-08-25 00:00:08+00');
  `);

  const batches = [];
  let completed = false;
  for (let attempt = 0; attempt < 30 && !completed; attempt += 1) {
    const result = await client.query(
      `SELECT * FROM "backfill_audit_subject_references_v3"($1)`,
      [2]
    );
    assert.equal(result.rows.length, 1);
    assert.ok(result.rows[0].processed >= 0 && result.rows[0].processed <= 2);
    batches.push(result.rows[0]);
    completed = result.rows[0].completed === true;
  }
  assert.equal(completed, true);
  assert.ok(batches.length > 5);
  assert.ok(batches.filter((batch) => batch.processed === 2).length >= 4);

  const states = await client.query(`
    SELECT "version", "processedCount", "completedAt" IS NOT NULL AS completed
    FROM "AuditSubjectReferenceBackfillState"
    WHERE "version" IN ('controlled-v2', 'controlled-v3')
    ORDER BY "version"
  `);
  assert.deepEqual(states.rows, [
    { version: "controlled-v2", processedCount: 8, completed: true },
    { version: "controlled-v3", processedCount: 8, completed: true }
  ]);

  const references = await client.query(`
    SELECT "auditLogId", "subjectUserId", "relationKind"
    FROM "AuditSubjectReference"
    ORDER BY "auditLogId", "subjectUserId"
  `);
  const forLog = (id) => references.rows
    .filter((row) => row.auditLogId === id)
    .map(({ subjectUserId, relationKind }) => ({ subjectUserId, relationKind }));
  assert.deepEqual(forLog("log-favorite-enabled"), [
    { subjectUserId: "actor-customer", relationKind: "actor" },
    { subjectUserId: "companion-owner", relationKind: "subject" }
  ]);
  assert.deepEqual(forLog("log-favorite-alias"), [
    { subjectUserId: "actor-alias", relationKind: "actorAndSubject" }
  ]);
  assert.deepEqual(forLog("log-incident-assigned"), [
    { subjectUserId: "companion-owner", relationKind: "subject" },
    { subjectUserId: "support-new", relationKind: "actorAndSubject" },
    { subjectUserId: "support-old", relationKind: "subject" }
  ]);
  assert.deepEqual(forLog("log-incident-claimed"), [
    { subjectUserId: "companion-owner", relationKind: "subject" },
    { subjectUserId: "support-new", relationKind: "actorAndSubject" }
  ]);
  assert.deepEqual(forLog("log-unrelated-action"), [
    { subjectUserId: "actor-customer", relationKind: "actor" }
  ]);
  assert.deepEqual(forLog("log-invalid-companion"), [
    { subjectUserId: "actor-customer", relationKind: "actor" }
  ]);
  assert.deepEqual(forLog("log-nested-key"), [
    { subjectUserId: "actor-customer", relationKind: "actor" }
  ]);
  assert.equal(references.rows.some((row) => row.subjectUserId === "unrelated-user"), false);

  const before = references.rows.length;
  const rerun = await client.query(`SELECT * FROM "backfill_audit_subject_references_v3"(2)`);
  assert.deepEqual(rerun.rows, [{ processed: 0, referencesTouched: 0, completed: true }]);
  const after = await client.query(`SELECT COUNT(*)::INTEGER AS count FROM "AuditSubjectReference"`);
  assert.equal(after.rows[0].count, before);
});
