import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, "..");
const migrationsRoot = join(apiRoot, "prisma", "migrations");
const targetMigration = "20260731233000_staff_credential_offboarding";

test("staff offboarding keeps set handoff and credential-lock concurrency guards", async () => {
  const [service, migration] = await Promise.all([
    readFile(join(apiRoot, "src", "admin", "staff-offboarding.service.ts"), "utf8"),
    readFile(join(migrationsRoot, targetMigration, "migration.sql"), "utf8")
  ]);
  const handoff = service.slice(
    service.indexOf("private async handoffAssignments"),
    service.indexOf("private emptyHandoffResult")
  );

  assert.doesNotMatch(handoff, /findMany/);
  assert.doesNotMatch(handoff, /id:\s*\{\s*in:/);
  assert.match(handoff, /userAccountAppeal\.updateMany/);
  assert.match(handoff, /attendanceDispute\.updateMany/);
  assert.match(service, /WHERE "userId" = \$\{targetUserId\} FOR UPDATE/);
  assert.match(service, /WHERE "userId" = \$\{replacementUserId\} FOR UPDATE/);
  assert.match(migration, /FOR KEY SHARE OF sc/);
  assert.match(migration, /commercial assignment requires an active StaffCredential/);
});

const integrationUrl = String(process.env.STAFF_OFFBOARDING_TEST_DATABASE_URL ?? "").trim();

test("real PostgreSQL rejects an assignment racing a committed staff suspension", {
  skip: integrationUrl
    ? false
    : "set STAFF_OFFBOARDING_TEST_DATABASE_URL to a disposable PostgreSQL database"
}, async (t) => {
  const schema = `staff_offboarding_${randomBytes(8).toString("hex")}`;
  const admin = new pg.Client({ connectionString: integrationUrl });
  const offboarding = new pg.Client({ connectionString: integrationUrl });
  const racer = new pg.Client({ connectionString: integrationUrl });
  await Promise.all([admin.connect(), offboarding.connect(), racer.connect()]);
  t.after(async () => {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await Promise.all([admin.end(), offboarding.end(), racer.end()]);
  });

  await admin.query(`CREATE SCHEMA "${schema}"`);
  for (const client of [admin, offboarding, racer]) {
    await client.query(`SET search_path TO "${schema}"`);
  }

  const migrationDirectories = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name <= targetMigration)
    .map((entry) => entry.name)
    .sort();
  assert.ok(migrationDirectories.includes(targetMigration));
  for (const directory of migrationDirectories) {
    const sql = await readFile(join(migrationsRoot, directory, "migration.sql"), "utf8");
    await admin.query(sql);
  }

  await admin.query(`
    INSERT INTO "User" ("id", "role", "accountStatus", "createdAt", "updatedAt")
    VALUES
      ('staff-actor', 'admin', 'active', NOW(), NOW()),
      ('staff-target', 'support', 'active', NOW(), NOW()),
      ('staff-successor', 'admin', 'active', NOW(), NOW()),
      ('appeal-user-1', 'user', 'restricted', NOW(), NOW()),
      ('appeal-user-2', 'user', 'restricted', NOW(), NOW())
  `);
  await admin.query(`
    INSERT INTO "StaffCredential" (
      "id", "userId", "username", "passwordHash", "totpSecretCiphertext", "updatedAt"
    ) VALUES
      ('credential-actor', 'staff-actor', 'staff.actor', 'hash', 'totp', NOW()),
      ('credential-target', 'staff-target', 'staff.target', 'hash', 'totp', NOW()),
      ('credential-successor', 'staff-successor', 'staff.successor', 'hash', 'totp', NOW())
  `);
  await admin.query(`
    INSERT INTO "UserAccountAction" (
      "id", "userId", "kind", "reasonCode", "message", "policyVersion",
      "appealDeadlineAt", "createdById", "updatedAt"
    ) VALUES
      ('action-handoff', 'appeal-user-1', 'restriction', 'TEST', 'test action', 'test-v1',
       NOW() + INTERVAL '30 days', 'staff-actor', NOW()),
      ('action-race', 'appeal-user-2', 'restriction', 'TEST', 'test action', 'test-v1',
       NOW() + INTERVAL '30 days', 'staff-actor', NOW())
  `);
  await admin.query(`
    INSERT INTO "UserAccountAppeal" (
      "id", "actionId", "userId", "statement", "reviewDueAt", "assignedToUserId",
      "assignedAt", "policyVersion", "updatedAt"
    ) VALUES
      ('appeal-handoff', 'action-handoff', 'appeal-user-1', 'please review',
       NOW() + INTERVAL '3 days', 'staff-target', NOW(), 'test-v1', NOW()),
      ('appeal-race', 'action-race', 'appeal-user-2', 'please review',
       NOW() + INTERVAL '3 days', NULL, NULL, 'test-v1', NOW())
  `);

  await offboarding.query("BEGIN");
  await offboarding.query("SELECT pg_advisory_xact_lock(hashtext('talk-and-talk:staff-offboarding'))");
  for (const userId of ["staff-actor", "staff-target", "staff-successor"]) {
    await offboarding.query(
      'SELECT "id" FROM "StaffCredential" WHERE "userId" = $1 FOR UPDATE',
      [userId]
    );
  }
  const handedOff = await offboarding.query(`
    UPDATE "UserAccountAppeal"
    SET "assignedToUserId" = 'staff-successor', "assignedAt" = NOW()
    WHERE "assignedToUserId" = 'staff-target' AND "status" = 'pending'
    RETURNING "id"
  `);
  assert.equal(handedOff.rowCount, 1);

  let racerSettled = false;
  const racedAssignment = racer.query(`
    UPDATE "UserAccountAppeal"
    SET "assignedToUserId" = 'staff-target', "assignedAt" = NOW()
    WHERE "id" = 'appeal-race'
  `).then(
    () => ({ ok: true }),
    (error) => ({ ok: false, error })
  ).finally(() => { racerSettled = true; });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(racerSettled, false, "the assignment must wait on the target credential lock");

  await offboarding.query(`
    UPDATE "StaffCredential"
    SET "status" = 'suspended',
        "suspendedAt" = NOW(),
        "suspendedByUserId" = 'staff-actor',
        "suspensionReason" = 'employment ended for concurrency test',
        "handoffToUserId" = 'staff-successor',
        "offboardingOperationId" = 'operation-concurrency-test'
    WHERE "userId" = 'staff-target'
  `);
  await offboarding.query("COMMIT");

  const racedResult = await racedAssignment;
  assert.equal(racedResult.ok, false, "the blocked assignment must fail after suspension commits");
  assert.match(
    String(racedResult.error?.message ?? ""),
    /commercial assignment requires an active StaffCredential/
  );
  const assignments = await admin.query(`
    SELECT "assignedToUserId", COUNT(*)::integer AS "count"
    FROM "UserAccountAppeal"
    GROUP BY "assignedToUserId"
    ORDER BY "assignedToUserId" NULLS FIRST
  `);
  assert.deepEqual(assignments.rows, [
    { assignedToUserId: null, count: 1 },
    { assignedToUserId: "staff-successor", count: 1 }
  ]);
  const target = await admin.query(`
    SELECT "status"::text AS "status", "offboardingOperationId"
    FROM "StaffCredential" WHERE "userId" = 'staff-target'
  `);
  assert.deepEqual(target.rows[0], {
    status: "suspended",
    offboardingOperationId: "operation-concurrency-test"
  });
});
