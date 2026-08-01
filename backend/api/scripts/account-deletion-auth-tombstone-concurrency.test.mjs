import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, "..");
const migrationsRoot = join(apiRoot, "prisma", "migrations");
const targetMigration = "20260801007100_account_deletion_auth_tombstones";

test("account deletion authentication closure is fail-closed in every application layer", async () => {
  const [service, auth, guard, worker, migration, miniApi, miniPage] = await Promise.all([
    readFile(join(apiRoot, "src/auth/auth-identity-tombstone.service.ts"), "utf8"),
    readFile(join(apiRoot, "src/auth/auth.service.ts"), "utf8"),
    readFile(join(apiRoot, "src/auth/guards/jwt-auth.guard.ts"), "utf8"),
    readFile(join(apiRoot, "src/users/account-deletion-execution.worker.ts"), "utf8"),
    readFile(join(migrationsRoot, targetMigration, "migration.sql"), "utf8"),
    readFile(join(apiRoot, "../../frontend/miniprogram/utils/api.ts"), "utf8"),
    readFile(join(apiRoot, "../../frontend/miniprogram/pages/account/deletion-status.ts"), "utf8")
  ]);

  assert.match(service, /timingSafeEqual/);
  assert.match(service, /AUTH_IDENTITY_TOMBSTONE_KEY_COVERAGE_UNKNOWN/);
  assert.match(service, /deletionRequest:\s*\{ status: "processing" \}/);
  assert.match(service, /expiresAt:\s*\{ gt: now \}/);
  assert.match(service, /"LOGIN_IDENTITY_UNAVAILABLE"/);
  assert.doesNotMatch(
    service.slice(service.indexOf("throwAuthState"), service.indexOf("configuredKeyIds")),
    /details|dueAt|completedAt|policyVersion|reRegistrationAllowedAt/
  );

  const identityResolution = auth.slice(
    auth.indexOf("private async resolveConsumerIdentityAndIssueSession"),
    auth.indexOf("private async issueTokens")
  );
  assert.ok(identityResolution.indexOf("findBlockingStateTx") < identityResolution.indexOf("db.user.create"));
  assert.match(auth, /Prisma\.PrismaClientKnownRequestError/);
  assert.match(auth, /modelName === "AuthIdentity"/);
  assert.match(auth, /target\.includes\("provider"\)/);
  assert.match(auth, /target\.includes\("providerId"\)/);

  const deletionCheck = guard.indexOf("findUserBlockingStateTx");
  assert.ok(deletionCheck >= 0 && deletionCheck < guard.indexOf("if (skipConsent)"));
  assert.match(worker, /executionPhase === "auth_identity"[\s\S]*assertWorkerCoverageTx/);
  assert.match(migration, /AuthIdentityTombstone_login_lookup/);
  assert.match(migration, /AccountDeletionRequest_auth_tombstone_transition_guard/);
  assert.match(migration, /AuthIdentity_deletion_erase_guard/);
  assert.match(migration, /RefreshToken_deletion_insert_guard/);

  assert.match(miniApi, /LOGIN_IDENTITY_UNAVAILABLE/);
  assert.match(miniApi, /\/pages\/account\/deletion-status/);
  assert.doesNotMatch(miniPage, /\b(?:api|request|ensureSession|ensureLegalRecoverySession)\s*\(/);
});

const integrationUrl = String(
  process.env.ACCOUNT_DELETION_AUTH_TOMBSTONE_TEST_DATABASE_URL
    ?? process.env.ACCOUNT_DELETION_TEST_DATABASE_URL
    ?? process.env.TEST_DATABASE_URL
    ?? ""
).trim();

function providerDigest(key, provider, providerId) {
  return createHmac("sha256", key)
    .update(`talk-and-talk-auth-tombstone-v1\0${provider}\0${providerId}`, "utf8")
    .digest("hex");
}

async function expectPgCode(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code);
}

test("real PostgreSQL closes login/deletion races and keeps tombstone lookups indexed at scale", {
  skip: integrationUrl
    ? false
    : "set ACCOUNT_DELETION_AUTH_TOMBSTONE_TEST_DATABASE_URL to a disposable PostgreSQL database"
}, async (t) => {
  const schema = `auth_tombstone_${randomBytes(8).toString("hex")}`;
  const admin = new pg.Client({ connectionString: integrationUrl });
  const deletion = new pg.Client({ connectionString: integrationUrl });
  const login = new pg.Client({ connectionString: integrationUrl });
  await Promise.all([admin.connect(), deletion.connect(), login.connect()]);
  t.after(async () => {
    await Promise.allSettled([
      deletion.query("ROLLBACK"),
      login.query("ROLLBACK")
    ]);
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await Promise.all([admin.end(), deletion.end(), login.end()]);
  });

  await admin.query(`CREATE SCHEMA "${schema}"`);
  for (const client of [admin, deletion, login]) {
    await client.query(`SET search_path TO "${schema}"`);
    await client.query("SET statement_timeout TO '60s'");
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
    INSERT INTO "User" ("id", "role", "accountStatus", "updatedAt") VALUES
      ('subject-guard', 'user', 'active', NOW()),
      ('subject-missing', 'user', 'active', NOW()),
      ('subject-race', 'user', 'active', NOW()),
      ('admin-completer', 'admin', 'active', NOW());
    INSERT INTO "AuthIdentity" ("id", "userId", "provider", "providerId") VALUES
      ('identity-guard', 'subject-guard', 'phone', '+8613800138000'),
      ('identity-missing', 'subject-missing', 'apple', 'apple-missing'),
      ('identity-race', 'subject-race', 'wechatMiniProgram', 'openid-race');
    INSERT INTO "AccountDeletionRequest" (
      "id", "userId", "status", "dueAt", "policyVersion", "updatedAt"
    ) VALUES
      ('request-guard', 'subject-guard', 'pending', NOW() + INTERVAL '1 day', 'test-v1', NOW()),
      ('request-missing', 'subject-missing', 'pending', NOW() + INTERVAL '1 day', 'test-v1', NOW()),
      ('request-race', 'subject-race', 'pending', NOW() + INTERVAL '1 day', 'test-v1', NOW());
  `);

  await expectPgCode(
    admin.query(`UPDATE "AccountDeletionRequest" SET "status" = 'processing' WHERE "id" = 'request-missing'`),
    "23514"
  );

  const key = Buffer.alloc(32, 11);
  await admin.query(`
    INSERT INTO "AuthIdentityTombstone" (
      "id", "deletionRequestId", "sourceAuthIdentityId", "provider",
      "providerIdHmac", "keyId", "createdAt"
    ) VALUES
      ('tombstone-guard', 'request-guard', 'identity-guard', 'phone', $1, 'key-v1', '2020-01-01'),
      ('tombstone-race', 'request-race', 'identity-race', 'wechatMiniProgram', $2, 'key-v1', '2020-01-01')
  `, [
    providerDigest(key, "phone", "+8613800138000"),
    providerDigest(key, "wechatMiniProgram", "openid-race")
  ]);

  await deletion.query("BEGIN");
  await deletion.query(`SELECT "id" FROM "User" WHERE "id" = 'subject-race' FOR UPDATE`);
  await deletion.query(`UPDATE "AccountDeletionRequest" SET "status" = 'processing' WHERE "id" = 'request-race'`);
  await login.query("BEGIN");
  let loginLockSettled = false;
  const loginLock = login.query(`SELECT "id" FROM "User" WHERE "id" = 'subject-race' FOR UPDATE`)
    .finally(() => { loginLockSettled = true; });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(loginLockSettled, false, "session issuance must wait behind the canonical deletion user lock");
  await deletion.query("COMMIT");
  await loginLock;
  await expectPgCode(login.query(`
    INSERT INTO "RefreshToken" ("id", "userId", "tokenHash", "expiresAt")
    VALUES ('refresh-race', 'subject-race', 'refresh-race-hash', NOW() + INTERVAL '1 day')
  `), "23514");
  await login.query("ROLLBACK");

  await admin.query(`UPDATE "AccountDeletionRequest" SET "status" = 'processing' WHERE "id" = 'request-guard'`);
  await expectPgCode(admin.query(`
    INSERT INTO "AuthIdentity" ("id", "userId", "provider", "providerId")
    VALUES ('identity-new', 'subject-guard', 'apple', 'new-apple-sub')
  `), "23514");
  await expectPgCode(admin.query(`
    INSERT INTO "RefreshToken" ("id", "userId", "tokenHash", "expiresAt")
    VALUES ('refresh-new', 'subject-guard', 'refresh-new-hash', NOW() + INTERVAL '1 day')
  `), "23514");
  await expectPgCode(admin.query(`
    UPDATE "AuthIdentity" SET "providerId" = '+8613800138001' WHERE "id" = 'identity-guard'
  `), "23514");
  await expectPgCode(
    admin.query(`DELETE FROM "AuthIdentityTombstone" WHERE "id" = 'tombstone-guard'`),
    "23514"
  );
  const erasedIdentity = await admin.query(`DELETE FROM "AuthIdentity" WHERE "id" = 'identity-guard' RETURNING "id"`);
  assert.equal(erasedIdentity.rowCount, 1);

  await admin.query(`
    UPDATE "AccountDeletionRequest"
    SET "status" = 'completed',
        "executionStatus" = 'completed',
        "executionPhase" = 'completed',
        "executionStartedAt" = NOW(),
        "executionFinishedAt" = NOW(),
        "completedById" = 'admin-completer',
        "completedAt" = NOW()
    WHERE "id" = 'request-guard'
  `);
  await admin.query(`
    UPDATE "AuthIdentityTombstone" SET "expiresAt" = '2021-01-01'
    WHERE "id" = 'tombstone-guard'
  `);
  const cleaned = await admin.query(`DELETE FROM "AuthIdentityTombstone" WHERE "id" = 'tombstone-guard' RETURNING "id"`);
  assert.equal(cleaned.rowCount, 1);

  await deletion.query("BEGIN");
  await login.query("BEGIN");
  await deletion.query(`
    INSERT INTO "User" ("id", "role", "accountStatus", "updatedAt")
    VALUES ('registration-a', 'user', 'active', NOW())
  `);
  await login.query(`
    INSERT INTO "User" ("id", "role", "accountStatus", "updatedAt")
    VALUES ('registration-b', 'user', 'active', NOW())
  `);
  await deletion.query(`
    INSERT INTO "AuthIdentity" ("id", "userId", "provider", "providerId")
    VALUES ('registration-identity-a', 'registration-a', 'phone', '+8613900139000')
  `);
  let competingRegistrationSettled = false;
  const competingRegistration = login.query(`
    INSERT INTO "AuthIdentity" ("id", "userId", "provider", "providerId")
    VALUES ('registration-identity-b', 'registration-b', 'phone', '+8613900139000')
  `).then(
    () => ({ ok: true }),
    (error) => ({ ok: false, code: error.code })
  ).finally(() => { competingRegistrationSettled = true; });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(competingRegistrationSettled, false, "the unique external identity must serialize first registration");
  await deletion.query("COMMIT");
  assert.deepEqual(await competingRegistration, { ok: false, code: "23505" });
  await login.query("ROLLBACK");
  const registrationUsers = await admin.query(`
    SELECT "id" FROM "User" WHERE "id" IN ('registration-a', 'registration-b') ORDER BY "id"
  `);
  assert.deepEqual(registrationUsers.rows, [{ id: "registration-a" }]);

  await admin.query(`
    INSERT INTO "User" ("id", "role", "accountStatus", "updatedAt")
    SELECT 'scale-user-' || series, 'user', 'active', NOW()
    FROM generate_series(1, 100000) series;
    INSERT INTO "AuthIdentity" ("id", "userId", "provider", "providerId")
    SELECT 'scale-identity-' || series, 'scale-user-' || series, 'phone', '+86-scale-' || series
    FROM generate_series(1, 100000) series;
    INSERT INTO "AccountDeletionRequest" (
      "id", "userId", "status", "dueAt", "policyVersion", "updatedAt"
    )
    SELECT 'scale-request-' || series, 'scale-user-' || series, 'pending',
           NOW() + INTERVAL '1 day', 'scale-v1', NOW()
    FROM generate_series(1, 100000) series;
    INSERT INTO "AuthIdentityTombstone" (
      "id", "deletionRequestId", "sourceAuthIdentityId", "provider",
      "providerIdHmac", "keyId"
    )
    SELECT 'scale-tombstone-' || series,
           'scale-request-' || series,
           'scale-identity-' || series,
           'phone',
           md5(series::text) || md5('suffix-' || series::text),
           'scale-key'
    FROM generate_series(1, 100000) series;
    ANALYZE "AuthIdentityTombstone";
  `);
  const targetHmac = await admin.query(`
    SELECT "providerIdHmac" FROM "AuthIdentityTombstone" WHERE "id" = 'scale-tombstone-50000'
  `);
  const plan = await admin.query(`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT "id"
    FROM "AuthIdentityTombstone"
    WHERE "provider" = 'phone'
      AND "keyId" = 'scale-key'
      AND "providerIdHmac" = $1
      AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
    LIMIT 1
  `, [targetHmac.rows[0].providerIdHmac]);
  const serializedPlan = JSON.stringify(plan.rows[0]["QUERY PLAN"]);
  assert.match(serializedPlan, /AuthIdentityTombstone_login_lookup/);
  assert.doesNotMatch(serializedPlan, /"Node Type":"Seq Scan"/);
  t.diagnostic(`plan=${serializedPlan}`);
});
