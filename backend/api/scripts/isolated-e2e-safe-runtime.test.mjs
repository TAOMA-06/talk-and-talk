import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  assertIsolatedE2eSafeRuntime,
  ISOLATED_E2E_SAFETY_OVERRIDES
} = require("./isolated-e2e-safe-runtime.cjs");

const apiDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("sealed E2E runtime rejects hostile provider and worker configuration", () => {
  assert.doesNotThrow(() => assertIsolatedE2eSafeRuntime(ISOLATED_E2E_SAFETY_OVERRIDES));
  assert.throws(
    () => assertIsolatedE2eSafeRuntime({
      ...ISOLATED_E2E_SAFETY_OVERRIDES,
      NOTIFICATION_DELIVERY_ENABLED: "true",
      WECHAT_PAY_PRIVATE_KEY: "hostile-test-value"
    }),
    /NOTIFICATION_DELIVERY_ENABLED, WECHAT_PAY_PRIVATE_KEY/
  );
});

test("test-mode Nest configuration never loads backend/api/.env", () => {
  const appModule = readFileSync(resolve(apiDirectory, "src/app.module.ts"), "utf8");
  assert.match(appModule, /ignoreEnvFile:\s*process\.env\.NODE_ENV\s*===\s*"test"/);
});
