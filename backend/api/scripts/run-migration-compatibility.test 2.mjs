import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createInterruptController,
  hashGitRevisionSourceTree,
  migrationCompatibilityPlan,
  runMigrationCompatibility
} from "./run-migration-compatibility.mjs";
import { hashCandidateSourceTree } from "../../../scripts/candidate-source-tree.mjs";

const apiRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const composePath = resolve(apiRoot, "../../infra/docker-compose.migration-compatibility.yml");
const launcherPath = resolve(apiRoot, "scripts/run-migration-compatibility.sh");
const sha = (letter) => letter.repeat(40);
const hash = (letter) => letter.repeat(64);
const image = (name, digest) => `registry.example.test/talk-and-talk/${name}@sha256:${digest}`;
let receiptSequence = 0;

const previous = Object.freeze({
  sha: sha("a"),
  sourceTreeSha256: hash("b"),
  provenance: hash("c"),
  image: image("previous-api", hash("d"))
});
const candidate = Object.freeze({
  sha: sha("e"),
  sourceTreeSha256: hash("f"),
  provenance: hash("0"),
  image: image("candidate-api", hash("1"))
});
const postgresImage = image("postgres", hash("4"));
const redisImage = image("redis", hash("5"));
const trustedNodeBytes = Buffer.from("talk-and-talk migration compatibility trusted node\n", "utf8");
const trustedNodeSha256 = createHash("sha256").update(trustedNodeBytes).digest("hex");

function unusedReceiptPath() {
  receiptSequence += 1;
  return join(tmpdir(), `talk-and-talk-migration-receipt-${process.pid}-${receiptSequence}.json`);
}

function validEnvironment(overrides = {}) {
  return {
    DOCKER_HOST: "unix:///var/run/docker.sock",
    MIGRATION_COMPATIBILITY_CANDIDATE_ARTIFACT_EVIDENCE: "E1-CANDIDATE-ARTIFACT-20260809",
    MIGRATION_COMPATIBILITY_CANDIDATE_ARTIFACT_PROVENANCE_SHA256: candidate.provenance,
    MIGRATION_COMPATIBILITY_CANDIDATE_IMAGE: candidate.image,
    MIGRATION_COMPATIBILITY_CANDIDATE_SHA: candidate.sha,
    MIGRATION_COMPATIBILITY_CANDIDATE_SOURCE_TREE_SHA256: candidate.sourceTreeSha256,
    MIGRATION_COMPATIBILITY_ENVIRONMENT_APPROVAL_REFERENCE: "E1-MIGRATION-COMPATIBILITY-20260809",
    MIGRATION_COMPATIBILITY_EXECUTION_AUTHORIZATION_EVIDENCE: "E1-MIGRATION-COMPATIBILITY-20260809",
    MIGRATION_COMPATIBILITY_INFRA_IMAGES_EVIDENCE: "E1-MIGRATION-INFRA-20260809",
    MIGRATION_COMPATIBILITY_POSTGRES_IMAGE: postgresImage,
    MIGRATION_COMPATIBILITY_PREVIOUS_ARTIFACT_EVIDENCE: "E1-PREVIOUS-ARTIFACT-20260809",
    MIGRATION_COMPATIBILITY_PREVIOUS_ARTIFACT_PROVENANCE_SHA256: previous.provenance,
    MIGRATION_COMPATIBILITY_PREVIOUS_IMAGE: previous.image,
    MIGRATION_COMPATIBILITY_PREVIOUS_SHA: previous.sha,
    MIGRATION_COMPATIBILITY_PREVIOUS_SOURCE_TREE_SHA256: previous.sourceTreeSha256,
    MIGRATION_COMPATIBILITY_RECEIPT_OUT: unusedReceiptPath(),
    MIGRATION_COMPATIBILITY_REDIS_IMAGE: redisImage,
    MIGRATION_COMPATIBILITY_RUNNER_SEALED_LAUNCH: "1",
    MIGRATION_COMPATIBILITY_RUNNER_NODE_SHA256: trustedNodeSha256,
    MIGRATION_COMPATIBILITY_TARGET_KIND: "local-disposable",
    ...overrides
  };
}

function labelsFor(imageReference) {
  const artifact = imageReference === previous.image ? previous : candidate;
  return JSON.stringify({
    "io.talkandtalk.artifact-provenance-sha256": artifact.provenance,
    "io.talkandtalk.provenance-kind": "approved-candidate",
    "io.talkandtalk.source-tree-sha256": artifact.sourceTreeSha256,
    "org.opencontainers.image.revision": artifact.sha
  });
}

function toolchain() {
  return {
    composeFile: "/trusted/docker-compose.migration-compatibility.yml",
    dockerExecutable: "/trusted/docker",
    nodeExecutable: "/trusted/node",
    path: "/trusted/node:/usr/bin:/bin"
  };
}

function mockRunner({ badImageLabels = false, failCandidateMigration = false, failCandidateMigrationStatus = false, failCleanup = false, leaveResourcesAfterCleanup = false, noOwnedResources = false, postgresObjectCount = "0", resourceLabelsMismatch = false, redisData15 = "0" } = {}) {
  const calls = [];
  const markerHash = createHash("sha256").update(Buffer.alloc(32, 0x0b)).digest("hex");
  let observedProject = null;
  let cleaned = false;
  const workspace = {
    cleanup: () => calls.push("workspace:cleanup"),
    dockerRuntimeEnvironment: { HOME: "/tmp/migration-home", PATH: "/trusted/node:/usr/bin:/bin" },
    runtimeEnvironmentFile: "/tmp/migration-runtime.env"
  };
  const resourceLabels = () => JSON.stringify({
    "com.docker.compose.project": observedProject,
    "io.talkandtalk.migration-compatibility.ownership-marker-sha256": markerHash,
    "io.talkandtalk.migration-compatibility.run-id": resourceLabelsMismatch ? "another-run" : observedProject?.replace("talk_and_talk_migration_", "")
  });
  const rememberProject = (text) => {
    const match = text.match(/label=com\.docker\.compose\.project=([^\s]+)/);
    if (match) observedProject = match[1];
  };
  const runCommand = async (_executable, args) => {
    const text = args.join(" ");
    calls.push(`command:${text}`);
    const isComposeRunService = (service) => args.includes("run")
      && args.includes("--pull")
      && args.includes("never")
      && args.at(-1) === service;
    if (failCandidateMigration && isComposeRunService("candidate-migrate")) {
      throw new Error("candidate migrate failed");
    }
    if (failCandidateMigrationStatus && isComposeRunService("candidate-migrate-status")) {
      throw new Error("candidate migrate status failed");
    }
    if (failCleanup && text.includes("down --volumes")) {
      throw new Error("cleanup failed");
    }
    if (text.includes("down --volumes")) cleaned = true;
    return { stdout: "", stderr: "" };
  };
  const runCapture = async (_executable, args) => {
    const text = args.join(" ");
    calls.push(`capture:${text}`);
    if (text.includes("image inspect") && text.includes("RepoDigests")) {
      return { stdout: JSON.stringify([args.at(-1)]) };
    }
    if (text.includes("image inspect") && text.includes("Config.Labels")) {
      return { stdout: badImageLabels ? "{}" : labelsFor(args.at(-1)) };
    }
    if (text.startsWith("ps -a ")) {
      rememberProject(text);
      return { stdout: noOwnedResources || cleaned && !leaveResourcesAfterCleanup ? "" : "container-one\n" };
    }
    if (text.startsWith("network ls ")) {
      rememberProject(text);
      return { stdout: noOwnedResources || cleaned && !leaveResourcesAfterCleanup ? "" : "network-one\n" };
    }
    if (text.startsWith("volume ls ")) {
      rememberProject(text);
      return { stdout: noOwnedResources || cleaned && !leaveResourcesAfterCleanup ? "" : "volume-one\n" };
    }
    if (/^(?:inspect inspect|network inspect|volume inspect) /.test(text)) {
      return { stdout: resourceLabels() };
    }
    if (text.includes(`SELECT marker_sha256 FROM _talktalk_migration_control.ownership`)) {
      return { stdout: `${markerHash}\n` };
    }
    if (text.includes("AS unexpected_objects")) {
      return { stdout: `${postgresObjectCount}\n` };
    }
    if (text.includes("redis-cli --raw -n 14 DBSIZE")) {
      return { stdout: "0\n" };
    }
    if (text.includes("redis-cli --raw -n 15 DBSIZE")) {
      return { stdout: `${redisData15}\n` };
    }
    if (text.includes("redis-cli --raw -n 14 SET")) {
      return { stdout: "OK\n" };
    }
    if (text.includes("redis-cli --raw -n 14 GET")) {
      return { stdout: `${markerHash}\n` };
    }
    if (text.includes("curl ")) {
      return {
        stdout: JSON.stringify({
          data: { status: "ok", dependencies: { database: { status: "ok" }, redis: { status: "ok" } } }
        })
      };
    }
    throw new Error(`Unexpected capture command: ${text}`);
  };
  return { calls, runCapture, runCommand, workspace };
}

function runOptions(environment, mock, overrides = {}) {
  return {
    environment,
    createInterruptController: () => ({ dispose: () => mock.calls.push("interrupt:dispose"), signal: new AbortController().signal }),
    createWorkspace: () => mock.workspace,
    randomBytes: (size) => Buffer.alloc(size, size === 12 ? 0x0a : 0x0b),
    logError: () => undefined,
    processExecArgv: [],
    readNodeExecutable: () => trustedNodeBytes,
    resolveToolchain: () => toolchain(),
    runCapture: mock.runCapture,
    runCommand: mock.runCommand,
    verifyCheckout: () => mock.calls.push("checkout"),
    ...overrides
  };
}

test("migration plan rejects unsealed, unauthorised, mutable, hostile, and non-disposable inputs before side effects", () => {
  assert.throws(() => migrationCompatibilityPlan(validEnvironment({ MIGRATION_COMPATIBILITY_RUNNER_SEALED_LAUNCH: "" })), /documented POSIX/);
  assert.throws(() => migrationCompatibilityPlan(validEnvironment({ MIGRATION_COMPATIBILITY_EXECUTION_AUTHORIZATION_EVIDENCE: "" })), /EXECUTION_AUTHORIZATION_EVIDENCE/);
  assert.throws(() => migrationCompatibilityPlan(validEnvironment({ MIGRATION_COMPATIBILITY_ENVIRONMENT_APPROVAL_REFERENCE: "E1-OTHER-20260809" })), /must match/);
  assert.throws(() => migrationCompatibilityPlan(validEnvironment({ MIGRATION_COMPATIBILITY_CANDIDATE_IMAGE: "registry.example.test/talk-and-talk/candidate:latest" })), /immutable/);
  assert.throws(() => migrationCompatibilityPlan(validEnvironment({ MIGRATION_COMPATIBILITY_PREVIOUS_SHA: candidate.sha })), /must be distinct/);
  assert.throws(() => migrationCompatibilityPlan(validEnvironment({ NODE_OPTIONS: "--require=/tmp/hostile.cjs" })), /NODE_OPTIONS/);
  assert.throws(() => migrationCompatibilityPlan(validEnvironment({ MIGRATION_COMPATIBILITY_RUNNER_NODE_SHA256: "not-a-sha" })), /RUNNER_NODE_SHA256/);
  assert.throws(() => migrationCompatibilityPlan(validEnvironment({ MIGRATION_COMPATIBILITY_TARGET_KIND: "external-control-plane" })), /exactly local-disposable/);
  assert.throws(() => migrationCompatibilityPlan(validEnvironment({ DOCKER_CONTEXT: "remote" })), /DOCKER_CONTEXT/);
  assert.throws(() => migrationCompatibilityPlan(validEnvironment({ DATABASE_URL: "postgresql://db.example/prod" })), /DATABASE_URL/);
  assert.throws(() => migrationCompatibilityPlan(validEnvironment({ MIGRATION_COMPATIBILITY_RECEIPT_OUT: join(apiRoot, "receipt.json") })), /outside the repository/);
  assert.equal("MIGRATION_COMPATIBILITY_FIXTURE_IMAGE" in validEnvironment(), false, "fresh-schema runner must not accept an arbitrary fixture image");
});

test("a preflight refusal creates no workspace, Docker command, port, checkout, or receipt", async () => {
  const calls = [];
  await assert.rejects(
    runMigrationCompatibility({
      environment: validEnvironment({ MIGRATION_COMPATIBILITY_EXECUTION_AUTHORIZATION_EVIDENCE: "" }),
      createWorkspace: () => calls.push("workspace"),
      resolveToolchain: () => calls.push("toolchain"),
      runCommand: () => calls.push("command"),
      runCapture: () => calls.push("capture"),
      verifyCheckout: () => calls.push("checkout"),
      writeReceipt: () => calls.push("receipt")
    }),
    /EXECUTION_AUTHORIZATION_EVIDENCE/
  );
  assert.deepEqual(calls, []);
});

test("Node execution flags and a Node executable digest mismatch stop before workspace or Docker activity", async () => {
  const flagCalls = [];
  await assert.rejects(
    runMigrationCompatibility({
      environment: validEnvironment(),
      processExecArgv: ["--require=/tmp/hostile.cjs"],
      createWorkspace: () => flagCalls.push("workspace"),
      resolveToolchain: () => flagCalls.push("toolchain"),
      runCommand: () => flagCalls.push("command"),
      runCapture: () => flagCalls.push("capture"),
      verifyCheckout: () => flagCalls.push("checkout")
    }),
    /without Node execution arguments/
  );
  assert.deepEqual(flagCalls, []);

  const mismatchMock = mockRunner();
  await assert.rejects(
    runMigrationCompatibility(runOptions(validEnvironment({ MIGRATION_COMPATIBILITY_RUNNER_NODE_SHA256: hash("9") }), mismatchMock)),
    /trusted Node executable SHA-256/
  );
  assert.ok(mismatchMock.calls.includes("checkout"));
  assert.equal(mismatchMock.calls.some((entry) => entry === "workspace:cleanup"), false);
  assert.equal(mismatchMock.calls.some((entry) => entry.startsWith("command:")), false);
  assert.equal(mismatchMock.calls.some((entry) => entry.startsWith("capture:")), false);
});

test("historical source-tree provenance is reconstructed from Git blobs, not a caller label", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "talk-and-talk-migration-git-tree-"));
  const git = (args) => {
    const result = spawnSync("/usr/bin/git", args, {
      cwd: fixtureRoot,
      encoding: "utf8",
      env: { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", HOME: "/tmp", PATH: "/usr/bin:/bin" }
    });
    assert.equal(result.status, 0, `${args.join(" ")} failed: ${result.stderr}`);
    return result.stdout.trim();
  };
  try {
    git(["init", "--quiet"]);
    git(["config", "user.email", "migration-test@example.test"]);
    git(["config", "user.name", "Migration Test"]);
    writeFileSync(join(fixtureRoot, "ordinary.txt"), "ordinary\n");
    writeFileSync(join(fixtureRoot, "executable.sh"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(fixtureRoot, "executable.sh"), 0o755);
    git(["add", "."]);
    git(["commit", "--quiet", "-m", "fixture"]);
    const revision = git(["rev-parse", "HEAD"]);
    const first = hashGitRevisionSourceTree(fixtureRoot, revision);
    const second = hashGitRevisionSourceTree(fixtureRoot, revision);
    const checkoutHash = hashCandidateSourceTree(fixtureRoot, git(["ls-tree", "-r", revision])).treeSha256;
    assert.match(first.treeSha256, /^[0-9a-f]{64}$/);
    assert.equal(first.treeSha256, second.treeSha256);
    assert.equal(first.treeSha256, checkoutHash, "prior Git-blob hashing must match the candidate checkout manifest algorithm");
    assert.ok(first.entries.length === 2);
    assert.deepEqual(first.entries.map((entry) => entry.mode).sort(), [0o644, 0o755]);
    assert.ok(first.entries.every((entry) => entry.kind === "file" && /^[0-9a-f]{64}$/.test(entry.sha256)));
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true });
  }
});

test("sealed fresh-schema mock run has authenticated readiness, serial old/candidate stages, verified cleanup, and a redacted receipt", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "talk-and-talk-migration-receipt-test-"));
  const receiptOutput = join(temporaryDirectory, "migration-receipt.json");
  const mock = mockRunner();
  try {
    const result = await runMigrationCompatibility(runOptions(validEnvironment({ MIGRATION_COMPATIBILITY_RECEIPT_OUT: receiptOutput }), mock));
    assert.equal(result.status, "passed");
    assert.equal(result.ownedResourceCount, 3);
    assert.equal(result.receiptOutput, join(realpathSync(temporaryDirectory), "migration-receipt.json"));

    const commands = mock.calls.filter((entry) => entry.startsWith("command:"));
    const locate = (fragment) => commands.findIndex((entry) => entry.includes(fragment));
    const locateComposeService = (verb, service) => commands.findIndex((entry) => entry.includes(` ${verb} `) && entry.endsWith(` ${service}`));
    const candidateMigration = locateComposeService("run", "candidate-migrate");
    const candidateMigrationStatus = locateComposeService("run", "candidate-migrate-status");
    assert.ok(locate("config --quiet") >= 0, "Compose configuration must be checked before resources start");
    assert.ok(locate("previous-migrate") < locate("up --detach --wait --pull never --no-build previous-api"));
    assert.ok(candidateMigration >= 0, "candidate migration command must exist as its own service invocation");
    assert.ok(candidateMigrationStatus >= 0, "candidate migration status command must exist as its own service invocation");
    assert.ok(locate("up --detach --wait --pull never --no-build previous-api") < candidateMigration);
    assert.ok(candidateMigration < candidateMigrationStatus, "candidate migration must precede its status check");
    assert.ok(candidateMigrationStatus < locate("stop previous-api"));
    assert.ok(locate("stop previous-api") < locate("previous-api-compatible"));
    assert.ok(locate("previous-api-compatible") < locate("stop previous-api-compatible"));
    assert.ok(locate("stop previous-api-compatible") < locate("candidate-api"));
    assert.ok(locate("candidate-api") < locate("down --volumes"));
    assert.equal(commands.filter((entry) => entry.includes("down --volumes")).length, 1);
    assert.equal(commands.some((entry) => /(?:^|\s)(?:build|push|login|tag|prune)(?:\s|$)/.test(entry)), false, "runner must never build, push, login, tag, or prune");
    assert.equal(commands.filter((entry) => /(?:\bup\b|\brun\b)/.test(entry)).every((entry) => entry.includes("--pull never")), true, "all image-starting Compose operations must explicitly refuse pulls");
    assert.equal(mock.calls.filter((entry) => entry.includes("image inspect") && entry.includes("RepoDigests")).length, 8, "four digest-pinned images are rechecked before and after runtime");
    assert.ok(mock.calls.some((entry) => entry.includes("redis-cli --raw -n 14 DBSIZE")), "runner must prove Redis DB14 marker store is empty");
    assert.ok(mock.calls.some((entry) => entry.includes("redis-cli --raw -n 15 DBSIZE")), "runner must prove Redis application-data DB15 is empty");
    assert.ok(mock.calls.some((entry) => entry.includes("volume ls") && entry.includes("--format {{.Name}}")), "volume ownership inspection must use Docker volume names");
    for (const entry of mock.calls.filter((value) => value.includes("/health/ready"))) {
      assert.match(entry, /Authorization: Bearer \$METRICS_TOKEN/, "readiness probes must not downgrade to unauthenticated checks");
    }
    assert.ok(mock.calls.includes("workspace:cleanup"));
    assert.ok(mock.calls.includes("interrupt:dispose"));

    const receipt = JSON.parse(readFileSync(receiptOutput, "utf8"));
    assert.equal(receipt.kind, "talktalk-local-forward-migration-compatibility");
    assert.equal(receipt.target.kind, "local-disposable");
    assert.equal(receipt.outcome, "passed");
    assert.equal(receipt.cleanup.compose, "passed");
    assert.equal(receipt.cleanup.workspace, "passed");
    assert.equal(receipt.target.redisDataDatabase, 15);
    assert.equal(receipt.target.resourcesVerifiedBeforeCleanup, 3);
    assert.ok(receipt.stages.some((stage) => stage.name === "previous-compiled-binary" && stage.status === "passed"));
    assert.ok(receipt.stages.some((stage) => stage.name === "candidate-runtime" && stage.status === "passed"));
    assert.doesNotMatch(JSON.stringify(receipt), /METRICS_TOKEN|postgresql:\/\/|redis:\/\//, "receipt must not archive runtime secrets or target connection strings");
    assert.equal(statSync(receiptOutput).mode & 0o777, 0o600, "receipt must be owner-readable only");
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

test("candidate migration failure starts neither post-migration app, writes a failed receipt, and still cleans only verified resources", async () => {
  const mock = mockRunner({ failCandidateMigration: true });
  let receipt;
  await assert.rejects(
    runMigrationCompatibility(runOptions(validEnvironment(), mock, {
      writeReceipt: (_output, value) => { receipt = value; }
    })),
    /candidate migrate failed/
  );
  const commands = mock.calls.filter((entry) => entry.startsWith("command:"));
  assert.equal(commands.some((entry) => entry.includes("previous-api-compatible")), false);
  assert.equal(commands.some((entry) => entry.includes("candidate-api")), false);
  assert.equal(commands.filter((entry) => entry.includes("down --volumes")).length, 1);
  assert.equal(receipt.outcome, "failed");
  assert.ok(receipt.stages.some((stage) => stage.name === "candidate-migrate-and-status" && stage.status === "failed"));
});

test("candidate migration-status failure starts neither post-migration app and records the same failed stage", async () => {
  const mock = mockRunner({ failCandidateMigrationStatus: true });
  let receipt;
  await assert.rejects(
    runMigrationCompatibility(runOptions(validEnvironment(), mock, {
      writeReceipt: (_output, value) => { receipt = value; }
    })),
    /candidate migrate status failed/
  );
  const commands = mock.calls.filter((entry) => entry.startsWith("command:"));
  assert.equal(commands.some((entry) => entry.includes("previous-api-compatible")), false);
  assert.equal(commands.some((entry) => entry.includes("candidate-api")), false);
  assert.equal(receipt.outcome, "failed");
  assert.ok(receipt.stages.some((stage) => stage.name === "candidate-migrate-and-status" && stage.status === "failed"));
});

test("a post-migration normal-old readiness failure never reaches raw-old or candidate runtime", async () => {
  const mock = mockRunner();
  let previousProbeCount = 0;
  let receipt;
  await assert.rejects(
    runMigrationCompatibility(runOptions(validEnvironment(), mock, {
      probeService: (service) => {
        if (service === "previous-api" && ++previousProbeCount === 2) throw new Error("previous normal readiness failed after migration");
      },
      writeReceipt: (_output, value) => { receipt = value; }
    })),
    /previous normal readiness failed after migration/
  );
  const commands = mock.calls.filter((entry) => entry.startsWith("command:"));
  assert.equal(commands.some((entry) => entry.includes("previous-api-compatible")), false);
  assert.equal(commands.some((entry) => entry.includes("candidate-api")), false);
  assert.ok(receipt.stages.some((stage) => stage.name === "previous-normal-after-candidate-migration" && stage.status === "failed"));
});

test("a raw-old readiness failure never starts candidate runtime", async () => {
  const mock = mockRunner();
  let receipt;
  await assert.rejects(
    runMigrationCompatibility(runOptions(validEnvironment(), mock, {
      probeService: (service) => {
        if (service === "previous-api-compatible") throw new Error("raw old readiness failed");
      },
      writeReceipt: (_output, value) => { receipt = value; }
    })),
    /raw old readiness failed/
  );
  assert.equal(mock.calls.some((entry) => entry.includes("up --detach --wait --pull never --no-build candidate-api")), false);
  assert.ok(receipt.stages.some((stage) => stage.name === "previous-compiled-binary" && stage.status === "failed"));
});

test("a candidate readiness failure produces a failed receipt and still cleans verified resources", async () => {
  const mock = mockRunner();
  let receipt;
  await assert.rejects(
    runMigrationCompatibility(runOptions(validEnvironment(), mock, {
      probeService: (service) => {
        if (service === "candidate-api") throw new Error("candidate readiness failed");
      },
      writeReceipt: (_output, value) => { receipt = value; }
    })),
    /candidate readiness failed/
  );
  assert.ok(mock.calls.some((entry) => entry.includes("up --detach --wait --pull never --no-build candidate-api")));
  assert.equal(mock.calls.filter((entry) => entry.includes("down --volumes")).length, 1);
  assert.equal(receipt.outcome, "failed");
  assert.ok(receipt.stages.some((stage) => stage.name === "candidate-runtime" && stage.status === "failed"));
});

test("a non-empty Redis DB15 stops before migrations and still reports a failed cleanup-safe run", async () => {
  const mock = mockRunner({ redisData15: "1" });
  let receipt;
  await assert.rejects(
    runMigrationCompatibility(runOptions(validEnvironment(), mock, {
      writeReceipt: (_output, value) => { receipt = value; }
    })),
    /Redis database 15 is not empty/
  );
  assert.equal(mock.calls.some((entry) => entry.includes("previous-migrate")), false);
  assert.equal(mock.calls.filter((entry) => entry.includes("down --volumes")).length, 1);
  assert.equal(receipt.outcome, "failed");
  assert.ok(receipt.stages.some((stage) => stage.name === "target-ownership" && stage.status === "failed"));
});

test("a non-table PostgreSQL object stops before ownership marking or migrations", async () => {
  const mock = mockRunner({ postgresObjectCount: "1" });
  let receipt;
  await assert.rejects(
    runMigrationCompatibility(runOptions(validEnvironment(), mock, {
      writeReceipt: (_output, value) => { receipt = value; }
    })),
    /PostgreSQL target contains non-system objects/
  );
  assert.equal(mock.calls.some((entry) => entry.includes("INSERT INTO _talktalk_migration_control.ownership")), false);
  assert.equal(mock.calls.some((entry) => entry.includes("previous-migrate")), false);
  assert.equal(receipt.outcome, "failed");
  assert.ok(receipt.stages.some((stage) => stage.name === "target-ownership" && stage.status === "failed"));
});

test("an image provenance mismatch stops before Compose configuration and leaves only a failed receipt", async () => {
  const mock = mockRunner({ badImageLabels: true });
  let receipt;
  await assert.rejects(
    runMigrationCompatibility(runOptions(validEnvironment(), mock, {
      writeReceipt: (_output, value) => { receipt = value; }
    })),
    /approved SHA/
  );
  assert.equal(mock.calls.some((entry) => entry.startsWith("command:")), false, "invalid artifact labels must stop before any Compose command");
  assert.ok(mock.calls.includes("workspace:cleanup"));
  assert.equal(receipt.outcome, "failed");
  assert.equal(receipt.cleanup.compose, "not-created");
});

test("resource-label mismatch refuses project cleanup instead of deleting an unverified resource", async () => {
  const mock = mockRunner({ resourceLabelsMismatch: true });
  let receipt;
  await assert.rejects(
    runMigrationCompatibility(runOptions(validEnvironment(), mock, {
      writeReceipt: (_output, value) => { receipt = value; }
    })),
    /not owned by this exact disposable run/
  );
  assert.equal(mock.calls.some((entry) => entry.includes("down --volumes")), false);
  assert.equal(receipt.outcome, "failed");
  assert.equal(receipt.cleanup.compose, "failed");
});

test("an empty ownership enumeration refuses to call down or issue a passed receipt", async () => {
  const mock = mockRunner({ noOwnedResources: true });
  let receipt;
  await assert.rejects(
    runMigrationCompatibility(runOptions(validEnvironment(), mock, {
      writeReceipt: (_output, value) => { receipt = value; }
    })),
    /cannot prove an owned container exists/
  );
  assert.equal(mock.calls.some((entry) => entry.includes("down --volumes")), false);
  assert.equal(receipt.outcome, "failed");
  assert.equal(receipt.cleanup.compose, "failed");
});

test("a remote Docker endpoint fails before toolchain, workspace, Docker, or receipt activity", async () => {
  const calls = [];
  await assert.rejects(
    runMigrationCompatibility({
      environment: validEnvironment({ DOCKER_HOST: "tcp://docker.example.test:2375" }),
      createWorkspace: () => calls.push("workspace"),
      resolveToolchain: () => calls.push("toolchain"),
      runCommand: () => calls.push("command"),
      runCapture: () => calls.push("capture"),
      verifyCheckout: () => calls.push("checkout"),
      writeReceipt: () => calls.push("receipt")
    }),
    /local Unix socket/
  );
  assert.deepEqual(calls, ["checkout"]);
});

test("a cleanup command failure cannot become a passed result or a passed receipt", async () => {
  const mock = mockRunner({ failCleanup: true });
  let receipt;
  await assert.rejects(
    runMigrationCompatibility(runOptions(validEnvironment(), mock, {
      writeReceipt: (_output, value) => { receipt = value; }
    })),
    /cleanup failed/
  );
  assert.equal(receipt.outcome, "failed");
  assert.equal(receipt.cleanup.compose, "failed");
  assert.ok(receipt.stages.some((stage) => stage.name === "cleanup-compose" && stage.status === "failed"));
});

test("a receipt-write failure cannot become a passed migration result", async () => {
  const mock = mockRunner();
  await assert.rejects(
    runMigrationCompatibility(runOptions(validEnvironment(), mock, {
      writeReceipt: () => { throw new Error("receipt output unavailable"); }
    })),
    /receipt output unavailable/
  );
  assert.equal(mock.calls.filter((entry) => entry.includes("down --volumes")).length, 1, "receipt failure happens only after verified cleanup");
});

test("a post-down owned resource refusal makes the receipt failed", async () => {
  const mock = mockRunner({ leaveResourcesAfterCleanup: true });
  let receipt;
  await assert.rejects(
    runMigrationCompatibility(runOptions(validEnvironment(), mock, {
      writeReceipt: (_output, value) => { receipt = value; }
    })),
    /left owned Docker resources behind/
  );
  assert.equal(receipt.outcome, "failed");
  assert.equal(receipt.cleanup.compose, "failed");
  assert.ok(mock.calls.filter((entry) => entry.startsWith("capture:ps -a")).length >= 2, "cleanup must enumerate resources before and after down");
});

test("migration interrupt controller latches one signal and removes only its own listeners", () => {
  const processRef = new EventEmitter();
  const unrelated = () => undefined;
  processRef.on("SIGINT", unrelated);
  const interrupt = createInterruptController(processRef);
  processRef.emit("SIGINT");
  processRef.emit("SIGTERM");
  assert.equal(interrupt.signal.aborted, true);
  assert.equal(interrupt.received(), "SIGINT");
  interrupt.dispose();
  assert.equal(processRef.listenerCount("SIGINT"), 1);
  assert.equal(processRef.listenerCount("SIGTERM"), 0);
});

test("migration Compose and launcher keep the fresh target private, labelled, authenticated, digest-only, and sealed", () => {
  const compose = readFileSync(composePath, "utf8");
  const launcher = readFileSync(launcherPath, "utf8");
  assert.match(compose, /pull_policy: never/);
  assert.match(compose, /migration-internal:\n    internal: true/);
  assert.doesNotMatch(compose, /^\s+ports:/m, "migration target must not expose any host ports");
  assert.doesNotMatch(compose, /^\s+build:/m);
  assert.doesNotMatch(compose, /privileged: true|network_mode: host|external: true|\/var\/run\/docker\.sock|MIGRATION_FIXTURE_/);
  assert.match(compose, /x-migration-compatibility-labels: &migration-compatibility-labels/);
  assert.ok((compose.match(/labels: \*migration-compatibility-labels/g) || []).length >= 10, "all services, network, and volumes must carry the exact ownership labels");
  assert.match(compose, /previous-api-compatible:[\s\S]*?entrypoint: \["\/usr\/local\/bin\/node"\][\s\S]*?command: \["dist\/src\/main\.js"\]/);
  assert.equal((compose.match(/Authorization: Bearer \$\$\{METRICS_TOKEN\}/g) || []).length, 3, "all API healthchecks must authenticate readiness");
  assert.match(launcher, /\/usr\/bin\/env -i/);
  assert.match(launcher, /NODE_OPTIONS must be empty/);
  assert.match(launcher, /DATABASE_URL must be empty/);
  assert.match(launcher, /MIGRATION_COMPATIBILITY_RECEIPT_OUT=/);
  assert.match(launcher, /MIGRATION_COMPATIBILITY_RUNNER_NODE_SHA256/);
  assert.match(launcher, /\/usr\/bin\/shasum -a 256/);
  assert.doesNotMatch(launcher, /\beval\b/, "launcher must not interpret hostile environment-variable values");
  assert.doesNotMatch(launcher, /DOCKER_CONTEXT="\$\{DOCKER_CONTEXT:-\}"/, "launcher must not forward a Docker context");
});

test("the POSIX launcher rejects hostile target/preload values without interpreting either", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "talk-and-talk-migration-launcher-test-"));
  const targetSentinel = join(temporaryDirectory, "target-must-not-exist");
  const preloadSentinel = join(temporaryDirectory, "preload-must-not-exist");
  const nodeSentinel = join(temporaryDirectory, "node-must-not-exist");
  const perlSentinel = join(temporaryDirectory, "perl-must-not-exist");
  const preload = join(temporaryDirectory, "hostile-preload.cjs");
  const hostileNode = join(temporaryDirectory, "hostile-node.sh");
  const hostilePerlModule = join(temporaryDirectory, "HostilePerl.pm");
  try {
    writeFileSync(preload, `require("node:fs").writeFileSync(${JSON.stringify(preloadSentinel)}, "executed");\n`);
    writeFileSync(hostileNode, `#!/bin/sh\n/usr/bin/touch ${JSON.stringify(nodeSentinel)}\n`);
    writeFileSync(hostilePerlModule, [
      "package HostilePerl;",
      `open(my $fh, \">\", ${JSON.stringify(perlSentinel)}) or die $!;`,
      "print $fh \"executed\";",
      "close($fh);",
      "1;"
    ].join("\n"));
    chmodSync(hostileNode, 0o755);
    const hostileTarget = spawnSync("/bin/sh", [launcherPath], {
      encoding: "utf8",
      env: {
        DATABASE_URL: `$(/usr/bin/touch ${targetSentinel})`,
        PATH: "/usr/bin:/bin"
      }
    });
    assert.notEqual(hostileTarget.status, 0);
    assert.match(`${hostileTarget.stderr}${hostileTarget.stdout}`, /DATABASE_URL must be empty/);
    assert.equal(existsSync(targetSentinel), false, "a rejected target value must remain data, never shell input");

    const hostilePreload = spawnSync("/bin/sh", [launcherPath], {
      encoding: "utf8",
      env: {
        MIGRATION_COMPATIBILITY_RUNNER_NODE_EXECUTABLE: process.execPath,
        NODE_OPTIONS: `--require=${preload}`,
        PATH: "/usr/bin:/bin"
      }
    });
    assert.notEqual(hostilePreload.status, 0);
    assert.match(`${hostilePreload.stderr}${hostilePreload.stdout}`, /NODE_OPTIONS must be empty/);
    assert.equal(existsSync(preloadSentinel), false, "the launcher must reject Node preload before Node can execute it");

    const hostileNodeDigest = spawnSync("/bin/sh", [launcherPath], {
      encoding: "utf8",
      env: {
        MIGRATION_COMPATIBILITY_RUNNER_NODE_EXECUTABLE: hostileNode,
        MIGRATION_COMPATIBILITY_RUNNER_NODE_SHA256: hash("0"),
        PATH: "/usr/bin:/bin"
      }
    });
    assert.notEqual(hostileNodeDigest.status, 0);
    assert.match(`${hostileNodeDigest.stderr}${hostileNodeDigest.stdout}`, /RUNNER_NODE_SHA256 does not match/);
    assert.equal(existsSync(nodeSentinel), false, "a mismatched Node path must be rejected before it can execute");

    const hostilePerl = spawnSync("/bin/sh", [launcherPath], {
      encoding: "utf8",
      env: {
        MIGRATION_COMPATIBILITY_RUNNER_NODE_EXECUTABLE: process.execPath,
        MIGRATION_COMPATIBILITY_RUNNER_NODE_SHA256: createHash("sha256").update(readFileSync(process.execPath)).digest("hex"),
        PERL5LIB: temporaryDirectory,
        PERL5OPT: "-MHostilePerl",
        PATH: "/usr/bin:/bin"
      }
    });
    assert.notEqual(hostilePerl.status, 0);
    assert.match(`${hostilePerl.stderr}${hostilePerl.stdout}`, /TARGET_KIND/);
    assert.equal(existsSync(perlSentinel), false, "the Node digest helper must not inherit Perl preload configuration");
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});
