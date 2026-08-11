import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  claimE2eTargetOwnership,
  ownershipMatches,
  ownershipRecord,
  verifyE2eTargetOwnership
} = require("./e2e-target-ownership.cjs");
const { assertDisposableE2eEnvironment } = require("./assert-disposable-e2e-environment.cjs");

const issuedAt = new Date("2026-08-09T00:00:00.000Z");
const targetEnvironment = {
  NODE_ENV: "test",
  E2E_DATABASE_RESET_ALLOWED: "1",
  E2E_EXECUTION_AUTHORIZATION_EVIDENCE: "E2E-LOCAL-TEST-20260809",
  E2E_ENVIRONMENT_ISSUER: "local-runner",
  E2E_OWNERSHIP_TOKEN: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  E2E_REDIS_FLUSH_ALLOWED: "1",
  E2E_RUN_ID: "0123456789abcdef",
  DATABASE_URL: "postgresql://talk:talk@127.0.0.1:55432/talk_and_talk_0123456789abcdef_e2e",
  REDIS_URL: "redis://127.0.0.1:56379/15",
  E2E_REDIS_OWNERSHIP_URL: "redis://127.0.0.1:56379/14"
};
const target = assertDisposableE2eEnvironment(targetEnvironment);

function pgClient({ objects = [], ownership = [] } = {}) {
  const calls = [];
  return {
    calls,
    async connect() {},
    async end() {},
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("FROM pg_catalog.pg_class")) return { rows: objects };
      if (sql.includes(`FROM "_talktalk_e2e_control"."ownership"`)) return { rows: ownership };
      return { rows: [] };
    }
  };
}

function redisClient({ claim = "OK", value = null, dbsize = 0 } = {}) {
  const calls = [];
  return {
    calls,
    async connect() {},
    async dbsize() {
      calls.push("dbsize");
      return dbsize;
    },
    async disconnect() {},
    async get() {
      calls.push("get");
      return value;
    },
    async quit() {},
    async set() {
      calls.push("set");
      return claim;
    }
  };
}

function sequentialFactory(...clients) {
  let index = 0;
  return () => clients[index++] ?? clients.at(-1);
}

test("ownership records bind both resource identities and expire", () => {
  const record = ownershipRecord(target, issuedAt);
  assert.equal(ownershipMatches(record, target, issuedAt), true);
  assert.equal(ownershipMatches(record, { ...target, redisIdentity: "redis://127.0.0.1:6379" }, issuedAt), false);
  assert.equal(ownershipMatches(record, target, new Date("2026-08-09T02:00:00.000Z")), false);
});

test("claim rejects existing PostgreSQL markers without inserting", async () => {
  const preflight = pgClient();
  const claim = pgClient({ ownership: [{ runId: "other-run" }] });
  await assert.rejects(
    () => claimE2eTargetOwnership(targetEnvironment, {
      createPgClient: sequentialFactory(preflight, claim),
      createRedisDataClient: () => redisClient()
    }),
    /Refusing to claim an existing E2E PostgreSQL ownership marker/
  );
  assert.equal(claim.calls.some((call) => call.sql.includes("INSERT INTO")), false);
  assert.equal(claim.calls.some((call) => call.sql === "ROLLBACK"), true);
});

test("claim refuses a missing execution record before opening PostgreSQL or Redis", async () => {
  let postgresCreated = 0;
  let redisCreated = 0;
  await assert.rejects(
    () => claimE2eTargetOwnership({ ...targetEnvironment, E2E_EXECUTION_AUTHORIZATION_EVIDENCE: undefined }, {
      createPgClient: () => {
        postgresCreated += 1;
        return pgClient();
      },
      createRedisDataClient: () => {
        redisCreated += 1;
        return redisClient();
      }
    }),
    /E2E_EXECUTION_AUTHORIZATION_EVIDENCE/
  );
  assert.equal(postgresCreated, 0);
  assert.equal(redisCreated, 0);
});

test("claim refuses a forged remote or non-dedicated target before constructing clients", async () => {
  for (const environment of [
    { ...targetEnvironment, DATABASE_URL: "postgresql://talk:talk@db.example.test:5432/talk_and_talk_0123456789abcdef_e2e" },
    { ...targetEnvironment, REDIS_URL: "redis://127.0.0.1:56379/0" }
  ]) {
    let postgresCreated = 0;
    let redisCreated = 0;
    await assert.rejects(
      () => claimE2eTargetOwnership(environment, {
        createPgClient: () => {
          postgresCreated += 1;
          return pgClient();
        },
        createRedisDataClient: () => {
          redisCreated += 1;
          return redisClient();
        }
      }),
      /loopback host|dedicated database index/
    );
    assert.equal(postgresCreated, 0);
    assert.equal(redisCreated, 0);
  }
});

test("claim rejects an existing Redis marker after both targets pass fresh-target preflight", async () => {
  await assert.rejects(
    () => claimE2eTargetOwnership(targetEnvironment, {
      createPgClient: sequentialFactory(pgClient(), pgClient()),
      createRedisDataClient: () => redisClient(),
      createRedisClient: () => redisClient({ claim: null })
    }),
    /Refusing to claim an existing E2E Redis ownership marker/
  );
});

test("claim rejects a non-empty PostgreSQL target before creating an ownership marker", async () => {
  const preflight = pgClient({ objects: [{ schemaName: "public", objectName: "users", objectKind: "r" }] });
  await assert.rejects(
    () => claimE2eTargetOwnership(targetEnvironment, {
      createPgClient: () => preflight,
      createRedisDataClient: () => redisClient()
    }),
    /Refusing to claim a non-empty E2E PostgreSQL database/
  );
  assert.equal(preflight.calls.some((call) => call.sql.includes("CREATE SCHEMA")), false);
  assert.equal(preflight.calls.some((call) => call.sql.includes("INSERT INTO")), false);
});

test("claim rejects a non-empty Redis test database before creating either marker", async () => {
  const preflight = pgClient();
  const redisData = redisClient({ dbsize: 1 });
  await assert.rejects(
    () => claimE2eTargetOwnership(targetEnvironment, {
      createPgClient: () => preflight,
      createRedisDataClient: () => redisData
    }),
    /Refusing to claim a non-empty E2E Redis test database/
  );
  assert.equal(preflight.calls.some((call) => call.sql.includes("CREATE SCHEMA")), false);
  assert.equal(preflight.calls.some((call) => call.sql.includes("INSERT INTO")), false);
  assert.deepEqual(redisData.calls, ["dbsize"], "the empty-data check must not write a Redis marker");
});

test("verification requires matching PostgreSQL and Redis markers", async () => {
  const record = ownershipRecord(target, issuedAt);
  const result = await verifyE2eTargetOwnership(target, {
    createPgClient: () => pgClient({ ownership: [record] }),
    createRedisClient: () => redisClient({ value: JSON.stringify(record) }),
    now: () => issuedAt
  });
  assert.equal(result.databaseRecord.runId, target.runId);

  await assert.rejects(
    () => verifyE2eTargetOwnership(target, {
      createPgClient: () => pgClient({ ownership: [record] }),
      createRedisClient: () => redisClient({ value: JSON.stringify({ ...record, tokenHash: "b".repeat(64) }) }),
      now: () => issuedAt
    }),
    /ownership is missing, expired, or does not match this run/
  );
});
