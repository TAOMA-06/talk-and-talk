import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const workflowPath = resolve(repositoryRoot, ".github/workflows/api.yml");

function workflow() {
  return readFileSync(workflowPath, "utf8");
}

test("ordinary API workflow is Git-metadata hygiene, never a candidate-code executor", () => {
  const source = workflow();
  assert.match(source, /^name: API metadata hygiene \(untrusted\)$/m);
  assert.match(source, /^permissions:\n  contents: read$/m);
  assert.match(source, /actions\/checkout@[0-9a-f]{40}/);
  for (const required of [
    "fetch-depth: 1",
    "lfs: false",
    "persist-credentials: false",
    "submodules: false",
    "export PATH=/usr/bin:/bin",
    "export GITHUB_ENV=/dev/null GITHUB_OUTPUT=/dev/null GITHUB_PATH=/dev/null GITHUB_STEP_SUMMARY=/dev/null",
    "readonly PATH GITHUB_ENV GITHUB_OUTPUT GITHUB_PATH GITHUB_STEP_SUMMARY",
    "/usr/bin/git -c core.hooksPath=/dev/null -c core.fsmonitor=false rev-parse HEAD",
    "status --porcelain --untracked-files=all",
    "diff --check --no-ext-diff"
  ]) assert.match(source, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `metadata hygiene must retain ${required}`);

  for (const forbidden of [
    /actions\/setup-node@/,
    /\b(?:npm|node|npx|yarn|pnpm|tsc|typescript|prisma)\b/i,
    /\b(?:docker|compose|buildx)\b/i,
    /\b(?:container|services|self-hosted|environment)\s*:/i,
    /\b(?:DATABASE_URL|REDIS_URL|E2E_[A-Z0-9_]+|DOCKER_HOST)\b/,
    /\b(?:secrets|vars)\./,
    /actions\/upload-artifact@/,
    /\bworkflow_dispatch\b/
  ]) assert.doesNotMatch(source, forbidden, `ordinary API hygiene must not contain ${forbidden}`);
});

test("API metadata check uses only fixed Git checks after command-file sealing", () => {
  const source = workflow();
  const checkout = source.indexOf("uses: actions/checkout@");
  const metadata = source.indexOf("Seal command files and verify checked-out metadata", checkout);

  assert.ok(checkout >= 0 && metadata > checkout);
  const metadataStep = source.slice(metadata);
  assert.match(metadataStep, /set -euo pipefail/);
  assert.match(metadataStep, /grep -Fx "\$GITHUB_SHA"/);
  assert.doesNotMatch(metadataStep, /(?:^|\s)(?:npm|node|npx|yarn|pnpm|tsc|prisma)(?:\s|$)/i);
});
