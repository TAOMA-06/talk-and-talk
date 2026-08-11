/**
 * Fail-closed runtime admission for the PostgreSQL-only preflight probes.
 *
 * These probes exercise migrations, locks, and indexes against a real
 * database. They are deliberately not a normal static preflight: execution is
 * allowed only after the sealed isolated-E2E runner has created, claimed, and
 * re-verified its disposable target.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { assertDisposableE2eEnvironment } = require("./assert-disposable-e2e-environment.cjs");
const { verifyE2eTargetOwnership } = require("./e2e-target-ownership.cjs");

export const POSTGRES_PREFLIGHT_SUITE = "postgres-preflight";
export const POSTGRES_PREFLIGHT_DATABASE_KEYS = Object.freeze([
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

function fail(message) {
  throw new Error(`PostgreSQL preflight requires the sealed isolated E2E runner: ${message}`);
}

function canonicalUrl(value, key) {
  const raw = String(value ?? "").trim();
  if (!raw) fail(`${key} is required`);
  try {
    return new URL(raw).toString();
  } catch {
    fail(`${key} must be a valid PostgreSQL URL`);
  }
}

let verifiedEnvironment = null;

/**
 * Returns a shared promise so all seven Node test modules verify the same
 * ownership record without racing one another or opening independent trust
 * paths. No test body may create a schema until this promise resolves.
 */
export function assertIsolatedPostgresPreflightEnvironment(environment = process.env) {
  if (verifiedEnvironment) return verifiedEnvironment;
  verifiedEnvironment = Promise.resolve().then(async () => {
    if (String(environment.E2E_RUNNER_SUITE ?? "").trim() !== POSTGRES_PREFLIGHT_SUITE) {
      fail(`E2E_RUNNER_SUITE must be ${POSTGRES_PREFLIGHT_SUITE}`);
    }
    const target = assertDisposableE2eEnvironment(environment);
    const databaseUrl = canonicalUrl(target.databaseUrl, "DATABASE_URL");
    for (const key of POSTGRES_PREFLIGHT_DATABASE_KEYS) {
      if (canonicalUrl(environment[key], key) !== databaseUrl) {
        fail(`${key} must exactly match the verified DATABASE_URL`);
      }
    }
    await verifyE2eTargetOwnership(target);
    return Object.freeze({ databaseUrl, target });
  });
  return verifiedEnvironment;
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  try {
    await assertIsolatedPostgresPreflightEnvironment();
    console.info("Isolated PostgreSQL preflight environment accepted");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Isolated PostgreSQL preflight environment rejected");
    process.exitCode = 1;
  }
}
