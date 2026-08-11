import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { assertCandidateInputPolicy } from "../../../scripts/candidate-input-policy.mjs";
import { hashCandidateSourceTree, stableJson } from "../../../scripts/candidate-source-tree.mjs";

const require = createRequire(import.meta.url);
const {
  assertDisposableE2eEnvironment,
  assertE2eExecutionAuthorization
} = require("./assert-disposable-e2e-environment.cjs");
const { ISOLATED_E2E_SAFETY_OVERRIDES } = require("./isolated-e2e-safe-runtime.cjs");
const { resolveLocalDockerEnvironment } = require("./local-docker-endpoint.cjs");

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const apiDirectory = resolve(repositoryRoot, "backend/api");
const composeFile = resolve(repositoryRoot, "infra/docker-compose.e2e.yml");
const E2E_RUNNER_SUITES = new Set(["e2e", "postgres-preflight"]);
const EVIDENCE_PATTERN = /^E[A-Z0-9]*(?:-[A-Z0-9][A-Z0-9._-]*)+$/;
const IMMUTABLE_IMAGE_PATTERN = /^[a-z0-9][a-z0-9._/:-]*@sha256:[0-9a-f]{64}$/;
const CANDIDATE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const CANDIDATE_SOURCE_TREE_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const POSTGRES_PREFLIGHT_DATABASE_KEYS = Object.freeze([
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

function runnerFail(message) {
  const error = new Error(message);
  error.code = "ISOLATED_E2E_RUNNER_ERROR";
  throw error;
}

function pathInside(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function requiredImmutableImage(sourceEnvironment, key) {
  const image = String(sourceEnvironment[key] ?? "").trim();
  if (!IMMUTABLE_IMAGE_PATTERN.test(image) || image.includes("//") || image.includes("..")) {
    runnerFail(`${key} must be an immutable lower-case OCI image reference ending in @sha256:<64-hex>`);
  }
  return image;
}

function requiredEvidence(sourceEnvironment, key) {
  const evidence = String(sourceEnvironment[key] ?? "").trim();
  if (!EVIDENCE_PATTERN.test(evidence)) {
    runnerFail(`${key} must be a canonical non-secret Evidence ID`);
  }
  return evidence;
}

function requiredCandidateSha(sourceEnvironment) {
  const candidateSha = String(sourceEnvironment.E2E_CANDIDATE_SHA ?? "").trim();
  if (!CANDIDATE_SHA_PATTERN.test(candidateSha)) {
    runnerFail("E2E_CANDIDATE_SHA must be an exact lowercase 40-character Git SHA");
  }
  return candidateSha;
}

function requiredCandidateSourceTreeSha256(sourceEnvironment) {
  const sourceTreeSha256 = String(sourceEnvironment.E2E_CANDIDATE_SOURCE_TREE_SHA256 ?? "").trim();
  if (!CANDIDATE_SOURCE_TREE_SHA256_PATTERN.test(sourceTreeSha256)) {
    runnerFail("E2E_CANDIDATE_SOURCE_TREE_SHA256 must be an exact lowercase 64-character SHA-256");
  }
  return sourceTreeSha256;
}

function assertExecutionAuthorizationMatchesApproval(approvalReference, executionEvidence) {
  if (executionEvidence === approvalReference) return executionEvidence;
  const ciPrefix = `${approvalReference}-CI-`;
  if (executionEvidence.startsWith(ciPrefix) && executionEvidence.length > ciPrefix.length) return executionEvidence;
  runnerFail(
    "E2E_EXECUTION_AUTHORIZATION_EVIDENCE must equal E2E_ENVIRONMENT_APPROVAL_REFERENCE or append -CI-<run> to it"
  );
}

function requiredReceiptOutput(sourceEnvironment) {
  const requested = String(sourceEnvironment.E2E_RECEIPT_OUT ?? "").trim();
  if (!requested || !isAbsolute(requested)) {
    runnerFail("E2E_RECEIPT_OUT must be a new absolute path outside the repository");
  }
  const lexical = resolve(requested);
  if (pathInside(repositoryRoot, lexical) || existsSync(lexical)) {
    runnerFail("E2E_RECEIPT_OUT must name a new file outside the repository");
  }
  const parent = dirname(lexical);
  try {
    if (lstatSync(parent).isSymbolicLink()) runnerFail("E2E_RECEIPT_OUT parent must not be a symbolic link");
    const canonicalParent = realpathSync(parent);
    if (!statSync(canonicalParent).isDirectory() || pathInside(repositoryRoot, canonicalParent)) {
      runnerFail("E2E_RECEIPT_OUT parent must be an existing real directory outside the repository");
    }
    return join(canonicalParent, basename(lexical));
  } catch (error) {
    if (error?.code === "ISOLATED_E2E_RUNNER_ERROR") throw error;
    runnerFail("E2E_RECEIPT_OUT parent must be an existing real directory outside the repository");
  }
}

function isolatedE2ePlan(sourceEnvironment) {
  const authorizationEvidence = requiredEvidence(sourceEnvironment, "E2E_EXECUTION_AUTHORIZATION_EVIDENCE");
  const approvalReference = requiredEvidence(sourceEnvironment, "E2E_ENVIRONMENT_APPROVAL_REFERENCE");
  return Object.freeze({
    authorizationEvidence,
    approvalReference,
    candidate: Object.freeze({
      sha: requiredCandidateSha(sourceEnvironment),
      sourceTreeSha256: requiredCandidateSourceTreeSha256(sourceEnvironment)
    }),
    infrastructure: Object.freeze({
      artifactEvidence: requiredEvidence(sourceEnvironment, "E2E_INFRA_IMAGES_EVIDENCE"),
      postgresImage: requiredImmutableImage(sourceEnvironment, "E2E_POSTGRES_IMAGE"),
      redisImage: requiredImmutableImage(sourceEnvironment, "E2E_REDIS_IMAGE")
    }),
    receiptOutput: requiredReceiptOutput(sourceEnvironment),
    suite: isolatedE2eSuite(sourceEnvironment)
  });
}

function canonicalRegularFile(candidate, label, executable = false) {
  try {
    const canonical = realpathSync(candidate);
    const metadata = statSync(canonical);
    if (!metadata.isFile() || (executable && (metadata.mode & 0o111) === 0)) {
      throw new Error("not a regular executable file");
    }
    return canonical;
  } catch {
    throw new Error(`${label} must resolve to a trusted absolute regular file`);
  }
}

function firstCanonicalRegularFile(candidates, label, executable = false) {
  for (const candidate of candidates) {
    try {
      return canonicalRegularFile(candidate, label, executable);
    } catch {
      // Continue only through the runner-owned absolute path allowlist. Never
      // consult PATH, a shell alias, npm config, or a caller-provided command.
    }
  }
  throw new Error(`${label} was not found in the isolated E2E runner allowlist`);
}

function trustedGitExecutable() {
  return firstCanonicalRegularFile([
    "/usr/bin/git",
    "/usr/local/bin/git",
    "/opt/homebrew/bin/git"
  ], "Git CLI", true);
}

function trustedGitResult(gitExecutable, root, args, { allowFailure = false } = {}) {
  const result = spawnSync(gitExecutable, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    env: {
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      HOME: "/tmp",
      LANG: "C",
      LC_ALL: "C",
      NODE_OPTIONS: "",
      NODE_PATH: "",
      PATH: "/usr/bin:/bin"
    }
  });
  if (result.error) runnerFail(`Unable to run trusted git ${args.join(" ")}: ${result.error.message}`);
  const status = result.status ?? 1;
  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");
  if (status !== 0 && !allowFailure) {
    const detail = `${stdout}${stderr}`.trim();
    runnerFail(`trusted git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
  return Object.freeze({ status, stderr, stdout });
}

function trustedGitText(gitExecutable, root, args) {
  return trustedGitResult(gitExecutable, root, args).stdout.trim();
}

/**
 * Bind the destructive local E2E action to the frozen candidate without
 * reusing the GitHub-only identity verifier. This runner deliberately proves
 * the checkout mechanics it can observe (fixed root, detached/clean head,
 * self-contained source tree) but does not claim to prove a remote approval.
 */
function assertCandidateCheckout(candidate, { gitExecutable = trustedGitExecutable() } = {}) {
  let fixedRoot;
  let checkoutRoot;
  try {
    fixedRoot = realpathSync(repositoryRoot);
    checkoutRoot = realpathSync(trustedGitText(gitExecutable, fixedRoot, ["rev-parse", "--show-toplevel"]));
  } catch (error) {
    if (error?.code === "ISOLATED_E2E_RUNNER_ERROR") throw error;
    runnerFail(`Unable to resolve the fixed candidate checkout root: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (checkoutRoot !== fixedRoot) {
    runnerFail(`Isolated E2E must run from its fixed repository root, not ${checkoutRoot}`);
  }

  const head = trustedGitText(gitExecutable, fixedRoot, ["rev-parse", "HEAD"]);
  if (head !== candidate.sha) runnerFail(`Candidate checkout HEAD ${head} does not match E2E_CANDIDATE_SHA ${candidate.sha}`);

  const symbolicRef = trustedGitResult(gitExecutable, fixedRoot, ["symbolic-ref", "-q", "--short", "HEAD"], { allowFailure: true });
  if (symbolicRef.status === 0) {
    runnerFail(`Candidate checkout must be detached; HEAD is attached to ${symbolicRef.stdout.trim()}`);
  }
  if (symbolicRef.status !== 1) {
    const detail = `${symbolicRef.stdout}${symbolicRef.stderr}`.trim();
    runnerFail(`Unable to confirm that candidate checkout is detached${detail ? `: ${detail}` : ""}`);
  }

  const status = trustedGitText(gitExecutable, fixedRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status) runnerFail(`Candidate checkout is dirty or contains untracked files:\n${status}`);
  const diffCheck = trustedGitText(gitExecutable, fixedRoot, ["diff", "--check"]);
  if (diffCheck) runnerFail("Candidate checkout failed git diff --check");
  assertCandidateInputPolicy({
    gitText(args) {
      return trustedGitText(gitExecutable, fixedRoot, args);
    },
    fail: runnerFail
  });

  let sourceTreeSha256;
  try {
    sourceTreeSha256 = hashCandidateSourceTree(
      fixedRoot,
      trustedGitText(gitExecutable, fixedRoot, ["ls-tree", "-r", "HEAD"])
    ).treeSha256;
  } catch (error) {
    if (error?.code === "ISOLATED_E2E_RUNNER_ERROR") throw error;
    runnerFail(`Unable to hash the candidate source tree: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (sourceTreeSha256 !== candidate.sourceTreeSha256) {
    runnerFail(
      `Candidate source tree SHA-256 ${sourceTreeSha256} does not match E2E_CANDIDATE_SOURCE_TREE_SHA256 ${candidate.sourceTreeSha256}`
    );
  }
  return Object.freeze({ head, sourceTreeSha256 });
}

export function resolveIsolatedE2eToolchain() {
  const nodeExecutable = canonicalRegularFile(process.execPath, "Node.js", true);
  const nodePrefix = resolve(dirname(nodeExecutable), "..");
  const npmCliPath = firstCanonicalRegularFile([
    resolve(nodePrefix, "lib/node_modules/npm/bin/npm-cli.js"),
    resolve(nodePrefix, "node_modules/npm/bin/npm-cli.js"),
    "/usr/local/lib/node_modules/npm/bin/npm-cli.js",
    "/opt/homebrew/lib/node_modules/npm/bin/npm-cli.js"
  ], "npm CLI");
  const dockerExecutable = firstCanonicalRegularFile([
    "/usr/local/bin/docker",
    "/opt/homebrew/bin/docker",
    "/usr/bin/docker",
    "/snap/bin/docker",
    "/Applications/Docker.app/Contents/Resources/bin/docker"
  ], "Docker CLI", true);

  return Object.freeze({
    dockerExecutable,
    gitExecutable: trustedGitExecutable(),
    nodeExecutable,
    npmCliPath,
    path: [dirname(nodeExecutable), "/usr/bin", "/bin"].join(":")
  });
}

function assertRunnerHostEnvironment(sourceEnvironment) {
  if (String(sourceEnvironment.NODE_OPTIONS ?? "").trim()) {
    throw new Error("NODE_OPTIONS must be empty before the isolated E2E runner can create evidence");
  }
}

function isolatedE2eSuite(sourceEnvironment) {
  const suite = String(sourceEnvironment.E2E_RUNNER_SUITE ?? "e2e").trim() || "e2e";
  if (!E2E_RUNNER_SUITES.has(suite)) {
    throw new Error("E2E_RUNNER_SUITE must be e2e or postgres-preflight");
  }
  return suite;
}

function createIsolatedE2eWorkspace(toolchain) {
  const root = mkdtempSync(join(tmpdir(), "talk-and-talk-isolated-e2e-"));
  const home = join(root, "home");
  const temporaryDirectory = join(root, "tmp");
  const dockerConfig = join(root, "docker-config");
  const xdgConfig = join(root, "xdg-config");
  const npmCache = join(root, "npm-cache");
  for (const directory of [home, temporaryDirectory, dockerConfig, xdgConfig, npmCache]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }

  return Object.freeze({
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    runtimeEnvironment: Object.freeze({
      DOCKER_CONFIG: dockerConfig,
      HOME: home,
      LANG: "C.UTF-8",
      NPM_CONFIG_CACHE: npmCache,
      NPM_CONFIG_GLOBALCONFIG: "/dev/null",
      NPM_CONFIG_UPDATE_NOTIFIER: "false",
      NPM_CONFIG_USERCONFIG: join(home, ".npmrc"),
      PATH: toolchain.path,
      TEMP: temporaryDirectory,
      TMP: temporaryDirectory,
      TMPDIR: temporaryDirectory,
      XDG_CONFIG_HOME: xdgConfig
    })
  });
}

export function buildIsolatedE2eEnvironment({
  executionAuthorizationEvidence,
  runId,
  ownershipToken,
  postgresPort,
  redisPort,
  runtimeEnvironment,
  suite = "e2e"
}) {
  const database = `talk_and_talk_${runId}_e2e`;
  const environment = {
    ...runtimeEnvironment,
    ...ISOLATED_E2E_SAFETY_OVERRIDES,
    DATABASE_URL: `postgresql://talk:talk@127.0.0.1:${postgresPort}/${database}`,
    REDIS_URL: `redis://127.0.0.1:${redisPort}/15`,
    E2E_DATABASE_RESET_ALLOWED: "1",
    E2E_EXECUTION_AUTHORIZATION_EVIDENCE: executionAuthorizationEvidence,
    E2E_ENVIRONMENT_ISSUER: "local-runner",
    E2E_OWNERSHIP_TOKEN: ownershipToken,
    E2E_REDIS_FLUSH_ALLOWED: "1",
    E2E_REDIS_OWNERSHIP_URL: `redis://127.0.0.1:${redisPort}/14`,
    E2E_RUN_ID: runId,
    E2E_RUNNER_SUITE: suite,
    E2E_POSTGRES_DATABASE: database,
    E2E_POSTGRES_PORT: String(postgresPort),
    E2E_REDIS_PORT: String(redisPort)
  };
  if (suite === "postgres-preflight") {
    for (const key of POSTGRES_PREFLIGHT_DATABASE_KEYS) environment[key] = environment.DATABASE_URL;
  }
  return Object.freeze(environment);
}

function buildIsolatedDockerEnvironment(applicationEnvironment, localDockerEnvironment, infrastructure) {
  return Object.freeze({
    DOCKER_CONFIG: applicationEnvironment.DOCKER_CONFIG,
    DOCKER_HOST: localDockerEnvironment.DOCKER_HOST,
    E2E_POSTGRES_IMAGE: infrastructure.postgresImage,
    E2E_POSTGRES_DATABASE: applicationEnvironment.E2E_POSTGRES_DATABASE,
    E2E_POSTGRES_PORT: applicationEnvironment.E2E_POSTGRES_PORT,
    E2E_REDIS_IMAGE: infrastructure.redisImage,
    E2E_REDIS_PORT: applicationEnvironment.E2E_REDIS_PORT,
    HOME: applicationEnvironment.HOME,
    LANG: applicationEnvironment.LANG,
    PATH: applicationEnvironment.PATH,
    TEMP: applicationEnvironment.TEMP,
    TMP: applicationEnvironment.TMP,
    TMPDIR: applicationEnvironment.TMPDIR,
    XDG_CONFIG_HOME: applicationEnvironment.XDG_CONFIG_HOME
  });
}

function command(commandName, args, options) {
  return new Promise((resolveCommand, rejectCommand) => {
    if (options.abortSignal?.aborted) {
      rejectCommand(new Error(`Interrupted before ${commandName} could start`));
      return;
    }
    let settled = false;
    const child = spawn(commandName, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: "inherit",
      detached: process.platform !== "win32"
    });
    let killTimer = null;

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      options.abortSignal?.removeEventListener("abort", interruptChild);
      if (killTimer) clearTimeout(killTimer);
      callback();
    };
    const interruptChild = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
      killTimer = setTimeout(() => {
        if (settled || child.exitCode !== null || child.signalCode !== null) return;
        try {
          if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }, 5_000);
      killTimer.unref?.();
    };
    options.abortSignal?.addEventListener("abort", interruptChild, { once: true });

    child.once("error", (error) => {
      finish(() => rejectCommand(new Error(`Unable to run ${commandName}: ${error.message}`)));
    });
    child.once("exit", (code, signal) => {
      if (code === 0) {
        finish(resolveCommand);
        return;
      }
      finish(() => rejectCommand(new Error(`${commandName} ${args.join(" ")} failed with ${signal ?? `exit ${code}`}`)));
    });
  });
}

function captureCommand(commandName, args, options) {
  return new Promise((resolveCommand, rejectCommand) => {
    if (options.abortSignal?.aborted) {
      rejectCommand(new Error(`Interrupted before ${commandName} could start`));
      return;
    }
    const child = spawn(commandName, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32"
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let killTimer = null;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      options.abortSignal?.removeEventListener("abort", interruptChild);
      if (killTimer) clearTimeout(killTimer);
      callback();
    };
    const interruptChild = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
      killTimer = setTimeout(() => {
        if (settled || child.exitCode !== null || child.signalCode !== null) return;
        try {
          if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }, 5_000);
      killTimer.unref?.();
    };
    options.abortSignal?.addEventListener("abort", interruptChild, { once: true });
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", (error) => {
      finish(() => rejectCommand(new Error(`Unable to run ${commandName}: ${error.message}`)));
    });
    child.once("exit", (code, signal) => {
      if (code === 0) {
        finish(() => resolveCommand({ stderr, stdout }));
        return;
      }
      finish(() => rejectCommand(new Error(`${commandName} ${args.join(" ")} failed with ${signal ?? `exit ${code}`}: ${stderr.trim()}`)));
    });
  });
}

function composeArguments(project, args) {
  return ["compose", "--env-file", "/dev/null", "-p", project, "-f", composeFile, ...args];
}

function assertExactRepoDigest(output, expectedImage) {
  let digests;
  try {
    digests = JSON.parse(String(output?.stdout ?? output ?? "").trim() || "null");
  } catch {
    runnerFail(`Immutable E2E image ${expectedImage} did not return parseable RepoDigests`);
  }
  if (!Array.isArray(digests) || !digests.includes(expectedImage)) {
    runnerFail(`Immutable E2E image ${expectedImage} is not locally available under its exact approved RepoDigest`);
  }
}

async function verifyPinnedInfrastructureImages(infrastructure, toolchain, dockerEnvironment, runCapture, abortSignal) {
  for (const image of [infrastructure.postgresImage, infrastructure.redisImage]) {
    const result = await runCapture(toolchain.dockerExecutable, ["image", "inspect", "--format", "{{json .RepoDigests}}", image], {
      abortSignal,
      cwd: repositoryRoot,
      env: dockerEnvironment
    });
    assertExactRepoDigest(result, image);
  }
}

function receiptErrorCode(error) {
  const candidate = String(error?.code ?? "");
  return /^[A-Z][A-Z0-9_:-]{1,80}$/.test(candidate) ? candidate : "UNCLASSIFIED_FAILURE";
}

function createStageTracker() {
  const stages = [];
  return {
    stages,
    async run(name, callback) {
      try {
        const result = await callback();
        stages.push(Object.freeze({ name, status: "passed" }));
        return result;
      } catch (error) {
        stages.push(Object.freeze({ errorCode: receiptErrorCode(error), name, status: "failed" }));
        throw error;
      }
    }
  };
}

function isolatedE2eReceipt({ cleanup, now, plan, project, stages, target }) {
  return Object.freeze({
    authorization: Object.freeze({
      approvalReference: plan.approvalReference,
      executionEvidence: plan.authorizationEvidence
    }),
    candidate: Object.freeze({
      sha: plan.candidate.sha,
      sourceTreeSha256: plan.candidate.sourceTreeSha256
    }),
    cleanup,
    infrastructure: Object.freeze({
      artifactEvidence: plan.infrastructure.artifactEvidence,
      postgresImage: plan.infrastructure.postgresImage,
      redisImage: plan.infrastructure.redisImage
    }),
    kind: "talk-and-talk-isolated-e2e-receipt",
    recordedAt: now.toISOString(),
    schemaVersion: 2,
    stages: Object.freeze([...stages]),
    target: Object.freeze({
      databaseName: target?.databaseName ?? null,
      project: project ?? null,
      redisDatabase: target?.redisDatabase ?? null
    }),
    suite: plan.suite
  });
}

function writeIsolatedE2eReceipt(output, receipt) {
  writeFileSync(output, stableJson(receipt), { encoding: "utf8", flag: "wx", mode: 0o600 });
}

function explicitPort(value, name) {
  if (value === undefined || value === "") return null;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be an integer TCP port from 1 through 65535`);
  }
  return port;
}

async function availableLoopbackPort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.unref();
    server.once("error", rejectPort);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => rejectPort(new Error("Unable to reserve an E2E loopback port")));
        return;
      }
      server.close((error) => {
        if (error) {
          rejectPort(error);
          return;
        }
        resolvePort(address.port);
      });
    });
  });
}

function assertProjectName(project) {
  if (!/^talk_and_talk_e2e_[a-z0-9]+$/.test(project)) {
    throw new Error("Refusing to use an unexpected Docker Compose E2E project name");
  }
}

export function createInterruptController(processRef = process) {
  const controller = new AbortController();
  let receivedSignal = null;
  const onSignal = (signal) => {
    if (receivedSignal) return;
    receivedSignal = signal;
    controller.abort();
  };
  const onSigint = () => onSignal("SIGINT");
  const onSigterm = () => onSignal("SIGTERM");
  // Keep both listeners installed through cleanup. The first signal is
  // latched, while repeats remain handled rather than restoring Node's default
  // termination in the middle of `docker compose down`.
  processRef.on("SIGINT", onSigint);
  processRef.on("SIGTERM", onSigterm);
  return {
    signal: controller.signal,
    received: () => receivedSignal,
    dispose: () => {
      processRef.removeListener("SIGINT", onSigint);
      processRef.removeListener("SIGTERM", onSigterm);
    }
  };
}

function signalExitCode(signal) {
  return signal === "SIGINT" ? 130 : 143;
}

function assertSealedRunnerLaunchEnvironment(environment = process.env) {
  if (environment.E2E_RUNNER_SEALED_LAUNCH !== "1") {
    throw new Error("Use the documented POSIX E2E launcher; do not invoke the isolated E2E Node runner directly");
  }
  if (String(environment.NODE_OPTIONS ?? "").trim() || String(environment.NODE_PATH ?? "").trim()) {
    throw new Error("The isolated E2E Node runner must start without NODE_OPTIONS or NODE_PATH");
  }
}

export async function runIsolatedE2e(options = {}) {
  if (process.platform === "win32") {
    throw new Error("The isolated E2E runner requires a Unix Docker socket and POSIX process-group cleanup");
  }
  const sourceEnvironment = options.environment ?? process.env;
  assertSealedRunnerLaunchEnvironment(sourceEnvironment);
  assertRunnerHostEnvironment(sourceEnvironment);
  const plan = isolatedE2ePlan(sourceEnvironment);
  const suite = plan.suite;
  // This must happen before port reservation, Docker endpoint discovery, or
  // any child process. It records an operator/CI authorization reference but
  // intentionally does not pretend to validate the referenced external fact.
  const executionAuthorizationEvidence = assertE2eExecutionAuthorization(sourceEnvironment);
  if (executionAuthorizationEvidence !== plan.authorizationEvidence) {
    runnerFail("E2E execution authorization reference changed during runner admission");
  }
  assertExecutionAuthorizationMatchesApproval(plan.approvalReference, executionAuthorizationEvidence);
  // Check the candidate before discovering Docker, reserving a port, creating
  // a workspace, or starting any child command. The injected verifier exists
  // only for non-Docker unit tests; the direct runner always uses fixed Git.
  const verifyCandidateCheckout = options.verifyCandidateCheckout ?? assertCandidateCheckout;
  await verifyCandidateCheckout(plan.candidate);
  const localDockerEnvironment = resolveLocalDockerEnvironment({
    DOCKER_CONTEXT: sourceEnvironment.DOCKER_CONTEXT,
    DOCKER_HOST: sourceEnvironment.DOCKER_HOST
  });
  const resolveToolchain = options.resolveToolchain ?? resolveIsolatedE2eToolchain;
  const toolchain = await resolveToolchain();
  const createWorkspace = options.createWorkspace ?? createIsolatedE2eWorkspace;
  const workspace = await createWorkspace(toolchain);
  const random = options.randomBytes ?? randomBytes;
  const reservePort = options.reservePort ?? availableLoopbackPort;
  const runCommand = options.runCommand ?? command;
  const runCapture = options.runCapture ?? captureCommand;
  const writeReceipt = options.writeReceipt ?? writeIsolatedE2eReceipt;
  let project = null;
  let target = null;
  let dockerEnvironment = null;
  let interrupt = null;
  let composeMayExist = false;
  let primaryFailure = null;
  let cleanupFailure = null;
  let workspaceCleanupFailure = null;
  let receiptFailure = null;
  const stageTracker = createStageTracker();

  try {
    const runId = random(12).toString("hex");
    const ownershipToken = random(32).toString("hex");
    project = `talk_and_talk_e2e_${runId}`;
    const postgresPort = explicitPort(sourceEnvironment.E2E_POSTGRES_PORT, "E2E_POSTGRES_PORT")
      ?? await reservePort();
    let redisPort = explicitPort(sourceEnvironment.E2E_REDIS_PORT, "E2E_REDIS_PORT")
      ?? await reservePort();
    while (redisPort === postgresPort) {
      redisPort = await reservePort();
    }

    assertProjectName(project);
    const environment = buildIsolatedE2eEnvironment({
      executionAuthorizationEvidence,
      ownershipToken,
      postgresPort,
      redisPort,
      runId,
      runtimeEnvironment: workspace.runtimeEnvironment,
      suite
    });
    target = assertDisposableE2eEnvironment(environment);
    // The Docker CLI receives only the Compose interpolation variables plus a
    // sealed, per-run HOME/config. Application credentials and the ownership
    // token never need to cross into this process.
    dockerEnvironment = buildIsolatedDockerEnvironment(environment, localDockerEnvironment, plan.infrastructure);
    interrupt = options.createInterruptController?.() ?? createInterruptController();

    console.info(`Starting isolated ${suite} project ${project} (database ${target.databaseName}, Redis DB ${target.redisDatabase})`);
    await stageTracker.run("image-preflight", () => verifyPinnedInfrastructureImages(
      plan.infrastructure,
      toolchain,
      dockerEnvironment,
      runCapture,
      interrupt.signal
    ));
    await stageTracker.run("compose-config", () => runCommand(toolchain.dockerExecutable, composeArguments(project, ["config", "--quiet"]), {
      cwd: repositoryRoot,
      env: dockerEnvironment,
      abortSignal: interrupt.signal
    }));
    composeMayExist = true;
    await stageTracker.run("target-start", () => runCommand(toolchain.dockerExecutable, composeArguments(project, [
      "up", "--detach", "--wait", "--pull", "never", "--no-build"
    ]), {
      cwd: repositoryRoot,
      env: dockerEnvironment,
      abortSignal: interrupt.signal
    }));
    await stageTracker.run("ownership-claim", () => runCommand(toolchain.nodeExecutable, [toolchain.npmCliPath, "run", "claim:e2e:ownership"], {
      cwd: apiDirectory,
      env: environment,
      abortSignal: interrupt.signal
    }));
    await stageTracker.run("ownership-verify", () => runCommand(toolchain.nodeExecutable, [toolchain.npmCliPath, "run", "verify:e2e:ownership"], {
      cwd: apiDirectory,
      env: environment,
      abortSignal: interrupt.signal
    }));
    await stageTracker.run("migrate", () => runCommand(toolchain.nodeExecutable, [toolchain.npmCliPath, "run", "prisma:deploy"], {
      cwd: apiDirectory,
      env: environment,
      abortSignal: interrupt.signal
    }));
    const testCommand = suite === "postgres-preflight" ? "test:preflight:postgres" : "test:e2e";
    await stageTracker.run("test", () => runCommand(toolchain.nodeExecutable, [toolchain.npmCliPath, "run", testCommand], {
      cwd: apiDirectory,
      env: environment,
      abortSignal: interrupt.signal
    }));
    await stageTracker.run("candidate-recheck", () => verifyCandidateCheckout(plan.candidate));
    await stageTracker.run("image-recheck", () => verifyPinnedInfrastructureImages(
      plan.infrastructure,
      toolchain,
      dockerEnvironment,
      runCapture,
      interrupt.signal
    ));
  } catch (error) {
    primaryFailure = error;
  } finally {
    if (composeMayExist) {
      console.info(`Removing isolated E2E project ${project}`);
      try {
        await runCommand(toolchain.dockerExecutable, composeArguments(project, ["down", "--volumes", "--remove-orphans"]), {
          cwd: repositoryRoot,
          env: dockerEnvironment
        });
        stageTracker.stages.push(Object.freeze({ name: "cleanup-compose", status: "passed" }));
      } catch (error) {
        cleanupFailure = error;
        stageTracker.stages.push(Object.freeze({ errorCode: receiptErrorCode(error), name: "cleanup-compose", status: "failed" }));
      }
    }
    interrupt?.dispose();
    try {
      workspace.cleanup();
      stageTracker.stages.push(Object.freeze({ name: "cleanup-workspace", status: "passed" }));
    } catch (error) {
      workspaceCleanupFailure = error;
      stageTracker.stages.push(Object.freeze({ errorCode: receiptErrorCode(error), name: "cleanup-workspace", status: "failed" }));
    }
    try {
      const cleanup = Object.freeze({
        compose: cleanupFailure ? "failed" : composeMayExist ? "passed" : "not-created",
        workspace: workspaceCleanupFailure ? "failed" : "passed"
      });
      writeReceipt(plan.receiptOutput, isolatedE2eReceipt({
        cleanup,
        now: options.now?.() ?? new Date(),
        plan,
        project,
        stages: stageTracker.stages,
        target
      }));
    } catch (error) {
      receiptFailure = error;
    }
  }

  if (cleanupFailure) {
    console.error(`Isolated E2E cleanup failed${primaryFailure ? " after the primary failure" : ""}: ${cleanupFailure.message}`);
    if (!primaryFailure) throw cleanupFailure;
  }
  if (workspaceCleanupFailure) {
    console.error(
      `Isolated E2E workspace cleanup failed${primaryFailure || cleanupFailure ? " after another failure" : ""}: ${workspaceCleanupFailure.message}`
    );
    if (!primaryFailure && !cleanupFailure) throw workspaceCleanupFailure;
  }
  if (receiptFailure) {
    console.error(`Isolated E2E receipt write failed${primaryFailure || cleanupFailure || workspaceCleanupFailure ? " after another failure" : ""}: ${receiptFailure.message}`);
    if (!primaryFailure && !cleanupFailure && !workspaceCleanupFailure) throw receiptFailure;
  }
  const receivedSignal = interrupt?.received() ?? null;
  if (primaryFailure) {
    if (receivedSignal) {
      return { project, database: target.databaseName, suite, interrupted: receivedSignal, exitCode: signalExitCode(receivedSignal) };
    }
    throw primaryFailure;
  }
  return {
    project,
    database: target.databaseName,
    suite,
    interrupted: receivedSignal,
    exitCode: receivedSignal ? signalExitCode(receivedSignal) : 0
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runIsolatedE2e();
    if (result.exitCode) process.exitCode = result.exitCode;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Isolated E2E runner failed");
    process.exitCode = 1;
  }
}
