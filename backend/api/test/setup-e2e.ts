import Redis from "ioredis";

// This CommonJS helper is deliberately shared with the local E2E runner and
// native Node tests. It validates both targets before any test cleanup or Redis
// connection can occur.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { assertDisposableE2eEnvironment } = require("../scripts/assert-disposable-e2e-environment.cjs") as {
  assertDisposableE2eEnvironment: (env?: NodeJS.ProcessEnv) => {
    redisUrl: string;
  };
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { assertIsolatedE2eSafeRuntime } = require("../scripts/isolated-e2e-safe-runtime.cjs") as {
  assertIsolatedE2eSafeRuntime: (env?: NodeJS.ProcessEnv) => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { verifyE2eTargetOwnership } = require("../scripts/e2e-target-ownership.cjs") as {
  verifyE2eTargetOwnership: (target: unknown) => Promise<unknown>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createOwnershipGuardedHook } = require("../scripts/e2e-teardown-guard.cjs") as {
  createOwnershipGuardedHook: (
    registerHook: typeof afterAll,
    verifyOwnership: () => Promise<unknown>
  ) => typeof afterAll;
};

assertIsolatedE2eSafeRuntime();
const isolatedEnvironment = assertDisposableE2eEnvironment();

async function clearDedicatedE2eRedis() {
  await verifyE2eTargetOwnership(isolatedEnvironment);
  const redis = new Redis(isolatedEnvironment.redisUrl, {
    connectTimeout: 1_000,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    enableOfflineQueue: false
  });
  redis.on("error", () => undefined);

  try {
    await redis.connect();
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }
}

/** Clear both stale state from a previously interrupted run and state produced by each test. */
async function verifyOwnershipBeforeCleanup() {
  await verifyE2eTargetOwnership(isolatedEnvironment);
}

// setupFilesAfterEnv loads before each E2E spec is evaluated. Register the
// wrappers now, so suite-local setup or cleanup cannot execute after a marker
// has expired or been replaced following a root lifecycle hook.
const originalBeforeAll = beforeAll;
const originalBeforeEach = beforeEach;
const originalAfterEach = afterEach;
const originalAfterAll = afterAll;
globalThis.beforeAll = createOwnershipGuardedHook(originalBeforeAll, verifyOwnershipBeforeCleanup);
globalThis.beforeEach = createOwnershipGuardedHook(originalBeforeEach, verifyOwnershipBeforeCleanup);
globalThis.afterEach = createOwnershipGuardedHook(originalAfterEach, verifyOwnershipBeforeCleanup);
globalThis.afterAll = createOwnershipGuardedHook(originalAfterAll, verifyOwnershipBeforeCleanup);

// setupFilesAfterEnv runs before every E2E spec is evaluated, so these hooks
// precede any suite-level deleteMany/flush operation. The ownership marker is
// deliberately in Redis DB 14 while test data is in DB 15, so a test flush
// cannot erase the proof required by the next test.
beforeAll(verifyOwnershipBeforeCleanup);
beforeEach(clearDedicatedE2eRedis);
afterEach(clearDedicatedE2eRedis);
