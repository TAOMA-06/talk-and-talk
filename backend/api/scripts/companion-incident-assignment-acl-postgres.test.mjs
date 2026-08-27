import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { assertIsolatedPostgresPreflightEnvironment } from "./isolated-postgres-preflight-environment.mjs";

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsRoot = join(apiRoot, "prisma", "migrations");
const targetMigration = "20260825040000_companion_incident_assignment_acl";
const integrationUrl = String(
  process.env.COMPANION_INCIDENT_ASSIGNMENT_TEST_DATABASE_URL
    ?? process.env.TEST_DATABASE_URL
    ?? ""
).trim();

async function lockStaffCredentialsInOrder(client, userIds) {
  for (const userId of [...new Set(userIds)].sort()) {
    await client.query(
      `SELECT "id" FROM "StaffCredential" WHERE "userId" = $1 FOR UPDATE`,
      [userId]
    );
  }
}

test("real PostgreSQL linearizes incident claims and assignment-versus-offboarding races", async (t) => {
  await assertIsolatedPostgresPreflightEnvironment();
  const schemaName = `incident_acl_${randomBytes(8).toString("hex")}`;
  const admin = new pg.Client({ connectionString: integrationUrl });
  const claimantA = new pg.Client({ connectionString: integrationUrl });
  const claimantB = new pg.Client({ connectionString: integrationUrl });
  await Promise.all([admin.connect(), claimantA.connect(), claimantB.connect()]);
  t.after(async () => {
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await Promise.all([admin.end(), claimantA.end(), claimantB.end()]);
  });

  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  for (const client of [admin, claimantA, claimantB]) {
    await client.query(`SET search_path TO "${schemaName}"`);
    await client.query("SET statement_timeout TO '20s'");
  }
  const migrations = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name <= targetMigration)
    .map((entry) => entry.name)
    .sort();
  assert.ok(migrations.includes(targetMigration));
  for (const migration of migrations) {
    await admin.query(await readFile(join(migrationsRoot, migration, "migration.sql"), "utf8"));
  }

  await admin.query(`
    INSERT INTO "User" ("id", "role", "accountStatus", "createdAt", "updatedAt") VALUES
      ('incident-owner', 'companion', 'active', NOW(), NOW()),
      ('incident-admin', 'admin', 'active', NOW(), NOW()),
      ('incident-supply-a', 'supply', 'active', NOW(), NOW()),
      ('incident-supply-b', 'supply', 'active', NOW(), NOW()),
      ('incident-support', 'support', 'active', NOW(), NOW());
    INSERT INTO "StaffCredential" (
      "id", "userId", "username", "status", "passwordHash",
      "totpSecretCiphertext", "createdAt", "updatedAt"
    ) VALUES
      ('credential-admin', 'incident-admin', 'incident.admin', 'active', 'hash', 'cipher', NOW(), NOW()),
      ('credential-supply-a', 'incident-supply-a', 'incident.supply.a', 'active', 'hash', 'cipher', NOW(), NOW()),
      ('credential-supply-b', 'incident-supply-b', 'incident.supply.b', 'active', 'hash', 'cipher', NOW(), NOW()),
      ('credential-support', 'incident-support', 'incident.support', 'active', 'hash', 'cipher', NOW(), NOW());
    INSERT INTO "CompanionProfile" (
      "id", "ownerUserId", "name", "role", "initials", "pricePerHalfHour", "bio",
      "availableTimes", "languages", "specialties", "responseTime", "cityDistrict", "updatedAt"
    ) VALUES (
      'incident-companion', 'incident-owner', '事件测试陪伴者', '倾听者', 'IC', 39,
      '测试', '{}', '{}', '{}', '10 分钟', '测试区', NOW()
    );
    INSERT INTO "CompanionIncidentReport" (
      "id", "companionId", "category", "summary", "status", "createdAt", "updatedAt"
    ) VALUES
      ('incident-one', 'incident-companion', 'technicalIssue', '连接异常，需要平台核验。', 'open', NOW(), NOW()),
      ('incident-two', 'incident-companion', 'safetyBoundary', '安全边界事件，需要平台核验。', 'open', NOW(), NOW());
  `);
  await admin.query(`
    INSERT INTO "User" ("id", "role", "accountStatus", "createdAt", "updatedAt") VALUES
      ('race-admin-a', 'admin', 'active', NOW(), NOW()),
      ('race-admin-b', 'admin', 'active', NOW(), NOW()),
      ('race-supply', 'supply', 'active', NOW(), NOW());
    INSERT INTO "StaffCredential" (
      "id", "userId", "username", "status", "passwordHash",
      "totpSecretCiphertext", "createdAt", "updatedAt"
    ) VALUES
      ('credential-race-admin-a', 'race-admin-a', 'race.admin.a', 'active', 'hash', 'cipher', NOW(), NOW()),
      ('credential-race-admin-b', 'race-admin-b', 'race.admin.b', 'active', 'hash', 'cipher', NOW(), NOW()),
      ('credential-race-supply', 'race-supply', 'race.supply', 'active', 'hash', 'cipher', NOW(), NOW());
    INSERT INTO "CompanionIncidentReport" (
      "id", "companionId", "category", "summary", "status", "createdAt", "updatedAt"
    ) VALUES (
      'incident-lock-race', 'incident-companion', 'technicalIssue',
      '锁序竞态测试事件。', 'open', NOW(), NOW()
    );
  `);

  await assert.rejects(
    admin.query(`
      UPDATE "CompanionIncidentReport"
      SET "assignedToUserId" = 'incident-support', "assignedAt" = NOW()
      WHERE "id" = 'incident-one'
    `),
    /assignee must be active supply staff or an active administrator/
  );
  await assert.rejects(
    admin.query(`
      UPDATE "CompanionIncidentReport"
      SET "assignedToUserId" = 'incident-supply-a', "assignedAt" = NULL
      WHERE "id" = 'incident-one'
    `),
    /assignment_pair_check|null value/i
  );

  const claim = (client, userId) => client.query(`
    UPDATE "CompanionIncidentReport"
    SET "assignedToUserId" = $1, "assignedAt" = NOW(), "status" = 'inReview', "updatedAt" = NOW()
    WHERE "id" = 'incident-one' AND "assignedToUserId" IS NULL
    RETURNING "id", "assignedToUserId"
  `, [userId]);
  const [claimA, claimB] = await Promise.all([
    claim(claimantA, "incident-supply-a"),
    claim(claimantB, "incident-supply-b")
  ]);
  assert.equal(claimA.rowCount + claimB.rowCount, 1);
  const winner = claimA.rows[0]?.assignedToUserId ?? claimB.rows[0]?.assignedToUserId;
  assert.ok(["incident-supply-a", "incident-supply-b"].includes(winner));
  const remainingSupply = winner === "incident-supply-a" ? "incident-supply-b" : "incident-supply-a";

  await assert.rejects(
    admin.query(`UPDATE "StaffCredential" SET "status" = 'suspended', "updatedAt" = NOW() WHERE "userId" = $1`, [winner]),
    /require handoff before staff offboarding/
  );
  await admin.query(`
    UPDATE "CompanionIncidentReport"
    SET "assignedToUserId" = 'incident-admin', "assignedAt" = NOW(), "updatedAt" = NOW()
    WHERE "id" = 'incident-one'
  `);
  await admin.query(`
    UPDATE "StaffCredential"
    SET "status" = 'suspended',
        "suspendedAt" = NOW(),
        "suspendedByUserId" = 'incident-admin',
        "suspensionReason" = 'Incident handoff completed before staff offboarding',
        "handoffToUserId" = 'incident-admin',
        "offboardingOperationId" = 'incident-offboarding-' || "userId",
        "updatedAt" = NOW()
    WHERE "userId" = $1
  `, [winner]);

  await admin.query(`
    UPDATE "CompanionIncidentReport"
    SET "assignedToUserId" = $1, "assignedAt" = NOW(), "status" = 'inReview', "updatedAt" = NOW()
    WHERE "id" = 'incident-two'
  `, [remainingSupply]);
  await assert.rejects(
    admin.query(`UPDATE "User" SET "accountStatus" = 'restricted', "updatedAt" = NOW() WHERE "id" = $1`, [remainingSupply]),
    /require handoff before role or account restriction/
  );
  await admin.query(`
    UPDATE "CompanionIncidentReport" SET "status" = 'resolved', "updatedAt" = NOW()
    WHERE "id" = 'incident-two'
  `);
  await admin.query(`
    UPDATE "StaffCredential"
    SET "status" = 'suspended',
        "suspendedAt" = NOW(),
        "suspendedByUserId" = 'incident-admin',
        "suspensionReason" = 'Resolved incident before staff offboarding completed',
        "handoffToUserId" = 'incident-admin',
        "offboardingOperationId" = 'incident-offboarding-' || "userId",
        "updatedAt" = NOW()
    WHERE "userId" = $1
  `, [remainingSupply]);

  // Old service order was offboarding A -> target -> replacement versus
  // assignment replacement -> target. Stage the same overlap with the new
  // canonical A -> replacement -> target order: assignment may finish first,
  // but neither transaction may be chosen as a 40P01 deadlock victim.
  await Promise.all([claimantA.query("BEGIN"), claimantB.query("BEGIN")]);
  try {
    await lockStaffCredentialsInOrder(claimantA, ["race-admin-a"]);
    await lockStaffCredentialsInOrder(claimantB, ["race-admin-b", "race-supply"]);
    await claimantB.query(
      `SELECT "id" FROM "CompanionIncidentReport" WHERE "id" = 'incident-lock-race' FOR UPDATE`
    );
    await claimantB.query(`
      UPDATE "CompanionIncidentReport"
      SET "assignedToUserId" = 'race-supply', "assignedAt" = NOW(),
          "status" = 'inReview', "updatedAt" = NOW()
      WHERE "id" = 'incident-lock-race'
    `);

    const offboardingCompletion = (async () => {
      await lockStaffCredentialsInOrder(claimantA, ["race-admin-b", "race-supply"]);
      await claimantA.query(`
        UPDATE "CompanionIncidentReport"
        SET "assignedToUserId" = 'race-admin-b', "assignedAt" = NOW(), "updatedAt" = NOW()
        WHERE "id" = 'incident-lock-race' AND "assignedToUserId" = 'race-supply'
      `);
      await claimantA.query(`
        UPDATE "StaffCredential"
        SET "status" = 'suspended', "suspendedAt" = NOW(),
            "suspendedByUserId" = 'race-admin-a',
            "suspensionReason" = 'Canonical incident assignment lock-order race completed',
            "handoffToUserId" = 'race-admin-b',
            "offboardingOperationId" = 'race-offboarding-operation',
            "updatedAt" = NOW()
        WHERE "userId" = 'race-supply'
      `);
      await claimantA.query("COMMIT");
    })();

    await claimantB.query("COMMIT");
    await offboardingCompletion;
  } catch (error) {
    await Promise.allSettled([claimantA.query("ROLLBACK"), claimantB.query("ROLLBACK")]);
    throw error;
  }
  const raceState = await admin.query(`
    SELECT incident."assignedToUserId", credential."status"::TEXT AS "credentialStatus"
    FROM "CompanionIncidentReport" AS incident
    JOIN "StaffCredential" AS credential ON credential."userId" = 'race-supply'
    WHERE incident."id" = 'incident-lock-race'
  `);
  assert.deepEqual(raceState.rows[0], {
    assignedToUserId: "race-admin-b",
    credentialStatus: "suspended"
  });

  const indexes = await admin.query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = $1 AND tablename = 'CompanionIncidentReport'
  `, [schemaName]);
  const names = new Set(indexes.rows.map((row) => row.indexname));
  assert.ok(names.has("CompanionIncidentReport_assignee_status_created"));
  assert.ok(names.has("CompanionIncidentReport_claimable_queue"));
});
