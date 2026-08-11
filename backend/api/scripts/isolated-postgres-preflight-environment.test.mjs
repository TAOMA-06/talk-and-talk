import assert from "node:assert/strict";
import test from "node:test";

import {
  POSTGRES_PREFLIGHT_DATABASE_KEYS,
  POSTGRES_PREFLIGHT_SUITE,
} from "./isolated-postgres-preflight-environment.mjs";

test("PostgreSQL preflight declares every named database alias as a runner-owned input", () => {
  assert.equal(POSTGRES_PREFLIGHT_SUITE, "postgres-preflight");
  assert.deepEqual(POSTGRES_PREFLIGHT_DATABASE_KEYS, [
    "ISOLATED_POSTGRES_PREFLIGHT_DATABASE_URL",
    "STAFF_OFFBOARDING_TEST_DATABASE_URL",
    "NOTIFICATION_DELIVERY_CLAIM_TEST_DATABASE_URL",
    "FINANCE_MIGRATION_TEST_DATABASE_URL",
    "AVAILABILITY_CAPACITY_TEST_DATABASE_URL",
    "ACCOUNT_DELETION_TEST_DATABASE_URL",
    "ACCOUNT_DELETION_AUTH_TOMBSTONE_TEST_DATABASE_URL",
    "REFUND_POLICY_MIGRATION_TEST_DATABASE_URL",
    "TEST_DATABASE_URL"
  ]);
});
