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
const targetMigration = "20260801005000_notification_delivery_claim_readiness";

const claimSql = `
  WITH candidates AS (
    SELECT delivery."id", delivery."nextAttemptAt"
    FROM "NotificationDelivery" AS delivery
    WHERE delivery."status" = 'pending'::"NotificationDeliveryStatus"
      AND delivery."nextAttemptAt" <= $1
    ORDER BY delivery."nextAttemptAt" ASC, delivery."id" ASC
    FOR UPDATE SKIP LOCKED
    LIMIT $4
  ), claimed AS (
    UPDATE "NotificationDelivery" AS delivery
    SET "status" = 'processing'::"NotificationDeliveryStatus",
        "leaseToken" = $2,
        "leaseExpiresAt" = $3,
        "updatedAt" = $1
    FROM candidates
    WHERE delivery."id" = candidates."id"
    RETURNING delivery."id", delivery."leaseToken", candidates."nextAttemptAt"
  )
  SELECT claimed."id", claimed."leaseToken"
  FROM claimed
  ORDER BY claimed."nextAttemptAt" ASC, claimed."id" ASC
`;

const recoverySql = `
  WITH candidates AS (
    SELECT delivery."id", delivery."leaseExpiresAt"
    FROM "NotificationDelivery" AS delivery
    WHERE delivery."status" = 'processing'::"NotificationDeliveryStatus"
      AND (delivery."leaseExpiresAt" IS NULL OR delivery."leaseExpiresAt" <= $1)
    ORDER BY delivery."leaseExpiresAt" ASC NULLS FIRST, delivery."id" ASC
    FOR UPDATE SKIP LOCKED
    LIMIT $2
  ), finalized AS (
    UPDATE "NotificationDelivery" AS delivery
    SET "status" = 'failed'::"NotificationDeliveryStatus",
        "errorCode" = 'LEASE_EXPIRED_UNKNOWN_STATE',
        "lastError" = 'Worker lease expired after an unknown remote delivery state',
        "leaseToken" = NULL,
        "leaseExpiresAt" = NULL,
        "updatedAt" = $1
    FROM candidates
    WHERE delivery."id" = candidates."id"
    RETURNING delivery."id", candidates."leaseExpiresAt"
  )
  SELECT finalized."id"
  FROM finalized
  ORDER BY finalized."leaseExpiresAt" ASC NULLS FIRST, finalized."id" ASC
`;

test("notification delivery uses bounded stable SKIP LOCKED claim and recovery", async () => {
  const [worker, migration, policy, commercial] = await Promise.all([
    readFile(join(apiRoot, "src", "notifications", "notification-delivery.worker.ts"), "utf8"),
    readFile(join(migrationsRoot, targetMigration, "migration.sql"), "utf8"),
    readFile(join(apiRoot, "src", "notifications", "notification-delivery.policy.ts"), "utf8"),
    readFile(join(apiRoot, "src", "commercial", "commercial.service.ts"), "utf8")
  ]);

  assert.equal((worker.match(/FOR UPDATE SKIP LOCKED/g) ?? []).length >= 3, true);
  assert.match(worker, /ORDER BY delivery\."nextAttemptAt" ASC, delivery\."id" ASC/);
  assert.match(worker, /ORDER BY delivery\."leaseExpiresAt" ASC NULLS FIRST, delivery\."id" ASC/);
  assert.match(worker, /const CLAIM_CHUNK_SIZE = 20/);
  assert.match(worker, /const MAX_RECOVERY_BATCHES_PER_RUN = 4/);
  assert.doesNotMatch(worker, /notificationDelivery\.findMany\(\{[\s\S]*?nextAttemptAt/);
  const claimBoundary = worker.slice(
    worker.indexOf("private async claimDueBatch"),
    worker.indexOf("private async recoverExpiredLeases")
  );
  assert.doesNotMatch(claimBoundary, /provider\.send/);
  const reserveBoundary = worker.slice(
    worker.indexOf("private async reserveGrant"),
    worker.indexOf("private async releaseGrantAndRetry")
  );
  assert.doesNotMatch(reserveBoundary, /provider\.send/);
  assert.match(migration, /NotificationDelivery_status_nextAttemptAt_id_idx/);
  assert.match(migration, /NotificationDelivery_status_leaseExpiresAt_id_idx/);
  assert.match(policy, /Math\.max\([\s\S]*NOTIFICATION_DELIVERY_MIN_READINESS_SLA_SECONDS[\s\S]*notificationDeliveryIntervalSeconds\(config\) \* 2/);
  for (const field of [
    "notificationDeliveryDisabledWithPending",
    "notificationDeliveryOverduePending",
    "availabilityReminderPreparationFailures",
    "availabilityReminderReservationFailures",
    "availabilityReminderAttemptExpiredLeases",
    "availabilityReminderTerminalUnresolved"
  ]) {
    assert.match(commercial, new RegExp(field));
  }
});

const integrationUrl = String(
  process.env.NOTIFICATION_DELIVERY_CLAIM_TEST_DATABASE_URL ?? ""
).trim();

test("ten PostgreSQL replicas claim 10,000 due deliveries without overlap and recover bounded leases", {
  skip: integrationUrl
    ? false
    : "set NOTIFICATION_DELIVERY_CLAIM_TEST_DATABASE_URL to a disposable PostgreSQL database"
}, async (t) => {
  const schema = `notification_claim_${randomBytes(8).toString("hex")}`;
  const admin = new pg.Client({ connectionString: integrationUrl });
  const replicas = Array.from(
    { length: 10 },
    () => new pg.Client({ connectionString: integrationUrl })
  );
  await Promise.all([admin.connect(), ...replicas.map((client) => client.connect())]);
  t.after(async () => {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await Promise.all([admin.end(), ...replicas.map((client) => client.end())]);
  });

  await admin.query(`CREATE SCHEMA "${schema}"`);
  for (const client of [admin, ...replicas]) {
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
  const deliveryIndexes = await admin.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = $1
      AND indexname IN (
        'NotificationDelivery_status_nextAttemptAt_id_idx',
        'NotificationDelivery_status_leaseExpiresAt_id_idx'
      )
    ORDER BY indexname
  `, [schema]);
  assert.equal(deliveryIndexes.rowCount, 2);
  const deliveryIndexDefinitions = deliveryIndexes.rows.map((row) => row.indexdef).join("\n");
  assert.match(deliveryIndexDefinitions, /\("?status"?, "?leaseExpiresAt"?, "?id"?\)/);
  assert.match(deliveryIndexDefinitions, /\("?status"?, "?nextAttemptAt"?, "?id"?\)/);

  await admin.query(`
    INSERT INTO "User" ("id", "role", "accountStatus", "createdAt", "updatedAt")
    VALUES ('notification-recipient', 'user', 'active', NOW(), NOW())
  `);
  await admin.query(`
    INSERT INTO "Notification" ("id", "userId", "type", "title", "body", "createdAt")
    SELECT 'notification-' || lpad(series::text, 5, '0'),
           'notification-recipient',
           'paymentSuccess'::"NotificationType",
           'Payment received',
           'Payment received',
           NOW() - INTERVAL '5 minutes'
    FROM generate_series(1, 10000) AS series
  `);
  await admin.query(`
    INSERT INTO "NotificationDelivery" (
      "id", "notificationId", "userId", "templateKey", "status",
      "nextAttemptAt", "createdAt", "updatedAt"
    )
    SELECT 'delivery-' || lpad(series::text, 5, '0'),
           'notification-' || lpad(series::text, 5, '0'),
           'notification-recipient',
           'paymentSuccess',
           'pending'::"NotificationDeliveryStatus",
           NOW() - INTERVAL '4 minutes',
           NOW() - INTERVAL '5 minutes',
           NOW() - INTERVAL '5 minutes'
    FROM generate_series(1, 10000) AS series
  `);

  const claimAt = new Date();
  const leaseExpiresAt = new Date(claimAt.getTime() + 120_000);
  const claimedByReplica = await Promise.all(replicas.map(async (client, replicaIndex) => {
    const ids = [];
    for (let batch = 0; ; batch += 1) {
      const result = await client.query(claimSql, [
        claimAt,
        `replica-${replicaIndex}-batch-${batch}`,
        leaseExpiresAt,
        100
      ]);
      if (result.rows.length === 0) break;
      ids.push(...result.rows.map((row) => row.id));
      await new Promise((resolve) => setImmediate(resolve));
    }
    return ids;
  }));
  const allClaimed = claimedByReplica.flat();
  assert.equal(allClaimed.length, 10_000);
  assert.equal(new Set(allClaimed).size, 10_000, "no delivery may be claimed twice");
  assert.equal(claimedByReplica.filter((ids) => ids.length > 0).length, 10);
  const queue = await admin.query(`
    SELECT "status"::text AS "status", COUNT(*)::integer AS "count"
    FROM "NotificationDelivery"
    GROUP BY "status"
  `);
  assert.deepEqual(queue.rows, [{ status: "processing", count: 10_000 }]);

  const recoveryAt = new Date();
  await admin.query(`
    UPDATE "NotificationDelivery"
    SET "leaseExpiresAt" = CASE
      WHEN "id" = 'delivery-00001' THEN NULL
      ELSE $1::timestamptz - INTERVAL '1 second'
    END
    WHERE "id" BETWEEN 'delivery-00001' AND 'delivery-00451'
  `, [recoveryAt]);
  const recoveredBatches = [];
  for (;;) {
    const recovered = await admin.query(recoverySql, [recoveryAt, 200]);
    recoveredBatches.push(recovered.rows.map((row) => row.id));
    if (recovered.rows.length < 200) break;
  }
  const emptyRecovery = await admin.query(recoverySql, [recoveryAt, 200]);
  assert.deepEqual(recoveredBatches.map((batch) => batch.length), [200, 200, 51]);
  assert.equal(emptyRecovery.rowCount, 0);
  assert.deepEqual(recoveredBatches.flat(), Array.from(
    { length: 451 },
    (_, index) => `delivery-${String(index + 1).padStart(5, "0")}`
  ));
  const boundary = await admin.query(`
    SELECT "id", "status"::text AS "status", "errorCode"
    FROM "NotificationDelivery"
    WHERE "id" IN ('delivery-00451', 'delivery-00452')
    ORDER BY "id"
  `);
  assert.deepEqual(boundary.rows, [
    { id: "delivery-00451", status: "failed", errorCode: "LEASE_EXPIRED_UNKNOWN_STATE" },
    { id: "delivery-00452", status: "processing", errorCode: null }
  ]);
});
