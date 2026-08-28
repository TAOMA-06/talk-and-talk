import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createOwnershipGuardedHook } = require("./e2e-teardown-guard.cjs");

test("a lost ownership marker prevents every registered spec lifecycle body from running", async () => {
  for (const hookName of ["beforeAll", "beforeEach", "afterEach", "afterAll"]) {
    let registered;
    let bodyRan = false;
    const hook = createOwnershipGuardedHook(
      (callback) => {
        registered = callback;
      },
      async () => {
        throw new Error("ownership marker expired");
      }
    );

    hook(async () => {
      bodyRan = true;
    });

    await assert.rejects(() => registered(), /ownership marker expired/, hookName);
    assert.equal(bodyRan, false, hookName);
  }
});

test("callback-style afterAll hooks verify ownership before their body", async () => {
  let registered;
  let cleanupRan = false;
  const afterAll = createOwnershipGuardedHook(
    (callback) => {
      registered = callback;
    },
    async () => undefined
  );

  afterAll((done) => {
    cleanupRan = true;
    done();
  });

  await new Promise((resolve, reject) => registered((error) => error ? reject(error) : resolve()));
  assert.equal(cleanupRan, true);
});
