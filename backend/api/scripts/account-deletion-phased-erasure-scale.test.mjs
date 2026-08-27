import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import test from "node:test";

import pg from "pg";
import { assertIsolatedPostgresPreflightEnvironment, POSTGRES_PREFLIGHT_SUITE } from "./isolated-postgres-preflight-environment.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, "..");
const migrationPath = join(
  apiRoot,
  "prisma/migrations/20260801007000_account_deletion_phased_erasure/migration.sql"
);

test("account deletion and retention use persistent bounded erasure controls", async () => {
  const [helper, worker, retention, companions, commercial, migration] = await Promise.all([
    readFile(join(apiRoot, "src/common/privacy/bounded-erasure.ts"), "utf8"),
    readFile(join(apiRoot, "src/users/account-deletion-execution.worker.ts"), "utf8"),
    readFile(join(apiRoot, "src/legal/data-retention.worker.ts"), "utf8"),
    readFile(join(apiRoot, "src/companions/companions.service.ts"), "utf8"),
    readFile(join(apiRoot, "src/commercial/commercial.service.ts"), "utf8"),
    readFile(migrationPath, "utf8")
  ]);

  assert.match(helper, /FOR UPDATE SKIP LOCKED/g);
  assert.match(helper, /LIMIT \$\$\{limitParameter\}/);
  assert.doesNotMatch(helper, /ORDER BY target\.ctid/);
  assert.match(worker, /const EXECUTION_CLAIM_BATCH_SIZE = 1/);
  assert.match(worker, /const EXECUTION_RUN_BUDGET_MS = 4_000/);
  assert.match(worker, /\}, \{ timeout: 5_000 \}\)/);
  const workerUserLock = worker.indexOf('FROM "User" WHERE "id"');
  const workerRequestLock = worker.indexOf('FROM "AccountDeletionRequest"', workerUserLock);
  const workerProfileLock = worker.indexOf('FROM "CompanionProfile"', workerRequestLock);
  assert.ok(workerUserLock >= 0 && workerUserLock < workerRequestLock);
  assert.ok(workerRequestLock < workerProfileLock);
  assert.match(worker, /companion\.ownerUserId !== request\.userId/);
  assert.doesNotMatch(retention, /\.(deleteMany|updateMany|findMany)\(/);
  assert.match(retention, /target\."submittedByUserId" = \$1 OR EXISTS/);
  assert.match(retention, /target\."companionRoleSnapshot" IS DISTINCT FROM/);
  assert.match(companions, /ownerIdsToLock[\s\S]*\.sort\(\)/);
  assert.match(migration, /CompanionProfile_owner_deletion_guard/);
  assert.match(migration, /companion owner cannot change during account deletion/);
  for (const blocker of [
    "accountDeletionExecutionFailed",
    "accountDeletionExecutionExpiredLeases",
    "accountDeletionExecutionBacklogSlaBreached",
    "availabilityReminderPreparationExpiredLeases",
    "availabilityReminderReservationExpiredLeases",
    "availabilityReminderDeliveryClaimExpiredLeases",
    "availabilityReminderTerminalUnresolved"
  ]) {
    assert.match(commercial, new RegExp(blocker));
  }
});

const integrationUrl = String(
  process.env.ACCOUNT_DELETION_TEST_DATABASE_URL
    ?? process.env.TEST_DATABASE_URL
    ?? process.env.DATABASE_URL
    ?? ""
).trim();
const postgresPreflight = process.env.E2E_RUNNER_SUITE === POSTGRES_PREFLIGHT_SUITE
  ? assertIsolatedPostgresPreflightEnvironment()
  : null;

const claimSql = `
  WITH candidates AS MATERIALIZED (
    SELECT request."id"
    FROM "AccountDeletionRequest" request
    WHERE request."status" = 'processing'
      AND request."approvedById" IS NOT NULL
      AND request."approvedAt" IS NOT NULL
      AND request."retentionApprovalReference" IS NOT NULL
      AND (
        (
          request."executionStatus" IN ('queued', 'retryScheduled')
          AND (request."executionNextAttemptAt" IS NULL OR request."executionNextAttemptAt" <= CURRENT_TIMESTAMP)
        )
        OR (
          request."executionStatus" = 'processing'
          AND (request."executionLeaseExpiresAt" IS NULL OR request."executionLeaseExpiresAt" <= CURRENT_TIMESTAMP)
        )
      )
    ORDER BY COALESCE(request."executionNextAttemptAt", request."approvedAt"), request."createdAt", request."id"
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  ), leased AS (
    UPDATE "AccountDeletionRequest" request
    SET "executionStatus" = 'processing',
        "executionLeaseToken" = md5(random()::text || clock_timestamp()::text || request."id"),
        "executionLeaseExpiresAt" = CURRENT_TIMESTAMP + INTERVAL '30 seconds',
        "executionAttemptCount" = request."executionAttemptCount" + 1,
        "updatedAt" = CURRENT_TIMESTAMP
    FROM candidates
    WHERE request."id" = candidates."id"
    RETURNING request."id", request."executionLeaseToken" AS "leaseToken"
  )
  SELECT "id", "leaseToken" FROM leased
`;

const boundedDeleteSql = `
  WITH candidates AS MATERIALIZED (
    SELECT target.ctid AS row_ctid
    FROM "RefreshToken" target
    WHERE target."userId" = $1
    FOR UPDATE SKIP LOCKED
    LIMIT $2
  ), deleted AS (
    DELETE FROM "RefreshToken" target
    USING candidates
    WHERE target.ctid = candidates.row_ctid
    RETURNING target.ctid::text AS cursor
  )
  SELECT COUNT(*)::integer AS count, MAX(cursor) AS cursor FROM deleted
`;

if (postgresPreflight) test("real PostgreSQL keeps high-volume erasure and two-replica claims bounded", async (t) => {
  await postgresPreflight;
  const schema = `account_deletion_scale_${randomBytes(8).toString("hex")}`;
  const admin = new pg.Client({ connectionString: integrationUrl });
  const replicaA = new pg.Client({ connectionString: integrationUrl });
  const replicaB = new pg.Client({ connectionString: integrationUrl });
  await Promise.all([admin.connect(), replicaA.connect(), replicaB.connect()]);
  t.after(async () => {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await Promise.all([admin.end(), replicaA.end(), replicaB.end()]);
  });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  for (const client of [admin, replicaA, replicaB]) {
    await client.query(`SET search_path TO "${schema}"`);
    await client.query("SET statement_timeout TO '5s'");
  }

  await admin.query(`
    CREATE TABLE "User" ("id" text PRIMARY KEY);
    CREATE TABLE "CompanionProfile" ("id" text PRIMARY KEY, "ownerUserId" text);
    CREATE TABLE "AccountDeletionRequest" (
      "id" text PRIMARY KEY,
      "userId" text NOT NULL,
      "status" text NOT NULL,
      "approvedById" text,
      "approvedAt" timestamptz,
      "retentionApprovalReference" text,
      "executionStatus" text NOT NULL DEFAULT 'idle',
      "executionNextAttemptAt" timestamptz,
      "executionLeaseToken" text,
      "executionLeaseExpiresAt" timestamptz,
      "executionAttemptCount" integer NOT NULL DEFAULT 0,
      "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE "RefreshToken" (
      "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      "userId" text NOT NULL
    );
    CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken" ("userId");
    CREATE INDEX "AccountDeletionRequest_claim_idx" ON "AccountDeletionRequest"
      ("status", "executionStatus", "executionNextAttemptAt", "createdAt", "id");
  `);

  const migration = await readFile(migrationPath, "utf8");
  const triggerStart = migration.indexOf(
    'CREATE OR REPLACE FUNCTION "prevent_companion_owner_reassignment_during_deletion"()'
  );
  const triggerEnd = migration.indexOf('CREATE TABLE "AccountDeletionRatingRefreshJob"', triggerStart);
  assert.ok(triggerStart >= 0 && triggerEnd > triggerStart);
  await admin.query(migration.slice(triggerStart, triggerEnd));

  await admin.query(`
    INSERT INTO "User" ("id") VALUES ('owner-old'), ('owner-new');
    INSERT INTO "CompanionProfile" ("id", "ownerUserId")
    VALUES ('companion-guard', 'owner-old'), ('companion-race', 'owner-old');
    INSERT INTO "AccountDeletionRequest" (
      "id", "userId", "status", "approvedById", "approvedAt",
      "retentionApprovalReference", "executionStatus", "executionNextAttemptAt"
    ) VALUES (
      'deletion-owner', 'owner-old', 'processing', 'admin-2', NOW(),
      'legal:approved', 'queued', NOW()
    );
  `);
  await assert.rejects(
    admin.query(`UPDATE "CompanionProfile" SET "ownerUserId" = 'owner-new' WHERE "id" = 'companion-guard'`),
    (error) => error?.code === "23514"
  );

  await replicaA.query("BEGIN");
  await replicaA.query(`SELECT "id" FROM "User" WHERE "id" = 'owner-old' FOR UPDATE`);
  await replicaA.query(`SELECT "id" FROM "AccountDeletionRequest" WHERE "id" = 'deletion-owner' FOR UPDATE`);
  await replicaA.query(`SELECT "id" FROM "CompanionProfile" WHERE "id" = 'companion-race' FOR UPDATE`);
  const racedReassignment = replicaB
    .query(`UPDATE "CompanionProfile" SET "ownerUserId" = 'owner-new' WHERE "id" = 'companion-race'`)
    .then(() => ({ accepted: true }), (error) => ({ accepted: false, code: error.code }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  await replicaA.query("COMMIT");
  assert.deepEqual(await racedReassignment, { accepted: false, code: "23514" });

  await admin.query(`
    INSERT INTO "AccountDeletionRequest" (
      "id", "userId", "status", "approvedById", "approvedAt",
      "retentionApprovalReference", "executionStatus", "executionNextAttemptAt", "createdAt"
    )
    SELECT 'deletion-scale-' || lpad(series::text, 4, '0'),
           'subject-' || lpad(series::text, 4, '0'),
           'processing', 'admin-2', NOW(), 'legal:approved', 'queued', NOW(),
           NOW() - INTERVAL '10 minutes'
    FROM generate_series(1, 1000) series;
  `);
  const claimAll = async (client) => {
    const ids = [];
    for (;;) {
      const claimed = await client.query(claimSql);
      if (claimed.rowCount === 0) return ids;
      assert.ok(claimed.rowCount <= 1);
      ids.push(claimed.rows[0].id);
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  const [claimedA, claimedB] = await Promise.all([
    claimAll(replicaA),
    claimAll(replicaB)
  ]);
  const claimed = [...claimedA, ...claimedB].filter((id) => id.startsWith("deletion-scale-"));
  assert.equal(claimed.length, 1000);
  assert.equal(new Set(claimed).size, 1000);
  assert.ok(claimedA.length > 0 && claimedB.length > 0);

  const crashedId = claimed[0];
  await admin.query(`
    UPDATE "AccountDeletionRequest"
    SET "executionLeaseExpiresAt" = NOW() - INTERVAL '1 second'
    WHERE "id" = $1
  `, [crashedId]);
  const reclaimed = await admin.query(claimSql);
  assert.equal(reclaimed.rows[0]?.id, crashedId);
  const reclaimedState = await admin.query(`
    SELECT "executionAttemptCount" FROM "AccountDeletionRequest" WHERE "id" = $1
  `, [crashedId]);
  assert.equal(reclaimedState.rows[0].executionAttemptCount, 2);

  await admin.query(`
    INSERT INTO "RefreshToken" ("userId")
    SELECT 'other-' || (series % 1000)::text FROM generate_series(1, 180000) series;
    INSERT INTO "RefreshToken" ("userId")
    SELECT 'erase-subject' FROM generate_series(1, 20000);
    ANALYZE "RefreshToken";
  `);
  const tokenIndexes = await admin.query(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = $1
      AND tablename = 'RefreshToken'
  `, [schema]);
  assert.ok(
    tokenIndexes.rows.some((row) => row.indexname === "RefreshToken_userId_idx"),
    "bounded erasure requires the RefreshToken user lookup index"
  );
  const plan = await admin.query(`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT target.ctid
    FROM "RefreshToken" target
    WHERE target."userId" = $1
    FOR UPDATE SKIP LOCKED
    LIMIT 250
  `, ["erase-subject"]);
  const planDocument = plan.rows[0]["QUERY PLAN"];
  const serializedPlan = JSON.stringify(planDocument);
  assert.doesNotMatch(serializedPlan, /"Node Type":"Sort"/);
  assert.match(serializedPlan, /"Node Type":"Limit"/);
  assert.match(serializedPlan, /"Actual Rows":250/);

  const batchCounts = [];
  const batchDurationsMs = [];
  for (;;) {
    const startedAt = performance.now();
    await admin.query("BEGIN");
    try {
      const batch = await admin.query(boundedDeleteSql, ["erase-subject", 250]);
      const count = Number(batch.rows[0]?.count ?? 0);
      const remaining = await admin.query(`
        SELECT EXISTS (
          SELECT 1 FROM "RefreshToken" target WHERE target."userId" = $1
        ) AS "exists"
      `, ["erase-subject"]);
      await admin.query("COMMIT");
      const elapsed = performance.now() - startedAt;
      assert.ok(count <= 250, `bounded erasure mutated ${count} rows`);
      assert.ok(elapsed < 5_000, `bounded erasure transaction took ${elapsed}ms`);
      if (count > 0) {
        batchCounts.push(count);
        batchDurationsMs.push(elapsed);
      }
      if (!remaining.rows[0].exists) break;
    } catch (error) {
      await admin.query("ROLLBACK");
      throw error;
    }
  }
  assert.equal(batchCounts.reduce((sum, count) => sum + count, 0), 20000);
  assert.equal(batchCounts.length, 80);
  assert.ok(batchCounts.every((count) => count === 250));
  const otherRows = await admin.query(`SELECT COUNT(*)::integer AS count FROM "RefreshToken"`);
  assert.equal(otherRows.rows[0].count, 180000);
  t.diagnostic(`bounded batches=${batchCounts.length} maxBatch=${Math.max(...batchCounts)} maxTxMs=${Math.max(...batchDurationsMs).toFixed(2)}`);
  t.diagnostic(`plan=${serializedPlan}`);
});
