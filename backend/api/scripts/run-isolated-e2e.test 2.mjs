import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createInterruptController, runIsolatedE2e } from "./run-isolated-e2e.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const runnerPath = join(scriptDirectory, "run-isolated-e2e.mjs");
const launcherPath = join(scriptDirectory, "run-isolated-e2e.sh");
const POSTGRES_IMAGE = "registry.example.test/talktalk/postgres@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REDIS_IMAGE = "registry.example.test/talktalk/redis@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const CANDIDATE_SHA = "cccccccccccccccccccccccccccccccccccccccc";
const CANDIDATE_SOURCE_TREE_SHA256 = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
const ENVIRONMENT_APPROVAL_REFERENCE = "E2E-LOCAL-APPROVAL-20260810";
const EXECUTION_AUTHORIZATION_EVIDENCE = `${ENVIRONMENT_APPROVAL_REFERENCE}-CI-API-E2E-1`;

function e2eAdmissionEnvironment() {
  const receiptDirectory = mkdtempSync(join(tmpdir(), "talk-and-talk-e2e-receipt-test-"));
  return {
    E2E_CANDIDATE_SHA: CANDIDATE_SHA,
    E2E_CANDIDATE_SOURCE_TREE_SHA256: CANDIDATE_SOURCE_TREE_SHA256,
    E2E_ENVIRONMENT_APPROVAL_REFERENCE: ENVIRONMENT_APPROVAL_REFERENCE,
    E2E_INFRA_IMAGES_EVIDENCE: "E2E-LOCAL-INFRA-20260810",
    E2E_POSTGRES_IMAGE: POSTGRES_IMAGE,
    E2E_RECEIPT_OUT: join(receiptDirectory, "receipt.json"),
    E2E_REDIS_IMAGE: REDIS_IMAGE
  };
}

function runnerOptions(runCommand, createInterrupt = undefined) {
  let nextPort = 55432;
  return {
    environment: {
      DOCKER_HOST: "unix:///tmp/talk-and-talk-e2e-test.sock",
      E2E_EXECUTION_AUTHORIZATION_EVIDENCE: EXECUTION_AUTHORIZATION_EVIDENCE,
      E2E_RUNNER_SEALED_LAUNCH: "1",
      ...e2eAdmissionEnvironment()
    },
    randomBytes: (size) => Buffer.alloc(size, 1),
    reservePort: async () => {
      const port = nextPort;
      nextPort += 1_947;
      return port;
    },
    resolveToolchain: () => ({
      dockerExecutable: "/trusted/docker",
      gitExecutable: "/trusted/git",
      nodeExecutable: "/trusted/node",
      npmCliPath: "/trusted/npm-cli.js",
      path: "/trusted:/usr/bin:/bin"
    }),
    runCommand,
    runCapture: async (_command, args) => ({ stdout: JSON.stringify([args.at(-1)]) }),
    verifyCandidateCheckout: (candidate) => {
      assert.deepEqual(candidate, {
        sha: CANDIDATE_SHA,
        sourceTreeSha256: CANDIDATE_SOURCE_TREE_SHA256
      });
      return { head: candidate.sha, sourceTreeSha256: candidate.sourceTreeSha256 };
    },
    writeReceipt: () => {},
    ...(createInterrupt ? { createInterruptController: createInterrupt } : {})
  };
}

function isComposePhase(args, phase) {
  return args[0] === "compose" && args.includes(phase);
}

test("signal handlers abort once and remove only their own listeners", () => {
  const fakeProcess = new EventEmitter();
  const interrupt = createInterruptController(fakeProcess);
  fakeProcess.emit("SIGTERM");
  fakeProcess.emit("SIGINT");

  assert.equal(interrupt.signal.aborted, true);
  assert.equal(interrupt.received(), "SIGTERM");
  interrupt.dispose();
  assert.equal(fakeProcess.listenerCount("SIGINT"), 0);
  assert.equal(fakeProcess.listenerCount("SIGTERM"), 0);
});

test("a partial Compose, migration, or Jest failure each triggers exactly one pinned cleanup", async () => {
  for (const failingPhase of ["up", "prisma:deploy", "test:e2e"]) {
    const calls = [];
    const runCommand = async (command, args, options) => {
      calls.push({ command, args, options });
      const matches = (failingPhase === "up" && isComposePhase(args, "up"))
        || (failingPhase !== "up" && args.includes(failingPhase));
      if (matches) throw new Error(`${failingPhase} failed`);
    };

    await assert.rejects(
      () => runIsolatedE2e(runnerOptions(runCommand)),
      new RegExp(`${failingPhase} failed`)
    );
    const cleanup = calls.filter((call) => isComposePhase(call.args, "down"));
    const up = calls.find((call) => isComposePhase(call.args, "up"));
    assert.equal(cleanup.length, 1, `${failingPhase} must clean up exactly once`);
    assert.equal(cleanup[0].options.abortSignal, undefined, `${failingPhase} cleanup must remain runnable after abort`);
    assert.equal(cleanup[0].options.env.DOCKER_HOST, "unix:///tmp/talk-and-talk-e2e-test.sock");
    assert.equal(cleanup[0].options.env.DOCKER_CONTEXT, undefined);
    assert.equal(cleanup[0].options.env, up.options.env, `${failingPhase} must reuse the exact pinned Docker environment`);
  }
});

test("an interrupted child returns the signal status only after its one cleanup", async () => {
  const processRef = new EventEmitter();
  const interrupt = createInterruptController(processRef);
  const calls = [];
  const runCommand = async (command, args, options) => {
    calls.push({ command, args, options });
    if (args.includes("claim:e2e:ownership")) {
      processRef.emit("SIGINT");
      throw new Error("child interrupted");
    }
  };

  const result = await runIsolatedE2e(runnerOptions(runCommand, () => interrupt));
  assert.equal(result.interrupted, "SIGINT");
  assert.equal(result.exitCode, 130);
  assert.equal(calls.filter((call) => isComposePhase(call.args, "down")).length, 1);
});

test("a repeated SIGINT during cleanup stays handled and cannot start a second cleanup", async () => {
  const processRef = new EventEmitter();
  const interrupt = createInterruptController(processRef);
  const calls = [];
  const runCommand = async (command, args, options) => {
    calls.push({ command, args, options });
    if (args.includes("claim:e2e:ownership")) {
      processRef.emit("SIGINT");
      throw new Error("child interrupted");
    }
    if (isComposePhase(args, "down")) {
      assert.equal(processRef.listenerCount("SIGINT"), 1, "the repeated signal must remain handled during cleanup");
      processRef.emit("SIGINT");
    }
  };

  const result = await runIsolatedE2e(runnerOptions(runCommand, () => interrupt));
  assert.equal(result.exitCode, 130);
  assert.equal(calls.filter((call) => isComposePhase(call.args, "down")).length, 1);
  assert.equal(processRef.listenerCount("SIGINT"), 0, "listeners must be released after cleanup");
});

test("cleanup failure does not replace the original workflow failure", async () => {
  const runCommand = async (_command, args) => {
    if (args.includes("prisma:deploy")) throw new Error("migration failed");
    if (isComposePhase(args, "down")) throw new Error("cleanup failed");
  };
  await assert.rejects(
    () => runIsolatedE2e(runnerOptions(runCommand)),
    /migration failed/
  );
});

test("a successful workflow returns its exact per-run database identity after cleanup", async () => {
  const result = await runIsolatedE2e(runnerOptions(async () => undefined));
  assert.equal(result.database, "talk_and_talk_010101010101010101010101_e2e");
  assert.equal(result.suite, "e2e");
  assert.equal(result.exitCode, 0);
});

test("immutable infra inputs refuse mutable or incomplete admission before ports, Docker, toolchain, or workspace", async () => {
  for (const environmentPatch of [
    { E2E_POSTGRES_IMAGE: "postgres:16-alpine" },
    { E2E_REDIS_IMAGE: "registry.example.test/talktalk/redis@sha256:not-a-digest" },
    { E2E_INFRA_IMAGES_EVIDENCE: "not-an-evidence-id" },
    { E2E_RECEIPT_OUT: undefined }
  ]) {
    let reserved = 0;
    let commands = 0;
    let captures = 0;
    let toolchains = 0;
    let workspaces = 0;
    const environment = { ...runnerOptions(async () => undefined).environment, ...environmentPatch };
    if (Object.hasOwn(environmentPatch, "E2E_RECEIPT_OUT") && environmentPatch.E2E_RECEIPT_OUT === undefined) {
      delete environment.E2E_RECEIPT_OUT;
    }
    await assert.rejects(() => runIsolatedE2e({
      environment,
      reservePort: async () => { reserved += 1; return 55432; },
      runCapture: async () => { captures += 1; },
      runCommand: async () => { commands += 1; },
      resolveToolchain: () => { toolchains += 1; return {}; },
      createWorkspace: () => { workspaces += 1; return {}; }
    }), /E2E_(?:POSTGRES_IMAGE|REDIS_IMAGE|INFRA_IMAGES_EVIDENCE|RECEIPT_OUT)/);
    assert.equal(reserved, 0);
    assert.equal(captures, 0);
    assert.equal(commands, 0);
    assert.equal(toolchains, 0);
    assert.equal(workspaces, 0);
  }
});

test("candidate SHA, source tree, approval, and execution binding refuse before ports, Docker, toolchain, workspace, or receipt", async () => {
  for (const { patch, expected } of [
    { patch: { E2E_CANDIDATE_SHA: undefined }, expected: /E2E_CANDIDATE_SHA/ },
    { patch: { E2E_CANDIDATE_SHA: "C".repeat(40) }, expected: /E2E_CANDIDATE_SHA/ },
    { patch: { E2E_CANDIDATE_SOURCE_TREE_SHA256: "z".repeat(64) }, expected: /E2E_CANDIDATE_SOURCE_TREE_SHA256/ },
    { patch: { E2E_ENVIRONMENT_APPROVAL_REFERENCE: undefined }, expected: /E2E_ENVIRONMENT_APPROVAL_REFERENCE/ },
    { patch: { E2E_ENVIRONMENT_APPROVAL_REFERENCE: "not-an-evidence-id" }, expected: /E2E_ENVIRONMENT_APPROVAL_REFERENCE/ },
    { patch: { E2E_EXECUTION_AUTHORIZATION_EVIDENCE: "E2E-OTHER-APPROVAL-20260810" }, expected: /must equal E2E_ENVIRONMENT_APPROVAL_REFERENCE/ }
  ]) {
    let candidateChecks = 0;
    let commands = 0;
    let captures = 0;
    let receipts = 0;
    let reserved = 0;
    let toolchains = 0;
    let workspaces = 0;
    const environment = { ...runnerOptions(async () => undefined).environment, ...patch };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete environment[key];
    }

    await assert.rejects(() => runIsolatedE2e({
      environment,
      verifyCandidateCheckout: () => { candidateChecks += 1; },
      reservePort: async () => { reserved += 1; return 55432; },
      runCapture: async () => { captures += 1; },
      runCommand: async () => { commands += 1; },
      resolveToolchain: () => { toolchains += 1; return {}; },
      createWorkspace: () => { workspaces += 1; return {}; },
      writeReceipt: () => { receipts += 1; }
    }), expected);
    assert.equal(candidateChecks, 0);
    assert.equal(commands, 0);
    assert.equal(captures, 0);
    assert.equal(receipts, 0);
    assert.equal(reserved, 0);
    assert.equal(toolchains, 0);
    assert.equal(workspaces, 0);
  }
});

test("a candidate checkout mismatch refuses before ports, Docker, toolchain, workspace, or receipt", async () => {
  let commands = 0;
  let captures = 0;
  let receipts = 0;
  let reserved = 0;
  let toolchains = 0;
  let workspaces = 0;
  await assert.rejects(() => runIsolatedE2e({
    environment: runnerOptions(async () => undefined).environment,
    verifyCandidateCheckout: () => { throw new Error("candidate source tree mismatch"); },
    reservePort: async () => { reserved += 1; return 55432; },
    runCapture: async () => { captures += 1; },
    runCommand: async () => { commands += 1; },
    resolveToolchain: () => { toolchains += 1; return {}; },
    createWorkspace: () => { workspaces += 1; return {}; },
    writeReceipt: () => { receipts += 1; }
  }), /candidate source tree mismatch/);
  assert.equal(commands, 0);
  assert.equal(captures, 0);
  assert.equal(receipts, 0);
  assert.equal(reserved, 0);
  assert.equal(toolchains, 0);
  assert.equal(workspaces, 0);
});

test("candidate checkout is verified before work and rechecked after tests", async () => {
  let candidateChecks = 0;
  let receipt = null;
  const options = runnerOptions(async () => undefined);
  options.verifyCandidateCheckout = (candidate) => {
    candidateChecks += 1;
    assert.deepEqual(candidate, {
      sha: CANDIDATE_SHA,
      sourceTreeSha256: CANDIDATE_SOURCE_TREE_SHA256
    });
    return { head: candidate.sha, sourceTreeSha256: candidate.sourceTreeSha256 };
  };
  options.writeReceipt = (_path, value) => { receipt = value; };

  await runIsolatedE2e(options);

  assert.equal(candidateChecks, 2);
  assert.deepEqual(receipt.stages.find((stage) => stage.name === "candidate-recheck"), {
    name: "candidate-recheck",
    status: "passed"
  });
});

test("a direct local execution may use the exact protected approval reference", async () => {
  const options = runnerOptions(async () => undefined);
  options.environment = {
    ...options.environment,
    E2E_EXECUTION_AUTHORIZATION_EVIDENCE: ENVIRONMENT_APPROVAL_REFERENCE
  };

  const result = await runIsolatedE2e(options);

  assert.equal(result.exitCode, 0);
});

test("a failed post-test candidate recheck still cleans up and records the failure receipt", async () => {
  const calls = [];
  let candidateChecks = 0;
  let receipt = null;
  const options = runnerOptions(async (command, args, commandOptions) => {
    calls.push({ command, args, commandOptions });
  });
  options.verifyCandidateCheckout = (candidate) => {
    candidateChecks += 1;
    if (candidateChecks === 2) throw new Error("candidate checkout changed after test");
    return { head: candidate.sha, sourceTreeSha256: candidate.sourceTreeSha256 };
  };
  options.writeReceipt = (_path, value) => { receipt = value; };

  await assert.rejects(() => runIsolatedE2e(options), /candidate checkout changed after test/);
  assert.equal(candidateChecks, 2);
  assert.equal(calls.filter((call) => isComposePhase(call.args, "down")).length, 1);
  assert.deepEqual(receipt.stages.find((stage) => stage.name === "candidate-recheck"), {
    errorCode: "UNCLASSIFIED_FAILURE",
    name: "candidate-recheck",
    status: "failed"
  });
  assert.equal(receipt.cleanup.compose, "passed");
  assert.equal(receipt.cleanup.workspace, "passed");
});

test("the runner validates exact local RepoDigests and uses no-pull no-build Compose commands", async () => {
  const calls = [];
  const captures = [];
  const options = runnerOptions(async (command, args, commandOptions) => {
    calls.push({ command, args, commandOptions });
  });
  options.runCapture = async (command, args, commandOptions) => {
    captures.push({ command, args, commandOptions });
    return { stdout: JSON.stringify([args.at(-1)]) };
  };

  await runIsolatedE2e(options);

  assert.equal(captures.length, 4, "both exact image digests must be inspected before and after the run");
  assert.deepEqual(captures.map((call) => call.args.at(-1)), [POSTGRES_IMAGE, REDIS_IMAGE, POSTGRES_IMAGE, REDIS_IMAGE]);
  const config = calls.find((call) => isComposePhase(call.args, "config"));
  const up = calls.find((call) => isComposePhase(call.args, "up"));
  const down = calls.find((call) => isComposePhase(call.args, "down"));
  for (const call of [config, up, down]) {
    assert.deepEqual(call.args.slice(0, 3), ["compose", "--env-file", "/dev/null"]);
    assert.equal(call.args.includes("--build"), false);
    assert.equal(call.args.includes("pull"), false);
  }
  assert.deepEqual(up.args.slice(-3), ["--pull", "never", "--no-build"]);
  assert.equal(up.commandOptions.env.E2E_POSTGRES_IMAGE, POSTGRES_IMAGE);
  assert.equal(up.commandOptions.env.E2E_REDIS_IMAGE, REDIS_IMAGE);
});

test("postgres-preflight selects only the sealed PostgreSQL suite and injects every exact database alias", async () => {
  const calls = [];
  const options = runnerOptions(async (command, args, commandOptions) => {
    calls.push({ command, args, commandOptions });
  });
  options.environment = { ...options.environment, E2E_RUNNER_SUITE: "postgres-preflight" };

  const result = await runIsolatedE2e(options);
  const postgresPreflight = calls.find((call) => call.args.includes("test:preflight:postgres"));
  assert.ok(postgresPreflight);
  assert.equal(calls.some((call) => call.args.includes("test:e2e")), false);
  assert.equal(result.suite, "postgres-preflight");
  for (const key of [
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
  ]) assert.equal(postgresPreflight.commandOptions.env[key], postgresPreflight.commandOptions.env.DATABASE_URL, key);
});

test("the non-secret receipt records immutable inputs and cleanup but never URLs or ownership tokens", async () => {
  let output = null;
  let receipt = null;
  const options = runnerOptions(async () => undefined);
  options.now = () => new Date("2026-08-10T00:00:00.000Z");
  options.writeReceipt = (path, value) => { output = path; receipt = value; };

  await runIsolatedE2e(options);
  assert.match(output, /\/receipt\.json$/, "the runner may canonicalize macOS /var aliases for the external receipt path");
  assert.equal(receipt.infrastructure.postgresImage, POSTGRES_IMAGE);
  assert.equal(receipt.infrastructure.redisImage, REDIS_IMAGE);
  assert.equal(receipt.schemaVersion, 2);
  assert.deepEqual(receipt.candidate, {
    sha: CANDIDATE_SHA,
    sourceTreeSha256: CANDIDATE_SOURCE_TREE_SHA256
  });
  assert.equal(receipt.authorization.approvalReference, ENVIRONMENT_APPROVAL_REFERENCE);
  assert.equal(receipt.authorization.executionEvidence, EXECUTION_AUTHORIZATION_EVIDENCE);
  assert.equal(receipt.cleanup.compose, "passed");
  assert.equal(receipt.cleanup.workspace, "passed");
  const serialized = JSON.stringify(receipt);
  assert.doesNotMatch(serialized, /postgresql:|redis:\/\/|0101010101010101010101010101010101010101010101010101010101010101/);
  assert.doesNotMatch(serialized, /E2E_OWNERSHIP_TOKEN|DOCKER_HOST/);
});

test("a receipt write failure converts an otherwise successful run to failure", async () => {
  const options = runnerOptions(async () => undefined);
  options.writeReceipt = () => { throw new Error("receipt write failed"); };
  await assert.rejects(() => runIsolatedE2e(options), /receipt write failed/);
});

test("an absent or malformed execution record refuses before ports, Docker, or child commands", async () => {
  for (const evidence of [undefined, "not-an-evidence-id"]) {
    let reserved = 0;
    let commands = 0;
    let toolchains = 0;
    let workspaces = 0;
    await assert.rejects(
      () => runIsolatedE2e({
        environment: {
          DOCKER_HOST: "unix:///tmp/talk-and-talk-e2e-test.sock",
          E2E_RUNNER_SEALED_LAUNCH: "1",
          ...(evidence === undefined ? {} : { E2E_EXECUTION_AUTHORIZATION_EVIDENCE: evidence })
        },
        reservePort: async () => {
          reserved += 1;
          return 55432;
        },
        runCommand: async () => {
          commands += 1;
        },
        resolveToolchain: () => {
          toolchains += 1;
          return {};
        },
        createWorkspace: () => {
          workspaces += 1;
          return {};
        }
      }),
      /E2E_EXECUTION_AUTHORIZATION_EVIDENCE/
    );
    assert.equal(reserved, 0);
    assert.equal(commands, 0);
    assert.equal(toolchains, 0);
    assert.equal(workspaces, 0);
  }
});

test("the runner requires an explicit local Docker host and rejects host preload options before commands", async () => {
  for (const environment of [
    {
      E2E_EXECUTION_AUTHORIZATION_EVIDENCE: EXECUTION_AUTHORIZATION_EVIDENCE,
      E2E_RUNNER_SEALED_LAUNCH: "1",
      ...e2eAdmissionEnvironment()
    },
    {
      DOCKER_CONTEXT: "desktop-linux",
      DOCKER_HOST: "unix:///tmp/talk-and-talk-e2e-test.sock",
      E2E_EXECUTION_AUTHORIZATION_EVIDENCE: EXECUTION_AUTHORIZATION_EVIDENCE,
      E2E_RUNNER_SEALED_LAUNCH: "1",
      ...e2eAdmissionEnvironment()
    },
    {
      DOCKER_HOST: "unix:///tmp/talk-and-talk-e2e-test.sock",
      E2E_EXECUTION_AUTHORIZATION_EVIDENCE: EXECUTION_AUTHORIZATION_EVIDENCE,
      E2E_RUNNER_SEALED_LAUNCH: "1",
      NODE_OPTIONS: "--require=/tmp/hostile.cjs",
      ...e2eAdmissionEnvironment()
    }
  ]) {
    let commands = 0;
    await assert.rejects(
      () => runIsolatedE2e({
        environment,
        verifyCandidateCheckout: () => ({ head: CANDIDATE_SHA, sourceTreeSha256: CANDIDATE_SOURCE_TREE_SHA256 }),
        runCommand: async () => {
          commands += 1;
        }
      }),
      /Docker|DOCKER|NODE_OPTIONS/
    );
    assert.equal(commands, 0);
  }
});

test("the exported runner requires the sealed launcher marker before any setup", async () => {
  let commands = 0;
  let toolchains = 0;
  await assert.rejects(
    () => runIsolatedE2e({
      environment: {
        DOCKER_HOST: "unix:///tmp/talk-and-talk-e2e-test.sock",
        E2E_EXECUTION_AUTHORIZATION_EVIDENCE: "E2E-LOCAL-TEST-20260809"
      },
      runCommand: async () => {
        commands += 1;
      },
      resolveToolchain: () => {
        toolchains += 1;
        return {};
      }
    }),
    /documented POSIX E2E launcher/
  );
  assert.equal(commands, 0);
  assert.equal(toolchains, 0);
});

test("the shell launcher forwards the candidate identity and approval through its sealed allowlist", () => {
  const launcher = readFileSync(launcherPath, "utf8");
  for (const key of [
    "E2E_CANDIDATE_SHA",
    "E2E_CANDIDATE_SOURCE_TREE_SHA256",
    "E2E_ENVIRONMENT_APPROVAL_REFERENCE"
  ]) {
    assert.match(launcher, new RegExp(`${key}="\\$\\{${key}:-\\}"`));
  }
});

test("the shell launcher rejects NODE_OPTIONS before a Node preload can execute", () => {
  const directory = mkdtempSync(join(tmpdir(), "talk-and-talk-e2e-launcher-test-"));
  const sentinel = join(directory, "preload.cjs");
  const marker = join(directory, "preload-ran");
  writeFileSync(sentinel, `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran");`, "utf8");

  try {
    const result = spawnSync("/bin/sh", [launcherPath], {
      cwd: scriptDirectory,
      encoding: "utf8",
      env: {
        E2E_EXECUTION_AUTHORIZATION_EVIDENCE: "E2E-LOCAL-TEST-20260809",
        DOCKER_HOST: "unix:///tmp/talk-and-talk-e2e-test.sock",
        NODE_OPTIONS: `--require=${sentinel}`,
        E2E_RUNNER_NODE_EXECUTABLE: process.execPath
      }
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /NODE_OPTIONS must be empty/);
    assert.equal(existsSync(marker), false, "the preload must not run before launcher rejection");
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("the raw Node entrypoint refuses an absent sealed launcher marker before runner setup", () => {
  const result = spawnSync(process.execPath, [runnerPath], {
    cwd: scriptDirectory,
    encoding: "utf8",
    env: {
      DOCKER_HOST: "unix:///tmp/talk-and-talk-e2e-test.sock",
      E2E_EXECUTION_AUTHORIZATION_EVIDENCE: "E2E-LOCAL-TEST-20260809",
      NODE_OPTIONS: "",
      NODE_PATH: ""
    }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /documented POSIX E2E launcher/);
});

test("the runner seals app and Docker command environments against hostile host configuration", async () => {
  const calls = [];
  const options = runnerOptions(async (command, args, commandOptions) => {
    calls.push({ command, args, commandOptions });
  });
  options.environment = {
    ...options.environment,
    CORS_ORIGINS: "https://hostile.example.test",
    DATABASE_URL: "postgresql://hostile.example.test/prod",
    NOTIFICATION_DELIVERY_ENABLED: "true",
    PATH: "/tmp/hostile-bin",
    HOME: "/tmp/hostile-home",
    SHELL: "/tmp/hostile-shell",
    DOCKER_CONFIG: "/tmp/hostile-docker-config",
    WECHAT_PAY_PRIVATE_KEY: "hostile-test-value",
    SHADOW_DATABASE_URL: "postgresql://hostile.example.test/shadow"
  };

  await runIsolatedE2e(options);
  const up = calls.find((call) => isComposePhase(call.args, "up"));
  const claim = calls.find((call) => call.args.includes("claim:e2e:ownership"));

  assert.equal(up.command, "/trusted/docker");
  assert.equal(claim.command, "/trusted/node");
  assert.equal(claim.args[0], "/trusted/npm-cli.js");

  const applicationEnvironment = claim.commandOptions.env;
  assert.equal(applicationEnvironment.DATABASE_URL, "postgresql://talk:talk@127.0.0.1:55432/talk_and_talk_010101010101010101010101_e2e");
  assert.equal(applicationEnvironment.E2E_POSTGRES_PORT, "55432");
  assert.equal(applicationEnvironment.E2E_REDIS_PORT, "57379");
  assert.equal(applicationEnvironment.CORS_ORIGINS, "http://localhost:3000");
  assert.equal(applicationEnvironment.NOTIFICATION_DELIVERY_ENABLED, "false");
  assert.equal(applicationEnvironment.WECHAT_PAY_PRIVATE_KEY, "");
  assert.equal(applicationEnvironment.SHADOW_DATABASE_URL, "");

  for (const environment of [up.commandOptions.env, applicationEnvironment]) {
    assert.notEqual(environment.PATH, "/tmp/hostile-bin");
    assert.notEqual(environment.HOME, "/tmp/hostile-home");
    assert.notEqual(environment.DOCKER_CONFIG, "/tmp/hostile-docker-config");
    assert.equal(environment.SHELL, undefined);
  }
  assert.equal(up.commandOptions.env.DOCKER_CONTEXT, undefined);
  assert.equal(up.commandOptions.env.DATABASE_URL, undefined);
  assert.equal(up.commandOptions.env.E2E_EXECUTION_AUTHORIZATION_EVIDENCE, undefined);
  assert.equal(up.commandOptions.env.E2E_OWNERSHIP_TOKEN, undefined);
  assert.equal(applicationEnvironment.E2E_EXECUTION_AUTHORIZATION_EVIDENCE, EXECUTION_AUTHORIZATION_EVIDENCE);
});
