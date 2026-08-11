import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const apiRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const readme = readFileSync(resolve(apiRoot, "README.md"), "utf8");

test("README keeps PostgreSQL preflight behind the sealed candidate runner", () => {
  assert.doesNotMatch(readme, /REFUND_POLICY_MIGRATION_TEST_DATABASE_URL=postgresql:\/\//);
  assert.doesNotMatch(readme, /FINANCE_MIGRATION_TEST_DATABASE_URL=postgresql:\/\//);
  assert.match(readme, /sealed disposable runner with `E2E_RUNNER_SUITE=postgres-preflight`/);
  assert.match(readme, /protected candidate-CI `api-preflight-postgres` job invokes only/);
  assert.match(readme, /`backend\/api\/scripts\/run-isolated-e2e\.sh`/);
  assert.match(readme, /standalone `node --test[\s\S]*?` command is static-only/);
  assert.match(readme, /FINANCE_MIGRATION_TEST_DATABASE_URL` alone is not\s+runtime evidence/);
});

test("README documents the candidate-bound schema-v2 E2E receipt", () => {
  assert.match(readme, /E2E_CANDIDATE_SHA/);
  assert.match(readme, /E2E_CANDIDATE_SOURCE_TREE_SHA256/);
  assert.match(readme, /E2E_ENVIRONMENT_APPROVAL_REFERENCE/);
  assert.match(readme, /schema-v2 receipt records `candidate\.sha`, `candidate\.sourceTreeSha256`,/);
  assert.match(readme, /`authorization\.approvalReference`, and `authorization\.executionEvidence`/);
});
