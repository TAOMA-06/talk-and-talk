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
const targetMigration = "20260826010000_companion_appeal_assignment_acl";
const integrationUrl = String(process.env.TEST_DATABASE_URL ?? "").trim();

test("real PostgreSQL enforces one independent companion-appeal assignee and offboarding handoff", async (t) => {
  await assertIsolatedPostgresPreflightEnvironment();
  const schemaName = `companion_appeal_acl_${randomBytes(8).toString("hex")}`;
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
      ('appeal-owner', 'companion', 'active', NOW(), NOW()),
      ('appeal-original', 'supply', 'active', NOW(), NOW()),
      ('appeal-supply-a', 'supply', 'active', NOW(), NOW()),
      ('appeal-supply-b', 'supply', 'active', NOW(), NOW()),
      ('appeal-admin', 'admin', 'active', NOW(), NOW()),
      ('appeal-support', 'support', 'active', NOW(), NOW());
    INSERT INTO "StaffCredential" (
      "id", "userId", "username", "status", "passwordHash",
      "totpSecretCiphertext", "createdAt", "updatedAt"
    ) VALUES
      ('credential-original', 'appeal-original', 'appeal.original', 'active', 'hash', 'cipher', NOW(), NOW()),
      ('credential-supply-a', 'appeal-supply-a', 'appeal.supply.a', 'active', 'hash', 'cipher', NOW(), NOW()),
      ('credential-supply-b', 'appeal-supply-b', 'appeal.supply.b', 'active', 'hash', 'cipher', NOW(), NOW()),
      ('credential-admin', 'appeal-admin', 'appeal.admin', 'active', 'hash', 'cipher', NOW(), NOW()),
      ('credential-support', 'appeal-support', 'appeal.support', 'active', 'hash', 'cipher', NOW(), NOW());
    INSERT INTO "CompanionProfile" (
      "id", "ownerUserId", "name", "role", "initials", "pricePerHalfHour", "bio",
      "availableTimes", "languages", "specialties", "responseTime", "cityDistrict", "updatedAt"
    ) VALUES (
      'appeal-companion', 'appeal-owner', '申诉测试陪伴者', '倾听者', 'AC', 39,
      '测试', '{}', '{}', '{}', '10 分钟', '测试区', NOW()
    );
    INSERT INTO "CompanionAccountAction" (
      "id", "companionId", "kind", "reasonCode", "message", "appealDeadlineAt",
      "createdById", "createdAt", "updatedAt"
    ) VALUES (
      'appeal-action', 'appeal-companion', 'suspension', 'acl_test',
      '用于验证独立申诉处理归属的账号处置。', NOW() + INTERVAL '30 days',
      'appeal-original', NOW(), NOW()
    );
    INSERT INTO "CompanionAccountAppeal" (
      "id", "actionId", "companionId", "statement", "status", "reviewDueAt",
      "createdAt", "updatedAt"
    ) VALUES (
      'appeal-case', 'appeal-action', 'appeal-companion',
      '请求依据完整履约证据重新进行独立复核。', 'pending', NOW() + INTERVAL '3 days',
      NOW(), NOW()
    );
  `);

  for (const forbiddenAssignee of ["appeal-original", "appeal-support"]) {
    await assert.rejects(
      admin.query(`
        UPDATE "CompanionAccountAppeal"
        SET "assignedToUserId" = $1, "assignedAt" = NOW()
        WHERE "id" = 'appeal-case'
      `, [forbiddenAssignee]),
      /independent|active supply or admin/
    );
  }

  const claim = (client, userId) => client.query(`
    UPDATE "CompanionAccountAppeal"
    SET "assignedToUserId" = $1, "assignedAt" = NOW(), "updatedAt" = NOW()
    WHERE "id" = 'appeal-case' AND "status" = 'pending' AND "assignedToUserId" IS NULL
    RETURNING "assignedToUserId"
  `, [userId]);
  const [claimA, claimB] = await Promise.all([
    claim(claimantA, "appeal-supply-a"),
    claim(claimantB, "appeal-supply-b")
  ]);
  assert.equal(claimA.rowCount + claimB.rowCount, 1);
  const winner = claimA.rows[0]?.assignedToUserId ?? claimB.rows[0]?.assignedToUserId;

  await assert.rejects(
    admin.query(`UPDATE "StaffCredential" SET "status" = 'suspended' WHERE "userId" = $1`, [winner]),
    /require handoff before staff offboarding/
  );
  await admin.query(`
    UPDATE "CompanionAccountAppeal"
    SET "assignedToUserId" = 'appeal-admin', "assignedAt" = NOW(), "updatedAt" = NOW()
    WHERE "id" = 'appeal-case'
  `);
  await admin.query(`
    UPDATE "StaffCredential"
    SET "status" = 'suspended', "suspendedAt" = NOW(),
        "suspendedByUserId" = 'appeal-admin',
        "suspensionReason" = 'Companion appeal handoff completed before offboarding',
        "handoffToUserId" = 'appeal-admin',
        "offboardingOperationId" = 'appeal-offboarding-' || "userId",
        "updatedAt" = NOW()
    WHERE "userId" = $1
  `, [winner]);

  await admin.query(`
    INSERT INTO "CompanionAccountAction" (
      "id", "companionId", "kind", "reasonCode", "message", "startsAt", "endsAt",
      "appealDeadlineAt", "createdById", "createdAt", "updatedAt"
    ) VALUES
      ('expiry-a', 'appeal-companion', 'suspension', 'expiry_test', '到期任务 A。', NOW() - INTERVAL '1 day', NOW() - INTERVAL '3 minutes', NOW() + INTERVAL '1 day', 'appeal-original', NOW(), NOW()),
      ('expiry-b', 'appeal-companion', 'suspension', 'expiry_test', '到期任务 B。', NOW() - INTERVAL '1 day', NOW() - INTERVAL '2 minutes', NOW() + INTERVAL '1 day', 'appeal-original', NOW(), NOW()),
      ('expiry-c', 'appeal-companion', 'suspension', 'expiry_test', '到期任务 C。', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 minute', NOW() + INTERVAL '1 day', 'appeal-original', NOW(), NOW());
  `);
  const claimExpiry = (client) => client.query(`
    WITH candidates AS MATERIALIZED (
      SELECT action."id"
      FROM "CompanionAccountAction" AS action
      WHERE action."kind" = 'suspension'
        AND action."revokedAt" IS NULL
        AND action."endsAt" <= NOW()
        AND action."reactivationStatus" = 'notRequired'
        AND NOT EXISTS (
          SELECT 1 FROM "CompanionAccountAppeal" AS appeal
          WHERE appeal."actionId" = action."id" AND appeal."status" = 'pending'
        )
      ORDER BY action."endsAt", action."id"
      FOR UPDATE OF action SKIP LOCKED
      LIMIT 2
    )
    UPDATE "CompanionAccountAction" AS action
    SET "reactivationStatus" = 'required', "reactivationRequiredAt" = NOW(), "updatedAt" = NOW()
    FROM candidates
    WHERE action."id" = candidates."id"
    RETURNING action."id"
  `);
  const [expiryA, expiryB] = await Promise.all([
    claimExpiry(claimantA),
    claimExpiry(claimantB)
  ]);
  const claimedExpiryIds = [...expiryA.rows, ...expiryB.rows].map((row) => row.id);
  assert.equal(new Set(claimedExpiryIds).size, 3);
  assert.deepEqual(new Set(claimedExpiryIds), new Set(["expiry-a", "expiry-b", "expiry-c"]));

  const indexes = await admin.query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = $1 AND tablename = 'CompanionAccountAppeal'
  `, [schemaName]);
  const names = new Set(indexes.rows.map((row) => row.indexname));
  assert.ok(names.has("CompanionAccountAppeal_assignee_status_due"));
  assert.ok(names.has("CompanionAccountAppeal_claimable_queue"));
});
