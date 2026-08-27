import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
    "ACCOUNT_DATA_RETENTION_LEGAL_HOLD_TEST_DATABASE_URL",
    "CONTROLLED_ACCOUNT_APPEAL_EVIDENCE_TEST_DATABASE_URL",
    "RETENTION_EXPIRY_GRAPH_TEST_DATABASE_URL",
    "RETENTION_MEDIA_LEGAL_HOLD_TEST_DATABASE_URL",
    "RETENTION_GRAPH_TEST_DATABASE_URL",
    "AUDIT_SUBJECT_POLICY_V3_TEST_DATABASE_URL",
    "COMPANION_INCIDENT_ASSIGNMENT_TEST_DATABASE_URL",
    "TEST_DATABASE_URL"
  ]);
});

test("blank sealed shadow database input is omitted from Prisma configuration", async () => {
  const source = await readFile("prisma.config.ts", "utf8");
  assert.match(source, /SHADOW_DATABASE_URL.*\.trim\(\)/);
  assert.match(source, /shadowDatabaseUrl \? \{ shadowDatabaseUrl \} : \{\}/);
  assert.doesNotMatch(source, /shadowDatabaseUrl:\s*process\.env/);
});

test("PostgreSQL probes serialize independent schema fixtures while each probe tests its own concurrency", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  assert.match(manifest.scripts["test:preflight:postgres"], /--node-test --test-concurrency=1/);
});

test("every registered PostgreSQL probe re-verifies sealed ownership in its own process", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const command = manifest.scripts["test:preflight:postgres"];
  const probeScripts = [...new Set(
    [...command.matchAll(/scripts\/[A-Za-z0-9._-]+\.test\.mjs/g)].map(([path]) => path)
  )];
  assert.ok(probeScripts.length > 0, "the PostgreSQL preflight must register probe scripts");

  for (const scriptPath of probeScripts) {
    const source = await readFile(scriptPath, "utf8");
    assert.match(
      source,
      /import[\s\S]*?assertIsolatedPostgresPreflightEnvironment[\s\S]*?from "\.\/isolated-postgres-preflight-environment\.mjs"/,
      `${scriptPath} must import the sealed in-process admission guard`
    );
    assert.match(
      source,
      /assertIsolatedPostgresPreflightEnvironment\(\)/,
      `${scriptPath} must invoke the sealed in-process admission guard`
    );

    const databaseTestBodies = source.split(/\btest\s*\(/).slice(1).filter((body) =>
      ["new pg.Client", ".connect(", "CREATE SCHEMA", "DROP SCHEMA"]
        .some((marker) => body.includes(marker))
    );
    assert.ok(databaseTestBodies.length > 0, `${scriptPath} must contain a registered database test`);
    for (const [index, body] of databaseTestBodies.entries()) {
      const admissionAwait = body.search(
        /await\s+(?:assertIsolatedPostgresPreflightEnvironment\(\)|postgresPreflight\b)/
      );
      const mutationBoundaries = ["new pg.Client", ".connect(", "CREATE SCHEMA", "DROP SCHEMA"]
        .map((marker) => body.indexOf(marker))
        .filter((position) => position >= 0);
      const firstMutationBoundary = Math.min(...mutationBoundaries);
      assert.ok(
        admissionAwait >= 0 && admissionAwait < firstMutationBoundary,
        `${scriptPath} database test ${index + 1} must await sealed ownership before connection or schema mutation`
      );
    }
  }
});

test("PostgreSQL preflight fails when migrated schema drifts from the Prisma model", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(
    manifest.scripts["prisma:assert-schema-sync"],
    "prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code"
  );
  const preflight = manifest.scripts["test:preflight:postgres"];
  assert.ok(
    preflight.indexOf("isolated-postgres-preflight-environment.mjs")
      < preflight.indexOf("npm run prisma:assert-schema-sync")
  );
  assert.ok(
    preflight.indexOf("npm run prisma:assert-schema-sync")
      < preflight.indexOf("scripts/assert-zero-skips.mjs")
  );
});
