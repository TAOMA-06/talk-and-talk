import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, "..");
const batchSize = 250;

test("retained snapshots use an explicit bounded registry and fail-closed final gate", async () => {
  const [registry, service, worker] = await Promise.all([
    readFile(join(apiRoot, "src/users/account-deletion-retained-snapshot.registry.ts"), "utf8"),
    readFile(join(apiRoot, "src/users/users.service.ts"), "utf8"),
    readFile(join(apiRoot, "src/users/account-deletion-execution.worker.ts"), "utf8")
  ]);
  const sourceEntries = registry.match(/^\s{2}retainedSnapshotSource\(/gm) ?? [];
  assert.equal(sourceEntries.length, 51);
  assert.match(registry, /LIMIT \$\{ACCOUNT_DELETION_RETAINED_SNAPSHOT_BATCH_SIZE\}/);
  assert.match(registry, /source_rows\."stableTime" > \$\{highWaterAt\}/);
  assert.match(service, /assertRetainedSnapshotFinalGate/);
  assert.match(service, /ACCOUNT_DELETION_RETAINED_SNAPSHOT_REGISTRY\.length/);

  const snapshotMethod = worker.slice(
    worker.indexOf("private async snapshotRetainedCategory"),
    worker.indexOf("private assertRetainedSnapshotPage")
  );
  assert.match(snapshotMethod, /AccountDeletionRetentionSnapshotProgress/);
  assert.match(snapshotMethod, /SET LOCAL statement_timeout/);
  assert.match(snapshotMethod, /SET LOCAL lock_timeout/);
  assert.match(snapshotMethod, /FOR UPDATE/);
  assert.doesNotMatch(snapshotMethod, /SKIP LOCKED/);
  assert.doesNotMatch(snapshotMethod, /Promise\.all/);
});

const integrationUrl = String(
  process.env.ACCOUNT_DELETION_RETENTION_SNAPSHOT_TEST_DATABASE_URL
    ?? process.env.ACCOUNT_DELETION_TEST_DATABASE_URL
    ?? process.env.TEST_DATABASE_URL
    ?? process.env.DATABASE_URL
    ?? ""
).trim();

const pageSql = `
  SELECT target."id", target."consentedAt" AS "stableTime"
  FROM "LegalConsentReceipt" target
  WHERE target."userId" = $1
    AND target."consentedAt" <= $2
    AND (
      $3::timestamp IS NULL
      OR (target."consentedAt", target."id") > ($3::timestamp, $4::text)
    )
  ORDER BY target."consentedAt", target."id"
  LIMIT $5
`;

async function processSnapshotPage(client, { requestId, userId, crashBeforeCommit = false }) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL statement_timeout = '3000ms'");
    await client.query("SET LOCAL lock_timeout = '500ms'");
    await client.query(`SELECT "id" FROM "User" WHERE "id" = $1 FOR UPDATE`, [userId]);
    const requestResult = await client.query(`
      SELECT "id", "approvedAt"
      FROM "AccountDeletionRequest"
      WHERE "id" = $1 AND "userId" = $2
      FOR UPDATE
    `, [requestId, userId]);
    assert.equal(requestResult.rowCount, 1);
    const approvedAt = requestResult.rows[0].approvedAt;
    const progressResult = await client.query(`
      SELECT
        "id", "highWaterAt", "cursorCreatedAt", "cursorId",
        "observedCount", "completedAt"
      FROM "AccountDeletionRetentionSnapshotProgress"
      WHERE "deletionRequestId" = $1
        AND "category" = 'consent_rights_account_governance'
        AND "sourceKey" = 'legal_consent_receipts'
      FOR UPDATE
    `, [requestId]);
    assert.equal(progressResult.rowCount, 1);
    const progress = progressResult.rows[0];
    assert.equal(progress.highWaterAt.getTime(), approvedAt.getTime());
    assert.equal(progress.completedAt, null);
    const page = await client.query(pageSql, [
      userId,
      approvedAt,
      progress.cursorCreatedAt,
      progress.cursorId,
      batchSize
    ]);
    assert.ok(page.rowCount <= batchSize);
    const last = page.rows.at(-1) ?? null;
    const completedAt = page.rowCount < batchSize ? new Date() : null;
    await client.query(`
      UPDATE "AccountDeletionRetentionSnapshotProgress"
      SET
        "cursorCreatedAt" = COALESCE($2, "cursorCreatedAt"),
        "cursorId" = COALESCE($3, "cursorId"),
        "observedCount" = "observedCount" + $4,
        "completedAt" = $5,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = $1
    `, [progress.id, last?.stableTime ?? null, last?.id ?? null, page.rowCount, completedAt]);
    if (crashBeforeCommit) {
      await client.query("ROLLBACK");
    } else {
      await client.query("COMMIT");
    }
    return {
      rows: page.rows,
      count: page.rowCount,
      completed: completedAt !== null,
      priorObservedCount: progress.observedCount
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

test("real PostgreSQL snapshots 100k rows in 250-row commits, resumes crashes, and rejects late arrivals", {
  skip: integrationUrl
    ? false
    : "set ACCOUNT_DELETION_RETENTION_SNAPSHOT_TEST_DATABASE_URL to a disposable PostgreSQL database"
}, async (t) => {
  assert.doesNotMatch(pageSql, /SKIP LOCKED/);
  const schema = `retention_snapshot_${randomBytes(8).toString("hex")}`;
  const admin = new pg.Client({ connectionString: integrationUrl });
  const workerA = new pg.Client({ connectionString: integrationUrl });
  const workerB = new pg.Client({ connectionString: integrationUrl });
  await Promise.all([admin.connect(), workerA.connect(), workerB.connect()]);
  t.after(async () => {
    await Promise.allSettled([workerA.query("ROLLBACK"), workerB.query("ROLLBACK")]);
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await Promise.all([admin.end(), workerA.end(), workerB.end()]);
  });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  for (const client of [admin, workerA, workerB]) {
    await client.query(`SET search_path TO "${schema}"`);
    await client.query("SET statement_timeout TO '60s'");
  }

  await admin.query(`
    CREATE TABLE "User" (
      "id" text PRIMARY KEY
    );
    CREATE TABLE "AccountDeletionRequest" (
      "id" text PRIMARY KEY,
      "userId" text NOT NULL REFERENCES "User"("id"),
      "approvedAt" timestamp(3) NOT NULL
    );
    CREATE TABLE "LegalConsentReceipt" (
      "id" text PRIMARY KEY,
      "userId" text NOT NULL REFERENCES "User"("id"),
      "consentedAt" timestamp(3) NOT NULL
    );
    CREATE INDEX "LegalConsentReceipt_snapshot_cursor"
      ON "LegalConsentReceipt"("userId", "consentedAt", "id");
    CREATE TABLE "AccountDeletionRetentionSnapshotProgress" (
      "id" text PRIMARY KEY,
      "deletionRequestId" text NOT NULL REFERENCES "AccountDeletionRequest"("id") ON DELETE CASCADE,
      "category" text NOT NULL,
      "sourceKey" text NOT NULL,
      "highWaterAt" timestamp(3) NOT NULL,
      "cursorCreatedAt" timestamp(3),
      "cursorId" text,
      "observedCount" integer NOT NULL DEFAULT 0 CHECK ("observedCount" >= 0),
      "completedAt" timestamp(3),
      "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (("cursorCreatedAt" IS NULL) = ("cursorId" IS NULL)),
      UNIQUE ("deletionRequestId", "category", "sourceKey")
    );
  `);

  const approvedAt = new Date("2026-07-31T08:00:00.000Z");
  await admin.query(`INSERT INTO "User" ("id") VALUES ('snapshot-user')`);
  await admin.query(`
    INSERT INTO "AccountDeletionRequest" ("id", "userId", "approvedAt")
    VALUES ('snapshot-request', 'snapshot-user', $1)
  `, [approvedAt]);
  await admin.query(`
    INSERT INTO "AccountDeletionRetentionSnapshotProgress" (
      "id", "deletionRequestId", "category", "sourceKey", "highWaterAt"
    ) VALUES (
      'snapshot-progress', 'snapshot-request',
      'consent_rights_account_governance', 'legal_consent_receipts', $1
    )
  `, [approvedAt]);
  await admin.query(`
    INSERT INTO "LegalConsentReceipt" ("id", "userId", "consentedAt")
    SELECT
      'receipt-' || lpad(series::text, 6, '0'),
      'snapshot-user',
      $1::timestamp - INTERVAL '1 day' + series * INTERVAL '1 millisecond'
    FROM generate_series(1, 100000) series
  `, [approvedAt]);

  const first = await processSnapshotPage(workerA, {
    requestId: "snapshot-request",
    userId: "snapshot-user"
  });
  assert.equal(first.count, batchSize);
  assert.equal(first.priorObservedCount, 0);

  const rolledBack = await processSnapshotPage(workerA, {
    requestId: "snapshot-request",
    userId: "snapshot-user",
    crashBeforeCommit: true
  });
  assert.equal(rolledBack.count, batchSize);
  assert.equal(rolledBack.priorObservedCount, batchSize);

  const resumed = await processSnapshotPage(workerB, {
    requestId: "snapshot-request",
    userId: "snapshot-user"
  });
  assert.deepEqual(
    resumed.rows.map((row) => row.id),
    rolledBack.rows.map((row) => row.id),
    "the durable cursor must replay the rolled-back page without gaps"
  );
  assert.equal(resumed.priorObservedCount, batchSize);

  const lateAt = new Date(approvedAt.getTime() + 1);
  await admin.query(`
    INSERT INTO "LegalConsentReceipt" ("id", "userId", "consentedAt")
    VALUES ('receipt-late', 'snapshot-user', $1)
  `, [lateAt]);

  let committedRows = first.count + resumed.count;
  let commitCount = 2;
  while (true) {
    const result = await processSnapshotPage(workerB, {
      requestId: "snapshot-request",
      userId: "snapshot-user"
    });
    committedRows += result.count;
    commitCount += 1;
    assert.ok(result.count <= batchSize);
    if (result.completed) break;
  }
  assert.equal(committedRows, 100000);
  assert.equal(commitCount, 401);

  const progress = await admin.query(`
    SELECT "observedCount", "completedAt", "cursorCreatedAt", "cursorId"
    FROM "AccountDeletionRetentionSnapshotProgress"
    WHERE "id" = 'snapshot-progress'
  `);
  assert.equal(progress.rows[0].observedCount, 100000);
  assert.ok(progress.rows[0].completedAt instanceof Date);
  assert.equal(progress.rows[0].cursorId, "receipt-100000");
  assert.ok(progress.rows[0].cursorCreatedAt.getTime() <= approvedAt.getTime());

  const lateGate = await admin.query(`
    SELECT EXISTS (
      SELECT 1
      FROM "LegalConsentReceipt"
      WHERE "userId" = 'snapshot-user'
        AND "consentedAt" > $1
    ) AS "exists"
  `, [approvedAt]);
  assert.equal(lateGate.rows[0].exists, true);
});
