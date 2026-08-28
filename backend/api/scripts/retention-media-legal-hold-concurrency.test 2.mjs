import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import pg from "pg";

import { assertIsolatedPostgresPreflightEnvironment } from "./isolated-postgres-preflight-environment.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, "..");
const integrationUrl = String(
  process.env.RETENTION_MEDIA_LEGAL_HOLD_TEST_DATABASE_URL
    ?? process.env.TEST_DATABASE_URL
    ?? ""
).trim();
const require = createRequire(import.meta.url);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function prismaAdapter(client) {
  return {
    $queryRawUnsafe: async (sql, ...parameters) => (await client.query(sql, parameters)).rows,
    $executeRawUnsafe: async (sql, ...parameters) => (await client.query(sql, parameters)).rowCount
  };
}

function mediaService(client, deleteObject) {
  const { MediaAssetService } = require(join(
    apiRoot,
    "dist",
    "src",
    "moderation",
    "media",
    "media-asset.service.js"
  ));
  const storage = {
    name: "retention-contract-storage",
    isConfigured: true,
    createUploadInstruction: async () => null,
    verifyUpload: async () => false,
    createReadUrl: async () => null,
    delete: deleteObject
  };
  return new MediaAssetService(
    prismaAdapter(client),
    storage,
    { name: "disabled", isConfigured: false }
  );
}

async function barrierMigrationSource() {
  return readFile(join(
    apiRoot,
    "prisma",
    "migrations",
    "20260825030000_retention_media_legal_hold_barrier",
    "migration.sql"
  ), "utf8");
}

async function createBaseTables(client, { applyMigration = true } = {}) {
  await client.query(`
    CREATE TABLE "AccountDataRetentionRecord" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "category" TEXT NOT NULL,
      "disposition" TEXT NOT NULL,
      "retentionEndsAt" TIMESTAMP(3),
      "expiryProcessedAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE "AccountDataRetentionLegalHoldAction" (
      "id" TEXT PRIMARY KEY,
      "retentionRecordId" TEXT NOT NULL,
      "action" TEXT NOT NULL,
      "status" TEXT NOT NULL
    );
    CREATE TABLE "AccountDataRetentionLegalHold" (
      "id" TEXT PRIMARY KEY,
      "retentionRecordId" TEXT NOT NULL,
      "releasedAt" TIMESTAMP(3)
    );
    CREATE TABLE "MediaAsset" (
      "id" TEXT PRIMARY KEY,
      "uploaderId" TEXT NOT NULL,
      "purpose" TEXT NOT NULL,
      "storageKey" TEXT NOT NULL UNIQUE,
      "kind" TEXT NOT NULL,
      "mimeType" TEXT NOT NULL,
      "sizeBytes" INTEGER NOT NULL,
      "sha256" TEXT NOT NULL,
      "durationMs" INTEGER,
      "status" TEXT NOT NULL DEFAULT 'approved',
      "expiresAt" TIMESTAMP(3),
      "storageDeleteRequestedAt" TIMESTAMP(3),
      "storageDeletedAt" TIMESTAMP(3),
      "storageDeleteLeaseToken" TEXT,
      "storageDeleteLeaseExpiresAt" TIMESTAMP(3),
      "storageDeleteAttemptCount" INTEGER NOT NULL DEFAULT 0,
      "storageDeleteNextAttemptAt" TIMESTAMP(3),
      "storageDeleteLastErrorCode" TEXT,
      "extractedText" TEXT,
      "analysis" JSONB,
      "lastError" TEXT,
      "nextAttemptAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  if (applyMigration) await client.query(await barrierMigrationSource());
}

async function reset(client) {
  await client.query(`
    TRUNCATE TABLE
      "MediaAsset",
      "AccountDataRetentionLegalHold",
      "AccountDataRetentionLegalHoldAction",
      "AccountDataRetentionRecord"
    CASCADE
  `);
}

async function insertRecordAndAsset(
  client,
  suffix,
  { bound = true, retentionEndsAt = new Date(Date.now() - 60_000) } = {}
) {
  const recordId = `record-${suffix}`;
  const assetId = `asset-${suffix}`;
  await client.query(`
    INSERT INTO "AccountDataRetentionRecord" (
      "id", "userId", "category", "disposition", "retentionEndsAt", "createdAt", "updatedAt"
    ) VALUES ($1, 'user-target', 'support_disputes_safety', 'retainedRestricted', $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [recordId, retentionEndsAt]);
  await client.query(`
    INSERT INTO "MediaAsset" (
      "id", "uploaderId", "purpose", "storageKey", "kind", "mimeType",
      "sizeBytes", "sha256", "status", "expiresAt", "retentionExpiryRecordId"
    ) VALUES (
      $1, 'user-target', 'chatMessage', $2, 'image', 'image/jpeg',
      12, $3, 'approved', CURRENT_TIMESTAMP - INTERVAL '1 minute', $4
    )
  `, [assetId, `storage/${assetId}`, "a".repeat(64), bound ? recordId : null]);
  return { recordId, assetId };
}

test("retention media delete claims and legal-hold placement are linearly ordered", {
  skip: integrationUrl
    ? false
    : "set TEST_DATABASE_URL through the sealed PostgreSQL preflight runner"
}, async (t) => {
  await assertIsolatedPostgresPreflightEnvironment();
  const workerClient = new pg.Client({ connectionString: integrationUrl });
  const controlClient = new pg.Client({ connectionString: integrationUrl });
  const namespace = `retention_media_hold_${randomBytes(8).toString("hex")}`;
  await Promise.all([workerClient.connect(), controlClient.connect()]);
  t.after(async () => {
    await controlClient.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
    await Promise.all([workerClient.end(), controlClient.end()]);
  });
  for (const client of [workerClient, controlClient]) {
    await client.query(`SET statement_timeout TO '5s'`);
  }
  await controlClient.query(`CREATE SCHEMA "${namespace}"`);
  for (const client of [workerClient, controlClient]) {
    await client.query(`SET search_path TO "${namespace}"`);
  }
  await createBaseTables(controlClient);

  // Placement wins: the pending action is a barrier before the claim CTE
  // obtains its record lock, so no storage request starts.
  let ids = await insertRecordAndAsset(controlClient, "placement-wins", { bound: false });
  await controlClient.query(`
    INSERT INTO "AccountDataRetentionLegalHoldAction" (
      "id", "retentionRecordId", "action", "status"
    ) VALUES ('placement-wins', $1, 'placement', 'pending')
  `, [ids.recordId]);
  let deleteCalls = 0;
  let service = mediaService(workerClient, async () => {
    deleteCalls += 1;
    return "deleted";
  });
  assert.deepEqual(await service.expireDueAssets(), {
    processed: 0,
    expired: 0,
    notFound: 0,
    failed: 0,
    leaseLost: 0,
    batchSize: 20,
    hasMore: false
  });
  assert.equal(deleteCalls, 0);
  const heldBeforeClaim = await controlClient.query(`
    SELECT asset."storageDeleteLeaseToken", asset."retentionExpiryRecordId",
           record."mediaDeletionClaimedAt"
    FROM "MediaAsset" asset
    LEFT JOIN "AccountDataRetentionRecord" record
      ON record."id" = asset."retentionExpiryRecordId"
    WHERE asset."id" = $1
  `, [ids.assetId]);
  assert.deepEqual(heldBeforeClaim.rows[0], {
    storageDeleteLeaseToken: null,
    retentionExpiryRecordId: null,
    mediaDeletionClaimedAt: null
  });

  // Delete claim wins: its committed lease and record marker remain visible
  // for the entire external call. Placement must fail rather than pretend the
  // bytes can still be preserved.
  await reset(controlClient);
  ids = await insertRecordAndAsset(controlClient, "delete-wins", { bound: false });
  const provider = deferred();
  const providerStarted = deferred();
  service = mediaService(workerClient, async () => {
    providerStarted.resolve();
    return provider.promise;
  });
  const expiry = service.expireDueAssets();
  await providerStarted.promise;
  const inFlight = await controlClient.query(`
    SELECT
      asset."storageDeleteLeaseToken" IS NOT NULL AS leased,
      record."mediaDeletionClaimedAt" IS NOT NULL AS claimed
    FROM "MediaAsset" asset
    JOIN "AccountDataRetentionRecord" record
      ON record."id" = asset."retentionExpiryRecordId"
    WHERE asset."id" = $1
  `, [ids.assetId]);
  assert.deepEqual(inFlight.rows[0], { leased: true, claimed: true });
  await assert.rejects(
    controlClient.query(`
      INSERT INTO "AccountDataRetentionLegalHoldAction" (
        "id", "retentionRecordId", "action", "status"
      ) VALUES ('delete-wins', $1, 'placement', 'pending')
    `, [ids.recordId]),
    (error) => error?.code === "55000"
      && /already claimed|already in flight/.test(String(error?.message ?? ""))
  );
  provider.resolve("deleted");
  assert.equal((await expiry).expired, 1);
  await assert.rejects(
    controlClient.query(`
      INSERT INTO "AccountDataRetentionLegalHoldAction" (
        "id", "retentionRecordId", "action", "status"
      ) VALUES ('delete-completed', $1, 'placement', 'pending')
    `, [ids.recordId]),
    (error) => error?.code === "55000" && /already claimed/.test(String(error?.message ?? ""))
  );

  // Release wake: an active hold excludes the bound asset, while the same due
  // row becomes immediately claimable after the hold is atomically released.
  await reset(controlClient);
  ids = await insertRecordAndAsset(controlClient, "release-wake", { bound: false });
  await controlClient.query(`
    INSERT INTO "AccountDataRetentionLegalHoldAction" (
      "id", "retentionRecordId", "action", "status"
    ) VALUES ('placement-approved', $1, 'placement', 'approved')
  `, [ids.recordId]);
  await controlClient.query(`
    INSERT INTO "AccountDataRetentionLegalHold" (
      "id", "retentionRecordId", "releasedAt"
    ) VALUES ('hold-active', $1, NULL)
  `, [ids.recordId]);
  deleteCalls = 0;
  service = mediaService(workerClient, async () => {
    deleteCalls += 1;
    return "deleted";
  });
  assert.equal((await service.expireDueAssets()).processed, 0);
  await controlClient.query(`
    INSERT INTO "AccountDataRetentionLegalHoldAction" (
      "id", "retentionRecordId", "action", "status"
    ) VALUES ('release-approved', $1, 'release', 'approved')
  `, [ids.recordId]);
  await controlClient.query(`
    UPDATE "AccountDataRetentionLegalHold"
    SET "releasedAt" = CURRENT_TIMESTAMP
    WHERE "id" = 'hold-active'
  `);
  assert.equal((await service.expireDueAssets()).expired, 1);
  assert.equal(deleteCalls, 1);

  // A hold on one retention record must not stop ordinary unbound media.
  await reset(controlClient);
  const held = await insertRecordAndAsset(controlClient, "held-bound");
  const ordinary = { assetId: "asset-ordinary" };
  await controlClient.query(`
    INSERT INTO "MediaAsset" (
      "id", "uploaderId", "purpose", "storageKey", "kind", "mimeType",
      "sizeBytes", "sha256", "status", "expiresAt", "retentionExpiryRecordId"
    ) VALUES (
      $1, 'active-user-without-deletion-ledger', 'chatMessage', $2,
      'image', 'image/jpeg', 12, $3, 'approved',
      CURRENT_TIMESTAMP - INTERVAL '1 minute', NULL
    )
  `, [ordinary.assetId, `storage/${ordinary.assetId}`, "b".repeat(64)]);
  await controlClient.query(`
    INSERT INTO "AccountDataRetentionLegalHoldAction" (
      "id", "retentionRecordId", "action", "status"
    ) VALUES ('ordinary-control-hold', $1, 'placement', 'pending')
  `, [held.recordId]);
  deleteCalls = 0;
  service = mediaService(workerClient, async () => {
    deleteCalls += 1;
    return "deleted";
  });
  const ordinaryRun = await service.expireDueAssets();
  assert.equal(ordinaryRun.processed, 1);
  assert.equal(ordinaryRun.expired, 1);
  assert.equal(deleteCalls, 1);
  assert.deepEqual((await controlClient.query(`
    SELECT "id", "storageDeletedAt" IS NOT NULL AS deleted
    FROM "MediaAsset" ORDER BY "id"
  `)).rows, [
    { id: held.assetId, deleted: false },
    { id: ordinary.assetId, deleted: true }
  ]);
});

test("retained media stays blocked at day 180 and becomes eligible at the exact retention deadline", {
  skip: integrationUrl
    ? false
    : "set TEST_DATABASE_URL through the sealed PostgreSQL preflight runner"
}, async (t) => {
  await assertIsolatedPostgresPreflightEnvironment();
  const client = new pg.Client({ connectionString: integrationUrl });
  const namespace = `retention_media_deadline_${randomBytes(8).toString("hex")}`;
  await client.connect();
  t.after(async () => {
    await client.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
    await client.end();
  });
  await client.query(`CREATE SCHEMA "${namespace}"`);
  await client.query(`SET search_path TO "${namespace}"`);
  await createBaseTables(client);

  const ids = await insertRecordAndAsset(client, "deadline", {
    retentionEndsAt: new Date(Date.now() + 915 * 24 * 60 * 60_000)
  });
  let deleteCalls = 0;
  const service = mediaService(client, async () => {
    deleteCalls += 1;
    return "deleted";
  });

  assert.equal((await service.expireDueAssets()).processed, 0);
  assert.equal(deleteCalls, 0, "day-180 expiry must not outrun the retained-category deadline");
  await client.query(`
    UPDATE "AccountDataRetentionRecord"
    SET "retentionEndsAt" = CURRENT_TIMESTAMP - INTERVAL '1 second'
    WHERE "id" = $1
  `, [ids.recordId]);
  assert.equal((await service.expireDueAssets()).expired, 1);
  assert.equal(deleteCalls, 1, "the same asset becomes eligible at the exact retained deadline");
});

test("a large ordinary-media backlog mutates only one bounded batch per run", {
  skip: integrationUrl
    ? false
    : "set TEST_DATABASE_URL through the sealed PostgreSQL preflight runner"
}, async (t) => {
  await assertIsolatedPostgresPreflightEnvironment();
  const client = new pg.Client({ connectionString: integrationUrl });
  const namespace = `retention_media_backlog_${randomBytes(8).toString("hex")}`;
  await client.connect();
  t.after(async () => {
    await client.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
    await client.end();
  });
  await client.query(`CREATE SCHEMA "${namespace}"`);
  await client.query(`SET search_path TO "${namespace}"`);
  await createBaseTables(client);
  for (let index = 0; index < 45; index += 1) {
    const id = `ordinary-${String(index).padStart(3, "0")}`;
    await client.query(`
      INSERT INTO "MediaAsset" (
        "id", "uploaderId", "purpose", "storageKey", "kind", "mimeType",
        "sizeBytes", "sha256", "status", "expiresAt"
      ) VALUES ($1, 'ordinary-user', 'chatMessage', $2, 'image', 'image/jpeg',
        12, $3, 'approved', CURRENT_TIMESTAMP - INTERVAL '1 minute')
    `, [id, `storage/${id}`, "f".repeat(64)]);
  }
  const service = mediaService(client, async () => "deleted");

  const first = await service.expireDueAssets();
  assert.deepEqual(
    { processed: first.processed, expired: first.expired, hasMore: first.hasMore },
    { processed: 20, expired: 20, hasMore: true }
  );
  assert.equal(Number((await client.query(`
    SELECT COUNT(*)::INTEGER AS count FROM "MediaAsset" WHERE "storageDeletedAt" IS NULL
  `)).rows[0].count), 25);
});

test("an ambiguous provider failure persists a legal-hold barrier until a definitive outcome", {
  skip: integrationUrl
    ? false
    : "set TEST_DATABASE_URL through the sealed PostgreSQL preflight runner"
}, async (t) => {
  await assertIsolatedPostgresPreflightEnvironment();
  const client = new pg.Client({ connectionString: integrationUrl });
  const namespace = `retention_media_unknown_${randomBytes(8).toString("hex")}`;
  await client.connect();
  t.after(async () => {
    await client.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
    await client.end();
  });
  await client.query(`CREATE SCHEMA "${namespace}"`);
  await client.query(`SET search_path TO "${namespace}"`);
  await client.query("SET statement_timeout TO '5s'");
  await createBaseTables(client);
  const ids = await insertRecordAndAsset(client, "outcome-unknown", { bound: false });
  await client.query(`
    INSERT INTO "MediaAsset" (
      "id", "uploaderId", "purpose", "storageKey", "kind", "mimeType",
      "sizeBytes", "sha256", "status", "expiresAt",
      "storageDeleteRequestedAt", "storageDeleteOutcomeUnknownAt"
    ) VALUES (
      'asset-preexisting-unknown', 'user-target', 'chatMessage',
      'storage/asset-preexisting-unknown', 'image', 'image/jpeg', 12,
      $1, 'approved', CURRENT_TIMESTAMP + INTERVAL '1 day',
      CURRENT_TIMESTAMP - INTERVAL '1 minute', CURRENT_TIMESTAMP
    )
  `, ["e".repeat(64)]);
  await assert.rejects(
    client.query(`
      INSERT INTO "AccountDataRetentionLegalHoldAction" (
        "id", "retentionRecordId", "action", "status"
      ) VALUES ('preexisting-unknown-placement', $1, 'placement', 'pending')
    `, [ids.recordId]),
    (error) => error?.code === "55000"
  );
  await client.query(`DELETE FROM "MediaAsset" WHERE "id" = 'asset-preexisting-unknown'`);
  const service = mediaService(client, async () => {
    throw new Error("provider connection reset after request write");
  });
  const run = await service.expireDueAssets();
  assert.equal(run.failed, 1);
  const state = await client.query(`
    SELECT
      asset."storageDeleteLeaseToken",
      asset."storageDeleteOutcomeUnknownAt" IS NOT NULL AS unknown,
      record."mediaDeletionClaimedAt" IS NOT NULL AS claimed
    FROM "MediaAsset" asset
    JOIN "AccountDataRetentionRecord" record
      ON record."id" = asset."retentionExpiryRecordId"
    WHERE asset."id" = $1
  `, [ids.assetId]);
  assert.deepEqual(state.rows[0], {
    storageDeleteLeaseToken: null,
    unknown: true,
    claimed: true
  });
  await assert.rejects(
    client.query(`
      INSERT INTO "AccountDataRetentionLegalHoldAction" (
        "id", "retentionRecordId", "action", "status"
      ) VALUES ('unknown-placement', $1, 'placement', 'pending')
    `, [ids.recordId]),
    (error) => error?.code === "55000"
  );
});

test("migration backfills historical retention media bindings and an irreversible claim marker", {
  skip: integrationUrl
    ? false
    : "set TEST_DATABASE_URL through the sealed PostgreSQL preflight runner"
}, async (t) => {
  await assertIsolatedPostgresPreflightEnvironment();
  const client = new pg.Client({ connectionString: integrationUrl });
  const namespace = `retention_media_backfill_${randomBytes(8).toString("hex")}`;
  await client.connect();
  t.after(async () => {
    await client.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
    await client.end();
  });
  await client.query(`CREATE SCHEMA "${namespace}"`);
  await client.query(`SET search_path TO "${namespace}"`);
  await createBaseTables(client, { applyMigration: false });
  await client.query(`
    INSERT INTO "AccountDataRetentionRecord" (
      "id", "userId", "category", "disposition", "createdAt", "updatedAt"
    ) VALUES (
      'record-historical', 'user-historical', 'support_disputes_safety',
      'retainedRestricted', CURRENT_TIMESTAMP - INTERVAL '1 day', CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    INSERT INTO "MediaAsset" (
      "id", "uploaderId", "purpose", "storageKey", "kind", "mimeType",
      "sizeBytes", "sha256", "status", "expiresAt",
      "storageDeleteRequestedAt", "storageDeleteLeaseToken",
      "storageDeleteLeaseExpiresAt", "storageDeleteAttemptCount"
    ) VALUES (
      'asset-historical', 'user-historical', 'chatMessage',
      'storage/asset-historical', 'image', 'image/jpeg', 12,
      $1, 'approved', CURRENT_TIMESTAMP - INTERVAL '1 hour',
      CURRENT_TIMESTAMP - INTERVAL '5 minutes', 'historical-lease',
      CURRENT_TIMESTAMP + INTERVAL '1 minute', 1
    )
  `, ["c".repeat(64)]);
  await client.query(await barrierMigrationSource());
  const state = await client.query(`
    SELECT
      asset."retentionExpiryRecordId",
      record."mediaDeletionClaimedAt" IS NOT NULL AS claimed
    FROM "MediaAsset" AS asset
    JOIN "AccountDataRetentionRecord" AS record
      ON record."id" = asset."retentionExpiryRecordId"
    WHERE asset."id" = 'asset-historical'
  `);
  assert.deepEqual(state.rows[0], {
    retentionExpiryRecordId: "record-historical",
    claimed: true
  });
});

test("migration refuses to certify an existing hold whose media deletion already started", {
  skip: integrationUrl
    ? false
    : "set TEST_DATABASE_URL through the sealed PostgreSQL preflight runner"
}, async (t) => {
  await assertIsolatedPostgresPreflightEnvironment();
  const client = new pg.Client({ connectionString: integrationUrl });
  const namespace = `retention_media_compromised_${randomBytes(8).toString("hex")}`;
  await client.connect();
  t.after(async () => {
    await client.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
    await client.end();
  });
  await client.query(`CREATE SCHEMA "${namespace}"`);
  await client.query(`SET search_path TO "${namespace}"`);
  await createBaseTables(client, { applyMigration: false });
  await client.query(`
    INSERT INTO "AccountDataRetentionRecord" (
      "id", "userId", "category", "disposition", "createdAt", "updatedAt"
    ) VALUES (
      'record-compromised', 'user-compromised', 'support_disputes_safety',
      'retainedRestricted', CURRENT_TIMESTAMP - INTERVAL '1 day', CURRENT_TIMESTAMP
    );
    INSERT INTO "AccountDataRetentionLegalHoldAction" (
      "id", "retentionRecordId", "action", "status"
    ) VALUES ('hold-compromised', 'record-compromised', 'placement', 'pending');
    INSERT INTO "MediaAsset" (
      "id", "uploaderId", "purpose", "storageKey", "kind", "mimeType",
      "sizeBytes", "sha256", "status", "expiresAt",
      "storageDeleteRequestedAt", "storageDeleteLeaseToken",
      "storageDeleteLeaseExpiresAt", "storageDeleteAttemptCount"
    ) VALUES (
      'asset-compromised', 'user-compromised', 'chatMessage',
      'storage/asset-compromised', 'image', 'image/jpeg', 12,
      '${"d".repeat(64)}', 'approved', CURRENT_TIMESTAMP - INTERVAL '1 hour',
      CURRENT_TIMESTAMP - INTERVAL '5 minutes', 'compromised-lease',
      CURRENT_TIMESTAMP + INTERVAL '1 minute', 1
    )
  `);
  await assert.rejects(
    client.query(await barrierMigrationSource()),
    (error) => error?.code === "55000"
      && /existing legal hold intersects/.test(String(error?.message ?? ""))
  );
});
