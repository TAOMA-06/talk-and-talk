"use strict";

const { timingSafeEqual } = require("node:crypto");
const { Client } = require("pg");
const Redis = require("ioredis");

const {
  assertDisposableE2eEnvironment,
  E2E_DATABASE_CONTROL_SCHEMA,
  E2E_DATABASE_LEASE_TABLE,
  E2E_LEASE_TTL_MS
} = require("./assert-disposable-e2e-environment.cjs");

const LEASE_ID = 1;
const DATABASE_OBJECTS_QUERY = `
  SELECT namespace.nspname AS "schemaName", relation.relname AS "objectName", relation.relkind AS "objectKind"
  FROM pg_catalog.pg_class AS relation
  INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname NOT LIKE 'pg_%'
    AND namespace.nspname <> 'information_schema'
    AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
  LIMIT 1
`;

function ownershipRecord(target, issuedAt = new Date()) {
  const expiresAt = new Date(issuedAt.getTime() + E2E_LEASE_TTL_MS);
  return {
    runId: target.runId,
    tokenHash: target.ownershipTokenHash,
    databaseIdentity: target.databaseIdentity,
    redisIdentity: target.redisIdentity,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString()
  };
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ""));
  const rightBuffer = Buffer.from(String(right ?? ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function ownershipMatches(record, target, now = new Date()) {
  if (!record || typeof record !== "object") return false;
  const expiresAt = new Date(record.expiresAt);
  return record.runId === target.runId
    && constantTimeEqual(record.tokenHash, target.ownershipTokenHash)
    && record.databaseIdentity === target.databaseIdentity
    && record.redisIdentity === target.redisIdentity
    && Number.isFinite(expiresAt.getTime())
    && expiresAt.getTime() > now.getTime();
}

function defaultPgClient(target) {
  return new Client({ connectionString: target.databaseUrl, connectionTimeoutMillis: 1_000 });
}

function defaultRedisClient(target) {
  return new Redis(target.redisOwnershipUrl, {
    connectTimeout: 1_000,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    enableOfflineQueue: false
  });
}

function defaultRedisDataClient(target) {
  return new Redis(target.redisUrl, {
    connectTimeout: 1_000,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    enableOfflineQueue: false
  });
}

async function closePg(client) {
  try {
    await client.end();
  } catch {
    // The target has already been checked; cleanup must not hide the primary
    // ownership result or leak an implementation-specific connection error.
  }
}

async function closeRedis(redis) {
  try {
    await redis.quit();
  } catch {
    redis.disconnect();
  }
}

async function assertDatabaseTargetEmpty(target, createPgClient = defaultPgClient) {
  const client = createPgClient(target);
  try {
    await client.connect();
    const result = await client.query(DATABASE_OBJECTS_QUERY);
    if (result.rows.length > 0) {
      throw new Error("Refusing to claim a non-empty E2E PostgreSQL database");
    }
  } finally {
    await closePg(client);
  }
}

async function assertRedisTestDatabaseEmpty(target, createRedisDataClient = defaultRedisDataClient) {
  const redis = createRedisDataClient(target);
  try {
    await redis.connect();
    const count = Number(await redis.dbsize());
    if (!Number.isSafeInteger(count) || count !== 0) {
      throw new Error("Refusing to claim a non-empty E2E Redis test database");
    }
  } finally {
    await closeRedis(redis);
  }
}

async function claimDatabaseOwnership(target, record, createPgClient = defaultPgClient) {
  const client = createPgClient(target);
  let transactionOpen = false;
  try {
    await client.connect();
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${E2E_DATABASE_CONTROL_SCHEMA}"`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS "${E2E_DATABASE_CONTROL_SCHEMA}"."${E2E_DATABASE_LEASE_TABLE}" (
        "id" SMALLINT PRIMARY KEY CHECK ("id" = ${LEASE_ID}),
        "runId" TEXT NOT NULL,
        "tokenHash" TEXT NOT NULL,
        "databaseIdentity" TEXT NOT NULL,
        "redisIdentity" TEXT NOT NULL,
        "issuedAt" TIMESTAMPTZ NOT NULL,
        "expiresAt" TIMESTAMPTZ NOT NULL
      )`
    );
    const existing = await client.query(
      `SELECT "runId" FROM "${E2E_DATABASE_CONTROL_SCHEMA}"."${E2E_DATABASE_LEASE_TABLE}"
       WHERE "id" = ${LEASE_ID} FOR UPDATE`
    );
    if (existing.rows.length > 0) {
      throw new Error("Refusing to claim an existing E2E PostgreSQL ownership marker");
    }
    await client.query(
      `INSERT INTO "${E2E_DATABASE_CONTROL_SCHEMA}"."${E2E_DATABASE_LEASE_TABLE}"
       ("id", "runId", "tokenHash", "databaseIdentity", "redisIdentity", "issuedAt", "expiresAt")
       VALUES (${LEASE_ID}, $1, $2, $3, $4, $5, $6)`,
      [
        record.runId,
        record.tokenHash,
        record.databaseIdentity,
        record.redisIdentity,
        record.issuedAt,
        record.expiresAt
      ]
    );
    await client.query("COMMIT");
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the claim failure; the disposable container will be removed
        // by the runner rather than attempting to reuse an uncertain target.
      }
    }
    throw error;
  } finally {
    await closePg(client);
  }
}

async function claimRedisOwnership(target, record, createRedisClient = defaultRedisClient) {
  const redis = createRedisClient(target);
  try {
    await redis.connect();
    const result = await redis.set(
      target.redisLeaseKey,
      JSON.stringify(record),
      "PX",
      E2E_LEASE_TTL_MS,
      "NX"
    );
    if (result !== "OK") {
      throw new Error("Refusing to claim an existing E2E Redis ownership marker");
    }
  } finally {
    await closeRedis(redis);
  }
}

async function readDatabaseOwnership(target, createPgClient = defaultPgClient) {
  const client = createPgClient(target);
  try {
    await client.connect();
    const result = await client.query(
      `SELECT "runId", "tokenHash", "databaseIdentity", "redisIdentity", "issuedAt", "expiresAt"
       FROM "${E2E_DATABASE_CONTROL_SCHEMA}"."${E2E_DATABASE_LEASE_TABLE}"
       WHERE "id" = ${LEASE_ID}`
    );
    return result.rows[0] ?? null;
  } catch {
    return null;
  } finally {
    await closePg(client);
  }
}

async function readRedisOwnership(target, createRedisClient = defaultRedisClient) {
  const redis = createRedisClient(target);
  try {
    await redis.connect();
    const serialized = await redis.get(target.redisLeaseKey);
    if (!serialized) return null;
    try {
      return JSON.parse(serialized);
    } catch {
      return null;
    }
  } catch {
    return null;
  } finally {
    await closeRedis(redis);
  }
}

async function claimE2eTargetOwnership(environment, options = {}) {
  // Claim is a destructive entrypoint. It accepts raw environment rather than
  // a caller-constructed target so the complete loopback/run-id/Redis/record
  // invariant is always re-established before either client is created.
  const verifiedTarget = assertDisposableE2eEnvironment(environment);
  // A random-looking name/token is not ownership proof: a user can construct
  // both for an old loopback target. Refuse before creating either marker
  // unless the actual test data resources are fresh and empty.
  await assertDatabaseTargetEmpty(verifiedTarget, options.createPgClient);
  await assertRedisTestDatabaseEmpty(verifiedTarget, options.createRedisDataClient);
  const record = ownershipRecord(verifiedTarget, options.now?.() ?? new Date());
  await claimDatabaseOwnership(verifiedTarget, record, options.createPgClient);
  await claimRedisOwnership(verifiedTarget, record, options.createRedisClient);
  return record;
}

async function verifyE2eTargetOwnership(target, options = {}) {
  const [databaseRecord, redisRecord] = await Promise.all([
    readDatabaseOwnership(target, options.createPgClient),
    readRedisOwnership(target, options.createRedisClient)
  ]);
  const now = options.now?.() ?? new Date();
  if (!ownershipMatches(databaseRecord, target, now) || !ownershipMatches(redisRecord, target, now)) {
    throw new Error("E2E target ownership is missing, expired, or does not match this run");
  }
  return { databaseRecord, redisRecord };
}

module.exports = {
  claimE2eTargetOwnership,
  assertDatabaseTargetEmpty,
  assertRedisTestDatabaseEmpty,
  ownershipMatches,
  ownershipRecord,
  readDatabaseOwnership,
  readRedisOwnership,
  verifyE2eTargetOwnership
};

if (require.main === module) {
  const action = process.argv[2];
  Promise.resolve().then(async () => {
    if (action === "claim") {
      await claimE2eTargetOwnership(process.env);
      return "claimed";
    }
    if (action === "verify") {
      const target = assertDisposableE2eEnvironment();
      await verifyE2eTargetOwnership(target);
      return "verified";
    }
    throw new Error("Expected E2E ownership action: claim or verify");
  }).then((result) => {
    console.info(`E2E target ownership ${result}`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "E2E target ownership operation failed");
    process.exitCode = 1;
  });
}
