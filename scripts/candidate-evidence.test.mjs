import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  beginCapture,
  compareEvidenceManifests,
  finalizeCapture,
  generateSbomForFreeze,
  hashCandidateArtifact,
  hashDirectory,
  REQUIRED_GATES,
  runGate,
  SCHEMA_VERSION,
  sha256,
  skippedCount,
  validateEvidenceManifest,
  validateSbom,
} from "./candidate-evidence.mjs";

const script = fileURLToPath(new URL("./candidate-evidence.mjs", import.meta.url));

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function write(root, path, content = "fixture\n") {
  const absolute = join(root, path);
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function fixturePackageLock(name) {
  const integrity = createHash("sha512").update(`${name}:fixture`).digest("base64");
  return `${JSON.stringify({
    name,
    lockfileVersion: 3,
    packages: {
      "": { name, version: "1.0.0", dependencies: { fixture: "1.0.0" } },
      "node_modules/fixture": {
        version: "1.0.0",
        resolved: "https://registry.npmjs.org/fixture/-/fixture-1.0.0.tgz",
        integrity: `sha512-${integrity}`,
      },
    },
  }, null, 2)}\n`;
}

function createFixture({ detach = true, gitlink = false, miniValidateContent, omittedPaths = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "talkandtalk-candidate-fixture-"));
  const omitted = new Set(omittedPaths);
  git(root, "init", "-q");
  git(root, "config", "user.name", "Candidate Fixture");
  git(root, "config", "user.email", "candidate-fixture@example.test");
  write(root, "base.txt", "parent fixture\n");
  git(root, "add", "base.txt");
  git(root, "commit", "-qm", "parent fixture");
  write(root, ".gitignore", [
    "frontend/web/dist/",
    "backend/api/dist/",
    "backend/api/.env",
    "backend/api/generated/prisma/",
  ].join("\n") + "\n");
  const fixtureLocks = {
    "backend/api/package-lock.json": "fixture-api",
    "frontend/miniprogram/package-lock.json": "fixture-mini",
    "frontend/web/package-lock.json": "fixture-web",
  };
  for (const path of [
    "backend/api/package-lock.json",
    "backend/api/package.json",
    "frontend/miniprogram/package-lock.json",
    "frontend/miniprogram/package.json",
    "frontend/web/package-lock.json",
    "frontend/web/package.json",
    "shared/contracts/openapi/v1.yaml",
    "backend/api/prisma/schema.prisma",
    "backend/api/prisma/migrations/001/migration.sql",
    "backend/api/src/config/first-release-capability-matrix.ts",
    "frontend/miniprogram/utils/config.ts",
    "frontend/miniprogram/scripts/validate.mjs",
    "frontend/web/lib/web-surface-policy.ts",
    ".github/workflows/api.yml",
    ".github/workflows/miniprogram.yml",
    ".github/workflows/web.yml",
    ".github/workflows/g1-candidate.yml",
    ".github/workflows/g1-candidate-control-plane.yml",
    "backend/api/Dockerfile",
    "backend/api/scripts/run-isolated-e2e.sh",
    "backend/api/scripts/run-migration-compatibility.mjs",
    "backend/api/scripts/run-migration-compatibility.sh",
    "backend/api/scripts/run-migration-compatibility.test.mjs",
    "infra/docker-compose.e2e.yml",
    "infra/docker-compose.migration-compatibility.yml",
    "scripts/candidate-evidence.mjs",
    "scripts/candidate-evidence.test.mjs",
    "scripts/candidate-input-policy.mjs",
    "scripts/candidate-input-policy.test.mjs",
    "scripts/candidate-source-tree.mjs",
    "scripts/generate-candidate-sbom.mjs",
    "scripts/generate-candidate-sbom.test.mjs",
    "scripts/verify-ci-candidate-identity.mjs",
    "scripts/verify-ci-candidate-identity.test.mjs",
    "scripts/g1-candidate-ci-contract.test.mjs",
    "scripts/g2-browser-evidence-card-contract.mjs",
    "scripts/g2-browser-evidence-card-contract.test.mjs",
    "scripts/oci-builder-custody-contract.mjs",
    "scripts/oci-builder-custody-contract.test.mjs",
    "docs/cto-self-audit/runs/2026-08-08-g1-remediation/candidate-evidence-template.md",
    "docs/cto-self-audit/runs/2026-08-08-g1-remediation/g2-execution-package.md",
    "docs/cto-self-audit/runs/2026-08-08-g1-remediation/external-control-plane-oci-custody-contract.md",
    "frontend/miniprogram/app.json",
    "frontend/miniprogram/project.config.json",
  ]) {
    if (omitted.has(path)) continue;
    write(
      root,
      path,
      fixtureLocks[path]
        ? fixturePackageLock(fixtureLocks[path])
        : path === "frontend/miniprogram/scripts/validate.mjs" && miniValidateContent
          ? miniValidateContent
          : "fixture\n",
    );
  }
  git(root, "add", ".");
  git(root, "commit", "-qm", "fixture");
  if (gitlink) {
    const head = git(root, "rev-parse", "HEAD");
    git(root, "update-index", "--add", "--cacheinfo", `160000,${head},.worktrees/unmapped`);
    git(root, "commit", "-qm", "accidental gitlink");
  }
  if (detach) git(root, "checkout", "--detach", "-q");
  return { root, sha: git(root, "rev-parse", "HEAD") };
}

function writeRequiredArtifacts(root) {
  writeVinextWebArtifacts(root);
  write(root, "backend/api/dist/src/main.js");
  write(root, "backend/api/dist/src/database/seed.js");
  write(root, "backend/api/dist/src/database/bootstrap-staff.js");
  write(root, "backend/api/dist/src/database/bootstrap-review-staff.js");
  write(root, "backend/api/dist/config/transactional-template-manifest.js");
  write(root, "backend/api/generated/prisma/client.ts");
  write(root, "backend/api/generated/prisma/models.ts");
  write(root, "backend/api/generated/prisma/internal/class.ts");
}

function writeVinextWebArtifacts(root, {
  draftSecret = "11111111-1111-4111-8111-111111111111",
  buildId = "22222222-2222-4222-8222-222222222222",
  prerenderSecret = "3".repeat(64),
  runtimeMarker = "runtime-a",
} = {}) {
  write(root, "frontend/web/dist/server/index.js", [
    `function getDraftSecret() { return "${draftSecret}"; }`,
    `const request = { get buildId() { return "${buildId}"; } };`,
    `function appIsrCacheKey(pathname, suffix, buildId = "${buildId}") { return [pathname, suffix, buildId]; }`,
    `const render = { deploymentVersion: "${buildId}", rootBoundaryId };`,
    "const stableApplicationCode = true;",
    "",
  ].join("\n"));
  write(root, "frontend/web/dist/server/wrangler.json", "{}\n");
  write(root, "frontend/web/dist/server/vinext-server.json", JSON.stringify({ prerenderSecret }));
  write(root, "frontend/web/dist/server/ssr/vinext-server.json", JSON.stringify({ prerenderSecret }));
  write(root, "frontend/web/dist/server/.wrangler/cache/cf.json", JSON.stringify({ runtimeMarker }));
  write(root, "frontend/web/dist/client/_headers");
}

function validArtifact(treeSha256 = "c".repeat(64)) {
  return { root: "fixture", entries: [{ path: "output", kind: "file", bytes: 1, sha256: "d".repeat(64) }], treeSha256 };
}

function validWebArtifact(treeSha256 = "c".repeat(64)) {
  return {
    ...validArtifact(treeSha256),
    normalization: {
      policy: "vinext-ephemeral-security-material-v1",
      ignoredRuntimePaths: ["server/.wrangler"],
      excludedSecurityMaterialPaths: [
        "server/vinext-server.json",
        "server/ssr/vinext-server.json",
      ],
      normalizedBundlePaths: ["server/index.js"],
      normalizedFields: ["draftSecret", "buildId"],
    },
  };
}

function validManifest(overrides = {}) {
  const artifact = validArtifact();
  const webArtifact = validWebArtifact();
  const gates = REQUIRED_GATES.map((gate) => ({
    gate,
    exitCode: 0,
    skipped: 0,
    logSha256: "e".repeat(64),
    command: `allowlisted:${gate}`,
    ...(gate === "MINI_RELEASE" ? { miniAppIdRef: "vault://talk-and-talk/wechat-app-id#candidate" } : {}),
    ...(gate === "WEB_CHECK" ? { generatedArtifacts: { web: webArtifact } } : {}),
    ...(gate === "API_BUILD" ? { generatedArtifacts: { api: artifact, apiGenerated: artifact } } : {}),
  }));
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "talk-and-talk-candidate-evidence-manifest",
    finalizedAt: "2026-08-09T00:00:00.000Z",
    candidateSha: "a".repeat(40),
    parentSha: "b".repeat(40),
    sourceRef: "refs/tags/candidate",
    sourceTreeSha256: artifact.treeSha256,
    freezeSha256: "f".repeat(64),
    source: artifact,
    toolchain: {
      platform: "darwin",
      architecture: "arm64",
      osRelease: "fixture",
      node: { executable: "/node", version: "v24.0.0" },
      npm: { command: "npm", version: "11.0.0" },
      git: { command: "git", version: "git version fixture" },
    },
    reviewerEvidence: "E1-REVIEW-20260809",
    cleanupEvidence: "E1-CLEANUP-20260809",
    gates,
    artifacts: {
      web: webArtifact,
      api: artifact,
      apiGenerated: artifact,
      miniReleaseSource: artifact,
      sbom: {
        name: "sbom",
        bytes: 2,
        sha256: "1".repeat(64),
        format: "CycloneDX",
        specificationVersion: "1.6",
        generator: [{ name: "talk-and-talk-lockfile-sbom", version: "1.0.0" }],
        lockHashes: { api: "2".repeat(64), miniprogram: "3".repeat(64), web: "4".repeat(64) },
      },
    },
    limitations: [],
    ...overrides,
  };
}

function writeVerifiedCapture(root, { captureId, checkoutFingerprint }) {
  mkdirSync(join(root, "gates"), { recursive: true });
  mkdirSync(join(root, "logs"), { recursive: true });
  const base = validManifest();
  const freeze = {
    schemaVersion: SCHEMA_VERSION,
    kind: "talk-and-talk-candidate-freeze",
    createdAt: "2026-08-09T00:00:00.000Z",
    candidateSha: base.candidateSha,
    parentSha: base.parentSha,
    sourceRef: base.sourceRef,
    sourceRefSha: base.candidateSha,
    gitVersion: base.toolchain.git.version,
    toolchain: base.toolchain,
    captureId,
    checkoutFingerprint,
    sourceTreeSha256: base.sourceTreeSha256,
  };
  const freezeRaw = `${JSON.stringify(freeze, null, 2)}\n`;
  writeFileSync(join(root, "00-freeze.json"), freezeRaw, "utf8");
  const emptyLogSha = sha256("");
  const manifest = validManifest({
    freezeSha256: sha256(freezeRaw),
    gates: base.gates.map((gate) => ({ ...gate, logSha256: emptyLogSha })),
  });
  for (const gate of manifest.gates) {
    writeFileSync(join(root, "logs", `${gate.gate}.log`), "", "utf8");
    writeFileSync(join(root, "gates", `${gate.gate}.json`), JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      kind: "talk-and-talk-candidate-gate-record",
      candidateSha: manifest.candidateSha,
      sourceTreeSha256: manifest.sourceTreeSha256,
      redactedPotentialSecretCount: 0,
      ...gate,
    }), "utf8");
  }
  const manifestPath = join(root, "manifest.json");
  const manifestRaw = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(manifestPath, manifestRaw, "utf8");
  writeFileSync(`${manifestPath}.sha256`, `${sha256(manifestRaw)}  manifest.json\n`, "utf8");
  return manifestPath;
}

function runCli(root, args) {
  return spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });
}

test("begin captures a detached clean fixture outside its repository", () => {
  const fixture = createFixture();
  const output = `${fixture.root}-evidence`;
  try {
    const result = beginCapture({ root: fixture.root, candidateSha: fixture.sha, sourceRef: "HEAD", output });
    assert.equal(result.freeze.candidateSha, fixture.sha);
    assert.ok(existsSync(join(output, "00-freeze.json")));
    assert.ok(existsSync(join(output, "manifests", "source-tree.json")));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
    rmSync(output, { recursive: true, force: true });
  }
});

test("begin refuses an attached, dirty, inside-repository, or gitlink candidate", () => {
  const attached = createFixture({ detach: false });
  const dirty = createFixture();
  const gitlink = createFixture({ gitlink: true });
  const ignoredConfig = createFixture();
  const trackedConfig = createFixture({ detach: false });
  const staleArtifact = createFixture();
  const staleGenerated = createFixture();
  const trackedSymlink = createFixture({ detach: false });
  try {
    assert.notEqual(runCli(attached.root, ["begin", "--sha", attached.sha, "--source-ref", "HEAD", "--out", `${attached.root}-evidence`]).status, 0);
    write(dirty.root, "untracked.txt");
    assert.notEqual(runCli(dirty.root, ["begin", "--sha", dirty.sha, "--source-ref", "HEAD", "--out", `${dirty.root}-evidence`]).status, 0);
    assert.notEqual(runCli(dirty.root, ["begin", "--sha", dirty.sha, "--source-ref", "HEAD", "--out", join(dirty.root, "evidence")]).status, 0);
    assert.notEqual(runCli(gitlink.root, ["begin", "--sha", gitlink.sha, "--source-ref", "HEAD", "--out", `${gitlink.root}-evidence`]).status, 0);
    write(ignoredConfig.root, "backend/api/.env", "DATABASE_URL=not-for-candidate\n");
    const ignoredConfigResult = runCli(ignoredConfig.root, ["begin", "--sha", ignoredConfig.sha, "--source-ref", "HEAD", "--out", `${ignoredConfig.root}-evidence`]);
    assert.notEqual(ignoredConfigResult.status, 0);
    assert.match(`${ignoredConfigResult.stdout}${ignoredConfigResult.stderr}`, /ignored configuration input/);
    write(trackedConfig.root, "frontend/web/.env.local", "TALKTALK_API_BASE_URL=https://not-for-candidate.example\n");
    git(trackedConfig.root, "add", "frontend/web/.env.local");
    git(trackedConfig.root, "commit", "-qm", "tracked private config");
    trackedConfig.sha = git(trackedConfig.root, "rev-parse", "HEAD");
    git(trackedConfig.root, "checkout", "--detach", "-q");
    assert.notEqual(runCli(trackedConfig.root, ["begin", "--sha", trackedConfig.sha, "--source-ref", "HEAD", "--out", `${trackedConfig.root}-evidence`]).status, 0);
    writeRequiredArtifacts(staleArtifact.root);
    assert.notEqual(runCli(staleArtifact.root, ["begin", "--sha", staleArtifact.sha, "--source-ref", "HEAD", "--out", `${staleArtifact.root}-evidence`]).status, 0);
    write(staleGenerated.root, "backend/api/generated/prisma/client.ts", "stale generated client\n");
    const staleGeneratedResult = runCli(staleGenerated.root, ["begin", "--sha", staleGenerated.sha, "--source-ref", "HEAD", "--out", `${staleGenerated.root}-evidence`]);
    assert.notEqual(staleGeneratedResult.status, 0);
    assert.match(`${staleGeneratedResult.stdout}${staleGeneratedResult.stderr}`, /stale generated artifact/);
    symlinkSync("/private/tmp", join(trackedSymlink.root, "external-source"));
    git(trackedSymlink.root, "add", "external-source");
    git(trackedSymlink.root, "commit", "-qm", "tracked external symlink");
    trackedSymlink.sha = git(trackedSymlink.root, "rev-parse", "HEAD");
    git(trackedSymlink.root, "checkout", "--detach", "-q");
    assert.notEqual(runCli(trackedSymlink.root, ["begin", "--sha", trackedSymlink.sha, "--source-ref", "HEAD", "--out", `${trackedSymlink.root}-evidence`]).status, 0);
  } finally {
    for (const fixture of [attached, dirty, gitlink, ignoredConfig, trackedConfig, staleArtifact, staleGenerated, trackedSymlink]) {
      rmSync(fixture.root, { recursive: true, force: true });
      rmSync(`${fixture.root}-evidence`, { recursive: true, force: true });
    }
  }
});

test("begin refuses a clean candidate with case-folded private or package-manager configuration", () => {
  const ignored = createFixture();
  const tracked = createFixture({ detach: false });
  const ignoredNpmrc = createFixture();
  try {
    writeFileSync(join(ignored.root, ".git", "info", "exclude"), "backend/api/NpM-Shrinkwrap.JsOn\n", "utf8");
    write(ignored.root, "backend/api/NpM-Shrinkwrap.JsOn", fixturePackageLock("ignored-shrinkwrap"));
    const ignoredResult = runCli(ignored.root, [
      "begin",
      "--sha", ignored.sha,
      "--source-ref", "HEAD",
      "--out", `${ignored.root}-evidence`,
    ]);
    assert.notEqual(ignoredResult.status, 0);
    assert.match(`${ignoredResult.stdout}${ignoredResult.stderr}`, /ignored configuration input.*npm-shrinkwrap\.json/i);

    write(tracked.root, "frontend/web/NPM-shrinkwrap.json", fixturePackageLock("tracked-shrinkwrap"));
    git(tracked.root, "add", "frontend/web/NPM-shrinkwrap.json");
    git(tracked.root, "commit", "-qm", "tracked shrinkwrap");
    tracked.sha = git(tracked.root, "rev-parse", "HEAD");
    git(tracked.root, "checkout", "--detach", "-q");
    const trackedResult = runCli(tracked.root, [
      "begin",
      "--sha", tracked.sha,
      "--source-ref", "HEAD",
      "--out", `${tracked.root}-evidence`,
    ]);
    assert.notEqual(trackedResult.status, 0);
    assert.match(`${trackedResult.stdout}${trackedResult.stderr}`, /tracked private configuration input.*npm-shrinkwrap\.json/i);

    writeFileSync(join(ignoredNpmrc.root, ".git", "info", "exclude"), ".NPMRC\n", "utf8");
    write(ignoredNpmrc.root, ".NPMRC", "registry=https://registry.example.test/\n");
    const ignoredNpmrcResult = runCli(ignoredNpmrc.root, [
      "begin",
      "--sha", ignoredNpmrc.sha,
      "--source-ref", "HEAD",
      "--out", `${ignoredNpmrc.root}-evidence`,
    ]);
    assert.notEqual(ignoredNpmrcResult.status, 0);
    assert.match(`${ignoredNpmrcResult.stdout}${ignoredNpmrcResult.stderr}`, /ignored configuration input.*\.npmrc/i);
  } finally {
    for (const fixture of [ignored, tracked, ignoredNpmrc]) {
      rmSync(fixture.root, { recursive: true, force: true });
      rmSync(`${fixture.root}-evidence`, { recursive: true, force: true });
    }
  }
});

test("begin refuses a clean candidate that omits a current evidence-control contract source", () => {
  const requiredControlPaths = [
    ".github/workflows/g1-candidate-control-plane.yml",
    "backend/api/Dockerfile",
    "backend/api/scripts/run-migration-compatibility.mjs",
    "backend/api/scripts/run-migration-compatibility.sh",
    "backend/api/scripts/run-migration-compatibility.test.mjs",
    "infra/docker-compose.migration-compatibility.yml",
    "scripts/g2-browser-evidence-card-contract.mjs",
    "scripts/g2-browser-evidence-card-contract.test.mjs",
    "scripts/oci-builder-custody-contract.mjs",
    "scripts/oci-builder-custody-contract.test.mjs",
    "docs/cto-self-audit/runs/2026-08-08-g1-remediation/external-control-plane-oci-custody-contract.md",
  ];
  const fixtures = requiredControlPaths.map((path) => createFixture({ omittedPaths: [path] }));
  try {
    for (const [index, fixture] of fixtures.entries()) {
      const path = requiredControlPaths[index];
      const result = runCli(fixture.root, [
        "begin",
        "--sha", fixture.sha,
        "--source-ref", "HEAD",
        "--out", `${fixture.root}-evidence`,
      ]);
      assert.notEqual(result.status, 0, path);
      assert.match(`${result.stdout}${result.stderr}`, new RegExp(`Candidate is missing required tracked source path: ${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    }
  } finally {
    for (const fixture of fixtures) {
      rmSync(fixture.root, { recursive: true, force: true });
      rmSync(`${fixture.root}-evidence`, { recursive: true, force: true });
    }
  }
});

test("begin refuses clean detached candidates whose required source paths have the wrong type", () => {
  const fileAsDirectory = createFixture({ detach: false });
  const migrationsAsFile = createFixture({ detach: false });
  const fixtures = [
    {
      fixture: fileAsDirectory,
      path: "scripts/g2-browser-evidence-card-contract.mjs",
      kind: "file",
      replace() {
        rmSync(join(fileAsDirectory.root, this.path), { force: true });
        write(fileAsDirectory.root, `${this.path}/tracked-child`);
      },
    },
    {
      fixture: migrationsAsFile,
      path: "backend/api/prisma/migrations",
      kind: "directory",
      replace() {
        rmSync(join(migrationsAsFile.root, this.path), { recursive: true, force: true });
        write(migrationsAsFile.root, this.path);
      },
    },
  ];
  try {
    for (const entry of fixtures) {
      entry.replace();
      git(entry.fixture.root, "add", "--all");
      git(entry.fixture.root, "commit", "-qm", `replace ${entry.path} with wrong type`);
      git(entry.fixture.root, "checkout", "--detach", "-q");
      const candidateSha = git(entry.fixture.root, "rev-parse", "HEAD");
      assert.equal(git(entry.fixture.root, "status", "--porcelain"), "");
      assert.notEqual(git(entry.fixture.root, "ls-files", "--error-unmatch", "--", entry.path), "");

      const result = runCli(entry.fixture.root, [
        "begin",
        "--sha", candidateSha,
        "--source-ref", "HEAD",
        "--out", `${entry.fixture.root}-evidence`,
      ]);

      assert.notEqual(result.status, 0, entry.path);
      assert.match(
        `${result.stdout}${result.stderr}`,
        new RegExp(`Candidate required source path must be a non-symbolic-link ${entry.kind}: ${entry.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
      );
    }
  } finally {
    for (const { fixture } of fixtures) {
      rmSync(fixture.root, { recursive: true, force: true });
      rmSync(`${fixture.root}-evidence`, { recursive: true, force: true });
    }
  }
});

test("directory hashing is sorted and comparison accepts only complete structural manifests", () => {
  const root = mkdtempSync(join(tmpdir(), "talkandtalk-evidence-hash-"));
  try {
    write(root, "artifact/b.txt", "b");
    write(root, "artifact/a.txt", "a");
    const first = hashDirectory(root, "artifact");
    const second = hashDirectory(root, "artifact");
    assert.deepEqual(first, second);
    symlinkSync(join(root, "artifact"), join(root, "artifact-link"));
    assert.throws(() => hashDirectory(root, "artifact-link"), /Required artifact directory is missing/);
    symlinkSync(join(root, "artifact", "a.txt"), join(root, "artifact", "external.txt"));
    assert.throws(() => hashDirectory(root, "artifact"), /Artifact contains a symbolic link/);
    const base = validManifest({ sourceTreeSha256: first.treeSha256, source: first });
    assert.equal(compareEvidenceManifests({ ...base, finalizedAt: "one" }, { ...base, finalizedAt: "two" }).candidateSha, base.candidateSha);
    assert.throws(() => compareEvidenceManifests(base, { ...base, sourceTreeSha256: "changed" }), /source or freeze hash|source tree|differ/);
    assert.throws(() => validateEvidenceManifest({ ...base, gates: [] }), /exactly one record/);
    assert.throws(() => validateEvidenceManifest({ ...base, schemaVersion: 2 }), /unsupported schema/);
    const missingWebNormalization = structuredClone(base);
    delete missingWebNormalization.artifacts.web.normalization;
    assert.throws(() => validateEvidenceManifest(missingWebNormalization), /Vinext normalization policy/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Web artifact snapshots normalize only Vinext per-build security material", () => {
  const left = mkdtempSync(join(tmpdir(), "talkandtalk-web-artifact-left-"));
  const right = mkdtempSync(join(tmpdir(), "talkandtalk-web-artifact-right-"));
  try {
    writeVinextWebArtifacts(left, {
      draftSecret: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      buildId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      prerenderSecret: "c".repeat(64),
      runtimeMarker: "left-runtime",
    });
    writeVinextWebArtifacts(right, {
      draftSecret: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      buildId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      prerenderSecret: "f".repeat(64),
      runtimeMarker: "right-runtime",
    });

    const leftSnapshot = hashCandidateArtifact(left, "web");
    const rightSnapshot = hashCandidateArtifact(right, "web");
    assert.deepEqual(leftSnapshot, rightSnapshot);
    assert.equal(leftSnapshot.normalization.policy, "vinext-ephemeral-security-material-v1");
    assert.ok(!leftSnapshot.entries.some((entry) => entry.path.includes(".wrangler")));
    assert.ok(!leftSnapshot.entries.some((entry) => entry.path.endsWith("vinext-server.json")));

    write(right, "frontend/web/dist/client/stable.js", "changed application bytes\n");
    assert.notEqual(hashCandidateArtifact(right, "web").treeSha256, leftSnapshot.treeSha256);

    writeVinextWebArtifacts(right, {
      buildId: "22222222-2222-4222-8222-222222222222",
      prerenderSecret: "3".repeat(64),
    });
    const bundlePath = join(right, "frontend/web/dist/server/index.js");
    writeFileSync(
      bundlePath,
      readFileSync(bundlePath, "utf8").replace(
        'deploymentVersion: "22222222-2222-4222-8222-222222222222"',
        'deploymentVersion: "99999999-9999-4999-8999-999999999999"',
      ),
      "utf8",
    );
    assert.throws(() => hashCandidateArtifact(right, "web"), /build IDs must match/);

    writeVinextWebArtifacts(right);
    write(
      right,
      "frontend/web/dist/server/ssr/vinext-server.json",
      JSON.stringify({ prerenderSecret: "4".repeat(64) }),
    );
    assert.throws(() => hashCandidateArtifact(right, "web"), /prerender secrets must match/);
  } finally {
    rmSync(left, { recursive: true, force: true });
    rmSync(right, { recursive: true, force: true });
  }
});

test("candidate zero-skip parser reads only terminal Jest and Node TAP outcomes", () => {
  const root = mkdtempSync(join(tmpdir(), "talkandtalk-evidence-zero-skip-"));
  try {
    assert.equal(skippedCount("\u001B[31mTest Suites: 2 skipped, 2 total\u001B[0m\nTests: 3 skipped, 1 todo, 2 pending, 1 cancelled, 7 total\nSnapshots: 0 total\nTime: 1 s\nRan all test suites.\nTAP version 13\nok 4 - unavailable browser probe # SKIP capability missing\n1..4\n# tests 4\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 3\n# todo 0\n# duration_ms 1\n"), 12);
    assert.equal(skippedCount("TAP version 13\nok 1 - unavailable browser probe # SKIP capability missing\nok 2 - deferred test # TODO later\n"), 2);
    assert.equal(skippedCount("payment reconciliation: 2 skipped provider images\nskipped: 2\n# TODO repair fixture\n  Tests: 2 skipped, 2 total\nTest Suites: 1 passed, 1 total\nTests: 7 passed, 7 total\nSnapshots: 0 total\nTime: 1 s\nRan all test suites.\n"), 0);

    const diagnosticFixture = join(root, "diagnostic.test.mjs");
    writeFileSync(diagnosticFixture, 'import test from "node:test";\ntest("logs", () => console.log("skipped 2"));\n', "utf8");
    const nodeTestEnvironment = { ...process.env };
    delete nodeTestEnvironment.NODE_TEST_CONTEXT;
    const diagnostic = spawnSync(process.execPath, ["--test", diagnosticFixture], {
      encoding: "utf8",
      env: nodeTestEnvironment,
    });
    assert.equal(diagnostic.status, 0);
    assert.match(`${diagnostic.stdout}${diagnostic.stderr}`, /^# skipped 2$/m);
    assert.equal(skippedCount(`${diagnostic.stdout}${diagnostic.stderr}`), 0);

    const skippedFixture = join(root, "actual-skip.test.mjs");
    writeFileSync(skippedFixture, 'import test from "node:test";\ntest("real skip", { skip: true }, () => {});\n', "utf8");
    const skipped = spawnSync(process.execPath, ["--test", skippedFixture], {
      encoding: "utf8",
      env: nodeTestEnvironment,
    });
    assert.equal(skipped.status, 0);
    assert.match(`${skipped.stdout}${skipped.stderr}`, /^# skipped 1$/m);
    assert.equal(skippedCount(`${skipped.stdout}${skipped.stderr}`), 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compare CLI rejects a manifest with an invalid sidecar checksum before claiming a match", () => {
  const root = mkdtempSync(join(tmpdir(), "talkandtalk-evidence-compare-"));
  try {
    const manifest = join(root, "manifest.json");
    const checksum = `${manifest}.sha256`;
    writeFileSync(manifest, JSON.stringify(validManifest()), "utf8");
    writeFileSync(checksum, `${"0".repeat(64)}  manifest.json\n`, "utf8");
    const result = spawnSync(process.execPath, [script, "compare", "--left", manifest, "--right", manifest], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /checksum does not match/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compare CLI requires two distinct capture directories and checkout fingerprints", () => {
  const root = mkdtempSync(join(tmpdir(), "talkandtalk-evidence-distinct-"));
  try {
    const first = writeVerifiedCapture(join(root, "first"), {
      captureId: "11111111-1111-4111-8111-111111111111",
      checkoutFingerprint: "2".repeat(64),
    });
    const same = spawnSync(process.execPath, [script, "compare", "--left", first, "--right", first], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.notEqual(same.status, 0);
    assert.match(`${same.stdout}${same.stderr}`, /distinct independently captured output directories/);

    const second = writeVerifiedCapture(join(root, "second"), {
      captureId: "22222222-2222-4222-8222-222222222222",
      checkoutFingerprint: "2".repeat(64),
    });
    const sameCheckout = spawnSync(process.execPath, [script, "compare", "--left", first, "--right", second], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.notEqual(sameCheckout.status, 0);
    assert.match(`${sameCheckout.stdout}${sameCheckout.stderr}`, /distinct checkout paths and capture IDs/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("SBOM input must be an external CycloneDX or SPDX JSON document with generator metadata", () => {
  const root = mkdtempSync(join(tmpdir(), "talkandtalk-candidate-root-"));
  const sbom = `${root}-sbom.json`;
  try {
    writeFileSync(sbom, "{}\n", "utf8");
    assert.throws(() => validateSbom(sbom, root), /CycloneDX or SPDX/);
    writeFileSync(sbom, JSON.stringify({
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      metadata: { tools: [{ name: "fixture-generator", version: "1.0.0" }] },
    }), "utf8");
    assert.equal(validateSbom(sbom, root).format, "CycloneDX");
    writeFileSync(join(root, "inside.json"), JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.6", metadata: { tools: [{ name: "fixture", version: "1" }] } }), "utf8");
    assert.throws(() => validateSbom(join(root, "inside.json"), root), /outside the candidate repository/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(sbom, { force: true });
  }
});

test("candidate SBOM command binds the freeze SHA, source tree, and all three controlled locks", () => {
  const fixture = createFixture();
  const output = `${fixture.root}-evidence`;
  const sbom = `${fixture.root}-candidate-sbom.json`;
  try {
    const begun = beginCapture({ root: fixture.root, candidateSha: fixture.sha, sourceRef: "HEAD", output });
    const generated = generateSbomForFreeze({
      root: fixture.root,
      freezePath: join(output, "00-freeze.json"),
      output: sbom,
    });
    assert.equal(generated.provenance.format, "CycloneDX");
    assert.ok(existsSync(sbom));
    assert.deepEqual(
      validateSbom(sbom, fixture.root, {
        candidateSha: fixture.sha,
        sourceTreeSha256: begun.freeze.sourceTreeSha256,
      }).lockHashes,
      generated.provenance.lockHashes,
    );
    assert.throws(
      () => validateSbom(sbom, fixture.root, {
        candidateSha: "f".repeat(40),
        sourceTreeSha256: begun.freeze.sourceTreeSha256,
      }),
      /does not exactly match/,
    );
    assert.throws(
      () => generateSbomForFreeze({ root: fixture.root, freezePath: join(output, "00-freeze.json"), output: sbom }),
      /must not overwrite/,
    );
    writeFileSync(sbom, JSON.stringify({
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      metadata: { tools: [{ name: "arbitrary-generator", version: "1.0.0" }] },
      components: [],
      dependencies: [],
    }), "utf8");
    assert.throws(
      () => validateSbom(sbom, fixture.root, {
        candidateSha: fixture.sha,
        sourceTreeSha256: begun.freeze.sourceTreeSha256,
      }),
      /does not exactly match/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
    rmSync(output, { recursive: true, force: true });
    rmSync(sbom, { force: true });
  }
});

test("candidate SBOM generation accepts only the build artifacts already registered by completed gates", () => {
  const fixture = createFixture();
  const output = `${fixture.root}-evidence`;
  const sbom = `${fixture.root}-candidate-sbom.json`;
  try {
    const begun = beginCapture({ root: fixture.root, candidateSha: fixture.sha, sourceRef: "HEAD", output });
    writeVinextWebArtifacts(fixture.root);
    const web = hashCandidateArtifact(fixture.root, "web");
    writeFileSync(join(output, "gates", "WEB_CHECK.json"), JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      kind: "talk-and-talk-candidate-gate-record",
      gate: "WEB_CHECK",
      candidateSha: fixture.sha,
      sourceTreeSha256: begun.freeze.sourceTreeSha256,
      exitCode: 0,
      skipped: 0,
      generatedArtifacts: { web },
    }), "utf8");
    const generated = generateSbomForFreeze({ root: fixture.root, freezePath: join(output, "00-freeze.json"), output: sbom });
    assert.ok(existsSync(generated.path));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
    rmSync(output, { recursive: true, force: true });
    rmSync(sbom, { force: true });
  }
});

test("finalize cannot turn a freeze into evidence while required gate records are absent", () => {
  const fixture = createFixture();
  const output = `${fixture.root}-evidence`;
  const sbom = `${fixture.root}-sbom.json`;
  try {
    writeFileSync(sbom, "{}\n", "utf8");
    const begun = beginCapture({ root: fixture.root, candidateSha: fixture.sha, sourceRef: "HEAD", output });
    const result = runCli(fixture.root, ["finalize", "--freeze", join(output, "00-freeze.json"), "--sbom", sbom, "--reviewer-evidence", "E1-REVIEW-20260809", "--cleanup-evidence", "E1-CLEANUP-20260809"]);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /Missing required gate record/);
    assert.ok(readFileSync(begun.outputDirectory + "/00-freeze.json", "utf8").includes(fixture.sha));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
    rmSync(output, { recursive: true, force: true });
    rmSync(sbom, { force: true });
  }
});

test("finalize rejects copied or malformed gate records instead of treating filenames as proof", () => {
  const fixture = createFixture();
  const output = `${fixture.root}-evidence`;
  const sbom = `${fixture.root}-sbom.json`;
  try {
    writeFileSync(sbom, "{}\n", "utf8");
    beginCapture({ root: fixture.root, candidateSha: fixture.sha, sourceRef: "HEAD", output });
    const copied = {
      schemaVersion: SCHEMA_VERSION,
      kind: "talk-and-talk-candidate-gate-record",
      gate: "DIFF_CHECK",
      candidateSha: fixture.sha,
      sourceTreeSha256: JSON.parse(readFileSync(join(output, "00-freeze.json"), "utf8")).sourceTreeSha256,
      exitCode: 0,
      skipped: 0,
      redactedPotentialSecretCount: 0,
      command: "git diff --check and candidate-state verification",
      logSha256: "0".repeat(64),
    };
    for (const gate of REQUIRED_GATES) {
      writeFileSync(join(output, "gates", `${gate}.json`), JSON.stringify(copied), "utf8");
      writeFileSync(join(output, "logs", `${gate}.log`), "", "utf8");
    }
    copied.logSha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    for (const gate of REQUIRED_GATES) writeFileSync(join(output, "gates", `${gate}.json`), JSON.stringify(copied), "utf8");
    assert.throws(
      () => finalizeCapture({
        root: fixture.root,
        freezePath: join(output, "00-freeze.json"),
        sbom,
        reviewerEvidence: "E1-REVIEW-20260809",
        cleanupEvidence: "E1-CLEANUP-20260809",
      }),
      /names a different gate/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
    rmSync(output, { recursive: true, force: true });
    rmSync(sbom, { force: true });
  }
});

test("gate runner records only allowlisted non-destructive gates and rejects legacy E2E flags", () => {
  const fixture = createFixture();
  const output = `${fixture.root}-evidence`;
  try {
    beginCapture({ root: fixture.root, candidateSha: fixture.sha, sourceRef: "HEAD", output });
    const freeze = join(output, "00-freeze.json");
    assert.throws(
      () => runGate({ root: fixture.root, freezePath: freeze, gate: "API_E2E_1" }),
      /--gate must be one of/
    );
    assert.equal(existsSync(join(output, "gates", "API_E2E_1.json")), false);
    const legacy = runCli(fixture.root, [
      "run",
      "--freeze", freeze,
      "--gate", "DIFF_CHECK",
      "--allow-local-disposable-e2e",
    ]);
    assert.notEqual(legacy.status, 0);
    assert.match(`${legacy.stdout}${legacy.stderr}`, /not accepted for run/);
    const legacyEvidence = runCli(fixture.root, [
      "run",
      "--freeze", freeze,
      "--gate", "DIFF_CHECK",
      "--e2e-authorization-evidence", "E1-LEGACY-E2E",
    ]);
    assert.notEqual(legacyEvidence.status, 0);
    assert.match(`${legacyEvidence.stdout}${legacyEvidence.stderr}`, /not accepted for run/);
    const record = runGate({ root: fixture.root, freezePath: freeze, gate: "DIFF_CHECK" });
    assert.equal(record.exitCode, 0);
    assert.equal(record.skipped, 0);
    assert.ok(existsSync(join(output, "gates", "DIFF_CHECK.json")));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
    rmSync(output, { recursive: true, force: true });
  }
});

test("candidate capture rejects preloaded Node settings, seals child HOME, and keeps Mini release references non-secret", () => {
  const fixture = createFixture({ miniValidateContent: [
    'if (process.env.NODE_OPTIONS) process.exit(2);',
    'if (process.env.HOME === "/unsafe-home") process.exit(3);',
    'if (!process.env.npm_config_userconfig?.endsWith("/.npmrc")) process.exit(4);',
  ].join("\n") });
  const output = `${fixture.root}-evidence`;
  const previousNodeOptions = process.env.NODE_OPTIONS;
  const previousNodePath = process.env.NODE_PATH;
  const previousHome = process.env.HOME;
  try {
    process.env.NODE_OPTIONS = "--require /unsafe-preload.cjs";
    assert.throws(
      () => beginCapture({ root: fixture.root, candidateSha: fixture.sha, sourceRef: "HEAD", output }),
      /NODE_OPTIONS must be empty/,
    );
    if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previousNodeOptions;
    process.env.NODE_PATH = "/unsafe-node-path";
    assert.throws(
      () => beginCapture({ root: fixture.root, candidateSha: fixture.sha, sourceRef: "HEAD", output }),
      /NODE_PATH must be empty/,
    );
    if (previousNodePath === undefined) delete process.env.NODE_PATH;
    else process.env.NODE_PATH = previousNodePath;
    process.env.HOME = "/unsafe-home";
    beginCapture({ root: fixture.root, candidateSha: fixture.sha, sourceRef: "HEAD", output });
    const freeze = join(output, "00-freeze.json");
    const record = runGate({ root: fixture.root, freezePath: freeze, gate: "MINI_VALIDATE" });
    assert.equal(record.exitCode, 0);
    process.env.WECHAT_MINIPROGRAM_APP_ID = "wx1234567890abcdef";
    assert.throws(
      () => runGate({
        root: fixture.root,
        freezePath: freeze,
        gate: "MINI_RELEASE",
        options: { miniAppIdRef: "wx1234567890abcdef" },
      }),
      /vault:\/\/ reference/,
    );
  } finally {
    if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previousNodeOptions;
    if (previousNodePath === undefined) delete process.env.NODE_PATH;
    else process.env.NODE_PATH = previousNodePath;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    delete process.env.WECHAT_MINIPROGRAM_APP_ID;
    rmSync(fixture.root, { recursive: true, force: true });
    rmSync(output, { recursive: true, force: true });
  }
});
