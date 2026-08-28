import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { assertDisposableE2eEnvironment } = require("./assert-disposable-e2e-environment.cjs");

function safeEnvironment(overrides = {}) {
  return {
    NODE_ENV: "test",
    E2E_DATABASE_RESET_ALLOWED: "1",
    E2E_EXECUTION_AUTHORIZATION_EVIDENCE: "E2E-LOCAL-TEST-20260809",
    E2E_REDIS_FLUSH_ALLOWED: "1",
    E2E_ENVIRONMENT_ISSUER: "local-runner",
    E2E_RUN_ID: "0123456789abcdef",
    E2E_OWNERSHIP_TOKEN: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    DATABASE_URL: "postgresql://talk:talk@127.0.0.1:55432/talk_and_talk_0123456789abcdef_e2e",
    REDIS_URL: "redis://127.0.0.1:56379/15",
    E2E_REDIS_OWNERSHIP_URL: "redis://127.0.0.1:56379/14",
    ...overrides
  };
}

test("accepts an explicitly authorized dedicated loopback environment", () => {
  assert.deepEqual(assertDisposableE2eEnvironment(safeEnvironment()), {
    databaseName: "talk_and_talk_0123456789abcdef_e2e",
    databaseUrl: "postgresql://talk:talk@127.0.0.1:55432/talk_and_talk_0123456789abcdef_e2e",
    databaseIdentity: "postgresql://127.0.0.1:55432/talk_and_talk_0123456789abcdef_e2e",
    executionAuthorizationEvidence: "E2E-LOCAL-TEST-20260809",
    issuer: "local-runner",
    redisDatabase: 15,
    redisLeaseKey: "talk-and-talk:e2e:lease:0123456789abcdef",
    redisIdentity: "redis://127.0.0.1:56379",
    redisOwnershipUrl: "redis://127.0.0.1:56379/14",
    redisUrl: "redis://127.0.0.1:56379/15",
    runId: "0123456789abcdef",
    ownershipTokenHash: "a8ae6e6ee929abea3afcfc5258c8ccd6f85273e0d4626d26c7279f3250f77c8e"
  });
});

test("refuses a missing or noncanonical E2E execution record before target parsing", () => {
  for (const evidence of [undefined, "approval-123", "E2E local spaces"]) {
    assert.throws(
      () => assertDisposableE2eEnvironment(safeEnvironment({ E2E_EXECUTION_AUTHORIZATION_EVIDENCE: evidence })),
      /E2E_EXECUTION_AUTHORIZATION_EVIDENCE/
    );
  }
});

test("refuses PostgreSQL reset without explicit authorization", () => {
  const environment = safeEnvironment({ E2E_DATABASE_RESET_ALLOWED: undefined });
  assert.throws(
    () => assertDisposableE2eEnvironment(environment),
    /E2E_DATABASE_RESET_ALLOWED=1/
  );
});

test("refuses a shared PostgreSQL database name", () => {
  assert.throws(
    () => assertDisposableE2eEnvironment(safeEnvironment({
      DATABASE_URL: "postgresql://talk:talk@127.0.0.1:55432/talk_and_talk"
    })),
    /must end in _e2e/
  );
});

test("refuses a local database that is not exactly bound to this run id", () => {
  assert.throws(
    () => assertDisposableE2eEnvironment(safeEnvironment({
      DATABASE_URL: "postgresql://talk:talk@127.0.0.1:55432/shared_e2e"
    })),
    /exactly bind to E2E_RUN_ID/
  );
});

test("refuses a missing per-run ownership token", () => {
  assert.throws(
    () => assertDisposableE2eEnvironment(safeEnvironment({ E2E_OWNERSHIP_TOKEN: undefined })),
    /E2E_OWNERSHIP_TOKEN/
  );
});

test("refuses a remote PostgreSQL host before any cleanup can begin", () => {
  assert.throws(
    () => assertDisposableE2eEnvironment(safeEnvironment({
      DATABASE_URL: "postgresql://talk:talk@db.example.test:5432/talk_and_talk_e2e"
    })),
    /loopback host/
  );
});

test("refuses PostgreSQL URL parameters that can override the checked endpoint", () => {
  assert.throws(
    () => assertDisposableE2eEnvironment(safeEnvironment({
      DATABASE_URL: "postgresql://talk:talk@127.0.0.1:55432/talk_and_talk_e2e?host=db.example.test&port=5432"
    })),
    /must not contain query parameters or a fragment/
  );
});

test("refuses Redis database zero", () => {
  assert.throws(
    () => assertDisposableE2eEnvironment(safeEnvironment({ REDIS_URL: "redis://127.0.0.1:56379/0" })),
    /dedicated database index from 1 to 15/
  );
});

test("refuses a Redis ownership marker on a different transport or database", () => {
  assert.throws(
    () => assertDisposableE2eEnvironment(safeEnvironment({
      E2E_REDIS_OWNERSHIP_URL: "redis://127.0.0.1:56379/13"
    })),
    /ownership marker must use the same transport on dedicated database index 14/
  );
});

test("refuses Redis URL parameters that can select a Unix socket", () => {
  assert.throws(
    () => assertDisposableE2eEnvironment(safeEnvironment({
      REDIS_URL: "redis://127.0.0.1:56379/15?path=/tmp/redis.sock"
    })),
    /must not contain query parameters or a fragment/
  );
});

test("refuses Redis flush without explicit authorization", () => {
  const environment = safeEnvironment({ E2E_REDIS_FLUSH_ALLOWED: undefined });
  assert.throws(
    () => assertDisposableE2eEnvironment(environment),
    /E2E_REDIS_FLUSH_ALLOWED=1/
  );
});
