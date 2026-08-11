#!/usr/bin/env node
/**
 * Disposable forward-migration compatibility runner.
 *
 * This is deliberately separate from the ordinary E2E runner and candidate
 * evidence capture. It never builds, pulls, tags, or deploys an image. A real
 * run is possible only after an operator has supplied already-local, immutable
 * prior/candidate images and an independently approved non-secret
 * authorization reference. Its result is a narrow runtime check: a previous
 * compiled API can boot and pass dependency readiness after the
 * candidate migrations. It is not a rollback, a staging deployment, or proof
 * that every historical route/data shape remains semantically compatible.
 */
import { createHash, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { hashCandidateSourceTree, stableJson } from "../../../scripts/candidate-source-tree.mjs";

const require = createRequire(import.meta.url);
const { ISOLATED_E2E_SAFETY_OVERRIDES } = require("./isolated-e2e-safe-runtime.cjs");
const { resolveLocalDockerEnvironment } = require("./local-docker-endpoint.cjs");

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const composeFile = resolve(repositoryRoot, "infra/docker-compose.migration-compatibility.yml");
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const EVIDENCE_PATTERN = /^E[A-Z0-9]*(?:-[A-Z0-9][A-Z0-9._-]*)+$/;
const IMAGE_PATTERN = /^[a-z0-9][a-z0-9._/:-]*@sha256:[0-9a-f]{64}$/;
const CONTROL_SCHEMA = "_talktalk_migration_control";
const CONTROL_TABLE = "ownership";

function fail(message) {
  const error = new Error(message);
  error.code = "MIGRATION_COMPATIBILITY_ERROR";
  throw error;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requiredString(environment, key) {
  const value = String(environment[key] ?? "").trim();
  if (!value) fail(`${key} is required for the migration-compatibility runner`);
  return value;
}

function requiredEvidence(environment, key) {
  const value = requiredString(environment, key);
  if (!EVIDENCE_PATTERN.test(value)) {
    fail(`${key} must be a canonical non-secret Evidence ID`);
  }
  return value;
}

function requiredSha(environment, key) {
  const value = requiredString(environment, key);
  if (!SHA_PATTERN.test(value)) fail(`${key} must be an exact lowercase 40-character Git SHA`);
  return value;
}

function requiredSha256(environment, key) {
  const value = requiredString(environment, key);
  if (!SHA256_PATTERN.test(value)) fail(`${key} must be an exact lowercase SHA-256 value`);
  return value;
}

function requiredImmutableImage(environment, key) {
  const value = requiredString(environment, key);
  if (!IMAGE_PATTERN.test(value) || value.includes("//") || value.includes("..")) {
    fail(`${key} must be an immutable lower-case OCI image reference ending in @sha256:<64-hex>`);
  }
  return value;
}

function pathInside(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

/**
 * The receipt is a non-secret local-operator record of one actual local
 * disposable migration run. It must be a new file outside the candidate
 * checkout so a failed or successful run cannot dirty the frozen source tree.
 * It is not an external-control-plane receipt, immutable OCI custody proof, or
 * authorization proof; those require an independently controlled harness.
 */
function requiredReceiptOutput(environment) {
  const requested = requiredString(environment, "MIGRATION_COMPATIBILITY_RECEIPT_OUT");
  if (!isAbsolute(requested)) fail("MIGRATION_COMPATIBILITY_RECEIPT_OUT must be an absolute path outside the repository");
  const lexical = resolve(requested);
  if (pathInside(repositoryRoot, lexical)) {
    fail("MIGRATION_COMPATIBILITY_RECEIPT_OUT must remain outside the repository");
  }
  if (existsSync(lexical)) fail("MIGRATION_COMPATIBILITY_RECEIPT_OUT must name a new file");
  const requestedParent = dirname(lexical);
  try {
    if (lstatSync(requestedParent).isSymbolicLink()) {
      fail("MIGRATION_COMPATIBILITY_RECEIPT_OUT parent must not be a symbolic link");
    }
    const canonicalParent = realpathSync(requestedParent);
    if (!statSync(canonicalParent).isDirectory() || pathInside(repositoryRoot, canonicalParent)) {
      fail("MIGRATION_COMPATIBILITY_RECEIPT_OUT parent must be an existing directory outside the repository");
    }
    return join(canonicalParent, basename(lexical));
  } catch (error) {
    if (error?.code === "MIGRATION_COMPATIBILITY_ERROR") throw error;
    fail("MIGRATION_COMPATIBILITY_RECEIPT_OUT parent must be an existing directory outside the repository");
  }
}

function assertSealedRunnerLaunchEnvironment(environment) {
  if (environment.MIGRATION_COMPATIBILITY_RUNNER_SEALED_LAUNCH !== "1") {
    fail("Use the documented POSIX migration-compatibility launcher; do not invoke the Node runner directly");
  }
  if (String(environment.NODE_OPTIONS ?? "").trim() || String(environment.NODE_PATH ?? "").trim()) {
    fail("The migration-compatibility Node runner must start without NODE_OPTIONS or NODE_PATH");
  }
}

function assertNoNodeExecutionArguments(argumentsToCheck = process.execArgv) {
  if (!Array.isArray(argumentsToCheck) || argumentsToCheck.some((argument) => typeof argument !== "string")) {
    fail("Migration compatibility runner received an invalid Node execution-argument list");
  }
  if (argumentsToCheck.length !== 0) {
    fail("The migration-compatibility Node runner must start without Node execution arguments");
  }
}

/**
 * The shell launcher verifies this same digest before Node starts. Rechecking
 * the canonical executable here catches a path swap between the launcher and
 * the runner before the workspace, Docker discovery, or any Compose action.
 * This is a provenance check, not a claim that a local environment variable is
 * an external authorization record.
 */
function assertTrustedRunnerNode(toolchain, expectedSha256, readNodeExecutable = readFileSync) {
  let bytes;
  try {
    bytes = readNodeExecutable(toolchain.nodeExecutable);
  } catch {
    fail("Migration compatibility trusted Node executable could not be read for digest verification");
  }
  if (sha256(bytes) !== expectedSha256) {
    fail("Migration compatibility trusted Node executable SHA-256 does not match the sealed launcher input");
  }
}

function assertNoCallerTargetOverrides(environment) {
  for (const key of [
    "DATABASE_URL",
    "REDIS_URL",
    "SHADOW_DATABASE_URL",
    "DOCKER_CONTEXT",
    "COMPOSE_FILE",
    "COMPOSE_PROJECT_NAME",
    "COMPOSE_ENV_FILES"
  ]) {
    if (String(environment[key] ?? "").trim()) {
      fail(`${key} must be empty; the migration runner creates its own disposable target`);
    }
  }
}

/**
 * Parse all authority and artifact inputs before creating a workspace,
 * discovering Docker, reserving a port, or executing a child process.
 */
export function migrationCompatibilityPlan(environment = process.env) {
  assertSealedRunnerLaunchEnvironment(environment);
  assertNoCallerTargetOverrides(environment);
  if (String(environment.MIGRATION_COMPATIBILITY_TARGET_KIND ?? "").trim() !== "local-disposable") {
    fail("MIGRATION_COMPATIBILITY_TARGET_KIND must be exactly local-disposable");
  }

  const authorizationEvidence = requiredEvidence(environment, "MIGRATION_COMPATIBILITY_EXECUTION_AUTHORIZATION_EVIDENCE");
  const approvalReference = requiredEvidence(environment, "MIGRATION_COMPATIBILITY_ENVIRONMENT_APPROVAL_REFERENCE");
  if (authorizationEvidence !== approvalReference) {
    fail("MIGRATION_COMPATIBILITY_EXECUTION_AUTHORIZATION_EVIDENCE must match the protected-environment approval reference");
  }

  const previousSha = requiredSha(environment, "MIGRATION_COMPATIBILITY_PREVIOUS_SHA");
  const candidateSha = requiredSha(environment, "MIGRATION_COMPATIBILITY_CANDIDATE_SHA");
  if (previousSha === candidateSha) fail("previous and candidate SHA must be distinct for forward-migration compatibility");
  const runnerNodeSha256 = requiredSha256(environment, "MIGRATION_COMPATIBILITY_RUNNER_NODE_SHA256");

  const previous = Object.freeze({
    sha: previousSha,
    sourceTreeSha256: requiredSha256(environment, "MIGRATION_COMPATIBILITY_PREVIOUS_SOURCE_TREE_SHA256"),
    image: requiredImmutableImage(environment, "MIGRATION_COMPATIBILITY_PREVIOUS_IMAGE"),
    artifactEvidence: requiredEvidence(environment, "MIGRATION_COMPATIBILITY_PREVIOUS_ARTIFACT_EVIDENCE"),
    artifactProvenanceSha256: requiredSha256(environment, "MIGRATION_COMPATIBILITY_PREVIOUS_ARTIFACT_PROVENANCE_SHA256")
  });
  const candidate = Object.freeze({
    sha: candidateSha,
    sourceTreeSha256: requiredSha256(environment, "MIGRATION_COMPATIBILITY_CANDIDATE_SOURCE_TREE_SHA256"),
    image: requiredImmutableImage(environment, "MIGRATION_COMPATIBILITY_CANDIDATE_IMAGE"),
    artifactEvidence: requiredEvidence(environment, "MIGRATION_COMPATIBILITY_CANDIDATE_ARTIFACT_EVIDENCE"),
    artifactProvenanceSha256: requiredSha256(environment, "MIGRATION_COMPATIBILITY_CANDIDATE_ARTIFACT_PROVENANCE_SHA256")
  });
  const infrastructure = Object.freeze({
    postgresImage: requiredImmutableImage(environment, "MIGRATION_COMPATIBILITY_POSTGRES_IMAGE"),
    redisImage: requiredImmutableImage(environment, "MIGRATION_COMPATIBILITY_REDIS_IMAGE"),
    artifactEvidence: requiredEvidence(environment, "MIGRATION_COMPATIBILITY_INFRA_IMAGES_EVIDENCE")
  });

  return Object.freeze({
    approvalReference,
    authorizationEvidence,
    candidate,
    infrastructure,
    previous,
    receiptOutput: requiredReceiptOutput(environment),
    runnerNodeSha256
  });
}

function canonicalRegularFile(candidate, label, executable = false) {
  if (!isAbsolute(candidate)) fail(`${label} must be an absolute path`);
  try {
    const canonical = realpathSync(candidate);
    const metadata = statSync(canonical);
    if (!metadata.isFile() || (executable && (metadata.mode & 0o111) === 0)) throw new Error("not a regular file");
    return canonical;
  } catch {
    fail(`${label} must resolve to a trusted absolute regular${executable ? " executable" : ""} file`);
  }
}

function canonicalRepositoryFile(candidate, label) {
  const lexical = resolve(candidate);
  if (!lexical.startsWith(`${repositoryRoot}${sep}`)) fail(`${label} must remain inside the repository root`);
  try {
    if (lstatSync(lexical).isSymbolicLink()) fail(`${label} must not be a symbolic link`);
    const canonical = realpathSync(lexical);
    if (!canonical.startsWith(`${repositoryRoot}${sep}`) || !statSync(canonical).isFile()) {
      fail(`${label} must be a regular repository file`);
    }
    return canonical;
  } catch (error) {
    if (error?.code === "MIGRATION_COMPATIBILITY_ERROR") throw error;
    fail(`${label} is missing or invalid`);
  }
}

function firstCanonicalRegularFile(candidates, label, executable = false) {
  for (const candidate of candidates) {
    try {
      return canonicalRegularFile(candidate, label, executable);
    } catch {
      // Only runner-owned absolute locations are considered; never consult PATH.
    }
  }
  fail(`${label} was not found in the migration-runner allowlist`);
}

export function resolveMigrationCompatibilityToolchain() {
  const nodeExecutable = canonicalRegularFile(process.execPath, "Node.js", true);
  const dockerExecutable = firstCanonicalRegularFile([
    "/usr/local/bin/docker",
    "/opt/homebrew/bin/docker",
    "/usr/bin/docker",
    "/snap/bin/docker",
    "/Applications/Docker.app/Contents/Resources/bin/docker"
  ], "Docker CLI", true);
  return Object.freeze({
    composeFile: canonicalRepositoryFile(composeFile, "Migration compatibility Compose file"),
    dockerExecutable,
    nodeExecutable,
    path: [dirname(nodeExecutable), "/usr/bin", "/bin"].join(":"),
  });
}

function trustedGitExecutable() {
  return firstCanonicalRegularFile(
    process.platform === "win32" ? [] : ["/usr/bin/git", "/bin/git"],
    "Git executable",
    true
  );
}

function git(root, args, allowFailure = false) {
  const result = spawnSync(trustedGitExecutable(), args, {
    cwd: root,
    encoding: "utf8",
    env: {
      PATH: "/usr/bin:/bin",
      HOME: "/tmp",
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0"
    },
    maxBuffer: 8 * 1024 * 1024
  });
  if (result.error) fail(`Unable to run trusted git: ${result.error.message}`);
  if (!allowFailure && result.status !== 0) {
    fail(`Trusted git ${args.join(" ")} failed: ${`${result.stdout || ""}${result.stderr || ""}`.trim()}`);
  }
  return Object.freeze({ status: result.status ?? 1, stdout: (result.stdout || "").trim(), stderr: (result.stderr || "").trim() });
}

function gitBytes(root, args) {
  const result = spawnSync(trustedGitExecutable(), args, {
    cwd: root,
    encoding: null,
    env: {
      PATH: "/usr/bin:/bin",
      HOME: "/tmp",
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0"
    },
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    fail(`Trusted git ${args.join(" ")} could not read an immutable source blob`);
  }
  return result.stdout;
}

/**
 * Reproduce the candidate-source-tree manifest directly from a historical Git
 * revision, without checking that revision out or trusting caller-supplied
 * provenance text. The entry shape intentionally matches hashCandidateSourceTree.
 */
export function hashGitRevisionSourceTree(root, revision) {
  const records = git(root, ["ls-tree", "-r", revision]).stdout.split("\n").filter(Boolean);
  const entries = [];
  for (const record of records) {
    const [metadata, path] = record.split("\t");
    const [mode, type, gitObject] = String(metadata || "").split(" ");
    if (mode === "160000") fail(`Previous source tree contains an unresolved gitlink at ${path || "unknown path"}`);
    if (!/^100[0-7]{3}$/.test(mode || "") || type !== "blob" || !path || !/^[0-9a-f]{40,64}$/.test(gitObject || "")) {
      fail(`Previous source tree contains an unsupported Git tree record: ${record}`);
    }
    const bytes = gitBytes(root, ["cat-file", "blob", gitObject]);
    entries.push({
      path,
      kind: "file",
      mode: Number.parseInt(mode, 8) & 0o777,
      bytes: bytes.length,
      sha256: sha256(bytes),
      gitObject
    });
  }
  return Object.freeze({ entries, treeSha256: sha256(stableJson(entries)) });
}

/** Verify the actual candidate source and the prior→candidate ancestry locally. */
export function verifyMigrationCompatibilityCheckout(plan, root = repositoryRoot) {
  const canonicalRoot = realpathSync(root);
  if (canonicalRoot !== repositoryRoot) fail("Migration compatibility runner must execute from its repository root");
  if (realpathSync(git(canonicalRoot, ["rev-parse", "--show-toplevel"]).stdout) !== canonicalRoot) {
    fail("Migration compatibility runner must execute from the repository root");
  }
  const head = git(canonicalRoot, ["rev-parse", "HEAD"]).stdout;
  if (head !== plan.candidate.sha) fail(`Current HEAD ${head} does not match migration candidate ${plan.candidate.sha}`);
  if (git(canonicalRoot, ["symbolic-ref", "-q", "--short", "HEAD"], true).status === 0) {
    fail("Migration compatibility runner requires a detached candidate checkout");
  }
  const status = git(canonicalRoot, ["status", "--porcelain=v1", "--untracked-files=all"]).stdout;
  if (status) fail(`Migration compatibility candidate checkout is dirty or untracked:\n${status}`);
  if (git(canonicalRoot, ["diff", "--check"]).stdout) fail("git diff --check produced output");
  if (git(canonicalRoot, ["merge-base", "--is-ancestor", plan.previous.sha, plan.candidate.sha], true).status !== 0) {
    fail("MIGRATION_COMPATIBILITY_PREVIOUS_SHA must be an ancestor of the candidate SHA");
  }
  const previousSourceTreeSha256 = hashGitRevisionSourceTree(canonicalRoot, plan.previous.sha).treeSha256;
  if (previousSourceTreeSha256 !== plan.previous.sourceTreeSha256) {
    fail("MIGRATION_COMPATIBILITY_PREVIOUS_SOURCE_TREE_SHA256 does not match the immutable previous Git revision");
  }
  const sourceTreeSha256 = hashCandidateSourceTree(
    canonicalRoot,
    git(canonicalRoot, ["ls-tree", "-r", "HEAD"]).stdout
  ).treeSha256;
  if (sourceTreeSha256 !== plan.candidate.sourceTreeSha256) {
    fail("MIGRATION_COMPATIBILITY_CANDIDATE_SOURCE_TREE_SHA256 does not match the detached candidate checkout");
  }
  return Object.freeze({ head, previousSourceTreeSha256, sourceTreeSha256 });
}

function safeRuntimeEnvironment({ databaseName, readinessToken, runId }) {
  return Object.freeze({
    ...ISOLATED_E2E_SAFETY_OVERRIDES,
    API_PREFIX: "api/v1",
    APP_ENV: "staging",
    APP_VERSION: "migration-compatibility",
    CORS_ORIGINS: "http://127.0.0.1",
    DATABASE_URL: `postgresql://talk:talk@postgres:5432/${databaseName}`,
    HOST: "0.0.0.0",
    MIGRATION_COMPATIBILITY_RUN_ID: runId,
    METRICS_TOKEN: readinessToken,
    NODE_ENV: "test",
    PORT: "3000",
    REDIS_URL: "redis://redis:6379/15",
    RUN_MIGRATE_ON_START: "false"
  });
}

function serializeEnvironment(environment) {
  return `${Object.entries(environment)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => {
      const stringValue = String(value);
      if (!/^[A-Z][A-Z0-9_]*$/.test(key) || /[\u0000\r\n]/.test(stringValue)) {
        fail("Migration compatibility runtime environment contains an unsafe key or value");
      }
      return `${key}=${stringValue}`;
    })
    .join("\n")}\n`;
}

export function createMigrationCompatibilityWorkspace(toolchain, runtimeEnvironment) {
  const root = mkdtempSync(join(tmpdir(), "talk-and-talk-migration-compatibility-"));
  const home = join(root, "home");
  const temporaryDirectory = join(root, "tmp");
  const dockerConfig = join(root, "docker-config");
  const xdgConfig = join(root, "xdg-config");
  const runtimeEnvironmentFile = join(root, "runtime.env");
  for (const directory of [home, temporaryDirectory, dockerConfig, xdgConfig]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  writeFileSync(runtimeEnvironmentFile, serializeEnvironment(runtimeEnvironment), { encoding: "utf8", flag: "wx", mode: 0o600 });
  return Object.freeze({
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    dockerRuntimeEnvironment: Object.freeze({
      DOCKER_CONFIG: dockerConfig,
      HOME: home,
      LANG: "C.UTF-8",
      PATH: toolchain.path,
      TEMP: temporaryDirectory,
      TMP: temporaryDirectory,
      TMPDIR: temporaryDirectory,
      XDG_CONFIG_HOME: xdgConfig
    }),
    runtimeEnvironmentFile
  });
}

function command(commandName, args, options = {}) {
  return new Promise((resolveCommand, rejectCommand) => {
    if (options.abortSignal?.aborted) {
      rejectCommand(new Error(`Interrupted before ${commandName} could start`));
      return;
    }
    let settled = false;
    const capture = options.capture === true;
    const child = spawn(commandName, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      detached: process.platform !== "win32"
    });
    const output = { stdout: "", stderr: "" };
    if (capture) {
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk) => { output.stdout += chunk; });
      child.stderr?.on("data", (chunk) => { output.stderr += chunk; });
    }
    let killTimer = null;
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
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      options.abortSignal?.removeEventListener("abort", interruptChild);
      if (killTimer) clearTimeout(killTimer);
      callback();
    };
    options.abortSignal?.addEventListener("abort", interruptChild, { once: true });
    child.once("error", (error) => finish(() => rejectCommand(new Error(`Unable to run migration-compatibility command: ${error.message}`))));
    child.once("exit", (code, signal) => {
      if (code === 0) {
        finish(() => resolveCommand(Object.freeze(output)));
        return;
      }
      finish(() => rejectCommand(new Error(`Migration-compatibility command failed with ${signal ?? `exit ${code}`}`)));
    });
  });
}

function composeArguments(project, composePath, args) {
  return ["compose", "--env-file", "/dev/null", "-p", project, "-f", composePath, ...args];
}

function assertProjectName(project) {
  if (!/^talk_and_talk_migration_[a-z0-9]+$/.test(project)) {
    fail("Refusing to use an unexpected migration-compatibility Docker Compose project name");
  }
}

function immutableImageLabels(serialized, expected) {
  let labels;
  try {
    labels = JSON.parse(String(serialized).trim() || "null");
  } catch {
    fail(`Immutable image ${expected.image} did not return parseable OCI labels`);
  }
  if (!labels || typeof labels !== "object" || Array.isArray(labels)) {
    fail(`Immutable image ${expected.image} is missing OCI labels`);
  }
  if (labels["org.opencontainers.image.revision"] !== expected.sha) {
    fail(`Immutable image ${expected.image} does not bind org.opencontainers.image.revision to its approved SHA`);
  }
  if (labels["io.talkandtalk.source-tree-sha256"] !== expected.sourceTreeSha256) {
    fail(`Immutable image ${expected.image} does not bind its approved source-tree SHA-256`);
  }
  if (labels["io.talkandtalk.artifact-provenance-sha256"] !== expected.artifactProvenanceSha256) {
    fail(`Immutable image ${expected.image} does not bind its approved artifact provenance SHA-256`);
  }
  if (labels["io.talkandtalk.provenance-kind"] !== "approved-candidate") {
    fail(`Immutable image ${expected.image} is not marked as an approved-candidate artifact`);
  }
}

function resultText(result) {
  return typeof result === "string" ? result : String(result?.stdout ?? "");
}

function immutableRepoDigest(serialized, expectedImage) {
  let digests;
  try {
    digests = JSON.parse(String(serialized).trim() || "null");
  } catch {
    fail(`Immutable image ${expectedImage} did not return parseable RepoDigests`);
  }
  if (!Array.isArray(digests) || !digests.includes(expectedImage)) {
    fail(`Immutable image ${expectedImage} is not locally available under its exact approved RepoDigest`);
  }
}

async function verifyPinnedImage(image, toolchain, dockerEnvironment, runCapture) {
  const result = await runCapture(toolchain.dockerExecutable, ["image", "inspect", "--format", "{{json .RepoDigests}}", image], {
    cwd: repositoryRoot,
    env: dockerEnvironment,
    capture: true
  });
  immutableRepoDigest(resultText(result), image);
}

async function verifyImmutableApplicationImages(plan, toolchain, dockerEnvironment, runCapture) {
  for (const artifact of [plan.previous, plan.candidate]) {
    await verifyPinnedImage(artifact.image, toolchain, dockerEnvironment, runCapture);
    const labels = await runCapture(toolchain.dockerExecutable, ["image", "inspect", "--format", "{{json .Config.Labels}}", artifact.image], {
      cwd: repositoryRoot,
      env: dockerEnvironment,
      capture: true
    });
    immutableImageLabels(resultText(labels), artifact);
  }
  await verifyPinnedImage(plan.infrastructure.postgresImage, toolchain, dockerEnvironment, runCapture);
  await verifyPinnedImage(plan.infrastructure.redisImage, toolchain, dockerEnvironment, runCapture);
}

function dockerEnvironmentForPlan(plan, workspace, localDockerEnvironment, target) {
  return Object.freeze({
    ...workspace.dockerRuntimeEnvironment,
    DOCKER_HOST: localDockerEnvironment.DOCKER_HOST,
    MIGRATION_CANDIDATE_IMAGE: plan.candidate.image,
    MIGRATION_DATABASE_NAME: target.databaseName,
    MIGRATION_OWNERSHIP_MARKER_SHA256: target.ownershipMarkerHash,
    MIGRATION_POSTGRES_IMAGE: plan.infrastructure.postgresImage,
    MIGRATION_PREVIOUS_IMAGE: plan.previous.image,
    MIGRATION_REDIS_IMAGE: plan.infrastructure.redisImage,
    MIGRATION_RUN_ID: target.runId,
    MIGRATION_RUNTIME_ENV_FILE: workspace.runtimeEnvironmentFile
  });
}

function ownershipSql(markerHash) {
  return [
    `CREATE SCHEMA IF NOT EXISTS ${CONTROL_SCHEMA};`,
    `CREATE TABLE IF NOT EXISTS ${CONTROL_SCHEMA}.${CONTROL_TABLE} (id text primary key, marker_sha256 text not null);`,
    `INSERT INTO ${CONTROL_SCHEMA}.${CONTROL_TABLE} (id, marker_sha256) VALUES ('current', '${markerHash}') ON CONFLICT (id) DO UPDATE SET marker_sha256 = EXCLUDED.marker_sha256;`
  ].join(" ");
}

function ownershipReadSql() {
  return `SELECT marker_sha256 FROM ${CONTROL_SCHEMA}.${CONTROL_TABLE} WHERE id = 'current';`;
}

function emptyDatabaseSql() {
  // A table-only check misses views, sequences, functions, types, and whole
  // non-system schemas. The fresh target may contain the stock `public`
  // schema but no object in it (or in any other non-system schema).
  return [
    "SELECT count(*) FROM (",
    "SELECT n.oid::text AS object_id FROM pg_namespace n",
    "WHERE n.nspname <> 'public' AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')",
    "AND n.nspname NOT LIKE 'pg_temp_%' AND n.nspname NOT LIKE 'pg_toast_temp_%'",
    "UNION ALL",
    "SELECT c.oid::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace",
    "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')",
    "AND n.nspname NOT LIKE 'pg_temp_%' AND n.nspname NOT LIKE 'pg_toast_temp_%'",
    "UNION ALL",
    "SELECT p.oid::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace",
    "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')",
    "AND n.nspname NOT LIKE 'pg_temp_%' AND n.nspname NOT LIKE 'pg_toast_temp_%'",
    "UNION ALL",
    "SELECT t.oid::text FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace",
    "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')",
    "AND n.nspname NOT LIKE 'pg_temp_%' AND n.nspname NOT LIKE 'pg_toast_temp_%'",
    ") AS unexpected_objects;"
  ].join(" ");
}

function redisOwnershipKey() {
  return "talk-and-talk:migration-compatibility:ownership:current";
}

async function assertFreshDisposableDataStores({ abortSignal, dockerEnvironment, markerHash, project, runCapture, runCommand, target, toolchain }) {
  const postgresBase = [
    "exec", "-T", "postgres", "psql", "-tA", "-v", "ON_ERROR_STOP=1", "-U", "talk", "-d", target.databaseName, "-c"
  ];
  const postgresTableCount = await runCapture(toolchain.dockerExecutable, composeArguments(project, toolchain.composeFile, [
    ...postgresBase, emptyDatabaseSql()
  ]), { abortSignal, capture: true, cwd: repositoryRoot, env: dockerEnvironment });
  if (resultText(postgresTableCount).trim() !== "0") {
    fail("Migration compatibility disposable PostgreSQL target contains non-system objects before ownership marking");
  }

  for (const database of ["14", "15"]) {
    const redisDatabaseSize = await runCapture(toolchain.dockerExecutable, composeArguments(project, toolchain.composeFile, [
      "exec", "-T", "redis", "redis-cli", "--raw", "-n", database, "DBSIZE"
    ]), { abortSignal, capture: true, cwd: repositoryRoot, env: dockerEnvironment });
    if (resultText(redisDatabaseSize).trim() !== "0") {
      fail(`Migration compatibility disposable Redis database ${database} is not empty before ownership marking`);
    }
  }

  await runCommand(toolchain.dockerExecutable, composeArguments(project, toolchain.composeFile, [
    "exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "talk", "-d", target.databaseName, "-c", ownershipSql(markerHash)
  ]), { abortSignal, cwd: repositoryRoot, env: dockerEnvironment });
  const postgresOwnership = await runCapture(toolchain.dockerExecutable, composeArguments(project, toolchain.composeFile, [
    ...postgresBase, ownershipReadSql()
  ]), { abortSignal, capture: true, cwd: repositoryRoot, env: dockerEnvironment });
  if (resultText(postgresOwnership).trim() !== markerHash) {
    fail("Migration compatibility ownership marker was not preserved on the disposable database");
  }

  const redisSet = await runCapture(toolchain.dockerExecutable, composeArguments(project, toolchain.composeFile, [
    "exec", "-T", "redis", "redis-cli", "--raw", "-n", "14", "SET", redisOwnershipKey(), markerHash, "NX"
  ]), { abortSignal, capture: true, cwd: repositoryRoot, env: dockerEnvironment });
  if (resultText(redisSet).trim() !== "OK") {
    fail("Migration compatibility disposable Redis ownership marker could not be created exclusively");
  }
  const redisOwnership = await runCapture(toolchain.dockerExecutable, composeArguments(project, toolchain.composeFile, [
    "exec", "-T", "redis", "redis-cli", "--raw", "-n", "14", "GET", redisOwnershipKey()
  ]), { abortSignal, capture: true, cwd: repositoryRoot, env: dockerEnvironment });
  if (resultText(redisOwnership).trim() !== markerHash) {
    fail("Migration compatibility ownership marker was not preserved on the disposable Redis target");
  }
}

async function verifyDisposableDataStoreOwnership({ abortSignal, dockerEnvironment, markerHash, project, runCapture, target, toolchain }) {
  const postgresOwnership = await runCapture(toolchain.dockerExecutable, composeArguments(project, toolchain.composeFile, [
    "exec", "-T", "postgres", "psql", "-tA", "-v", "ON_ERROR_STOP=1", "-U", "talk", "-d", target.databaseName, "-c", ownershipReadSql()
  ]), { abortSignal, capture: true, cwd: repositoryRoot, env: dockerEnvironment });
  if (resultText(postgresOwnership).trim() !== markerHash) {
    fail("Migration compatibility PostgreSQL ownership marker changed during the run");
  }
  const redisOwnership = await runCapture(toolchain.dockerExecutable, composeArguments(project, toolchain.composeFile, [
    "exec", "-T", "redis", "redis-cli", "--raw", "-n", "14", "GET", redisOwnershipKey()
  ]), { abortSignal, capture: true, cwd: repositoryRoot, env: dockerEnvironment });
  if (resultText(redisOwnership).trim() !== markerHash) {
    fail("Migration compatibility Redis ownership marker changed during the run");
  }
}

function healthPayload(value, service, path) {
  let body;
  try {
    body = JSON.parse(value);
  } catch {
    fail(`Migration compatibility ${service} ${path} did not return JSON`);
  }
  const health = body?.data ?? body;
  if (health?.status !== "ok") fail(`Migration compatibility ${service} ${path} did not report status ok`);
  return health;
}

async function probeServiceReadiness(service, { abortSignal, dockerEnvironment, project, runCapture, toolchain }) {
  const probe = async (path, authenticated = false) => resultText(await runCapture(
    toolchain.dockerExecutable,
    composeArguments(project, toolchain.composeFile, [
      "exec", "-T", service,
      ...(authenticated
        ? ["/bin/sh", "-ec", `curl --fail --silent --show-error -H \"Authorization: Bearer $METRICS_TOKEN\" http://127.0.0.1:3000${path}`]
        : ["curl", "--fail", "--silent", "--show-error", `http://127.0.0.1:3000${path}`])
    ]),
    { abortSignal, capture: true, cwd: repositoryRoot, env: dockerEnvironment }
  ));
  healthPayload(await probe("/api/v1/health"), service, "/health");
  const readiness = healthPayload(await probe("/api/v1/health/ready", true), service, "/health/ready");
  if (readiness?.dependencies?.database?.status !== "ok" || readiness?.dependencies?.redis?.status !== "ok") {
    fail(`Migration compatibility ${service} readiness dependencies are not both ok`);
  }
}

const COMPOSE_PROJECT_LABEL = "com.docker.compose.project";
const RUN_ID_LABEL = "io.talkandtalk.migration-compatibility.run-id";
const OWNERSHIP_MARKER_LABEL = "io.talkandtalk.migration-compatibility.ownership-marker-sha256";

function identifiers(result) {
  return resultText(result).split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
}

function ownedResourceLabels(serialized, kind, identifier, target) {
  let labels;
  try {
    labels = JSON.parse(String(serialized).trim() || "null");
  } catch {
    fail(`Migration compatibility ${kind} ${identifier} did not return parseable ownership labels`);
  }
  if (!labels || typeof labels !== "object" || Array.isArray(labels)) {
    fail(`Migration compatibility ${kind} ${identifier} is missing ownership labels`);
  }
  for (const [key, expected] of Object.entries({
    [COMPOSE_PROJECT_LABEL]: target.project,
    [RUN_ID_LABEL]: target.runId,
    [OWNERSHIP_MARKER_LABEL]: target.ownershipMarkerHash
  })) {
    if (labels[key] !== expected) {
      fail(`Migration compatibility ${kind} ${identifier} is not owned by this exact disposable run`);
    }
  }
}

async function listOwnedDockerResources({ dockerEnvironment, project, runCapture, toolchain }) {
  const resourceKinds = [
    { format: "{{.ID}}", inspect: "inspect", kind: "container", list: ["ps", "-a"] },
    { format: "{{.ID}}", inspect: "network", kind: "network", list: ["network", "ls"] },
    { format: "{{.Name}}", inspect: "volume", kind: "volume", list: ["volume", "ls"] }
  ];
  const resources = [];
  for (const resource of resourceKinds) {
    const listed = await runCapture(toolchain.dockerExecutable, [
      ...resource.list,
      "--filter", `label=${COMPOSE_PROJECT_LABEL}=${project}`,
      "--format", resource.format
    ], { capture: true, cwd: repositoryRoot, env: dockerEnvironment });
    for (const identifier of identifiers(listed)) {
      const inspected = await runCapture(toolchain.dockerExecutable, [
        resource.inspect,
        "inspect",
        "--format",
        resource.kind === "container" ? "{{json .Config.Labels}}" : "{{json .Labels}}",
        identifier
      ], { capture: true, cwd: repositoryRoot, env: dockerEnvironment });
      resources.push(Object.freeze({
        identifier,
        kind: resource.kind,
        labels: resultText(inspected)
      }));
    }
  }
  return Object.freeze(resources);
}

async function verifyOwnedComposeResources({ dockerEnvironment, project, runCapture, target, toolchain }) {
  const resources = await listOwnedDockerResources({ dockerEnvironment, project, runCapture, toolchain });
  for (const resource of resources) {
    ownedResourceLabels(resource.labels, resource.kind, resource.identifier, target);
  }
  const counts = Object.fromEntries(["container", "network", "volume"].map((kind) => [
    kind,
    resources.filter((resource) => resource.kind === kind).length
  ]));
  for (const [kind, count] of Object.entries(counts)) {
    if (count < 1) {
      fail(`Migration compatibility cleanup cannot prove an owned ${kind} exists for this run`);
    }
  }
  return Object.freeze({ count: resources.length, counts });
}

function receiptErrorCode(error) {
  const candidate = String(error?.code ?? "");
  return /^[A-Z][A-Z0-9_:-]{1,80}$/.test(candidate) ? candidate : "UNCLASSIFIED_FAILURE";
}

function createStageTracker() {
  const stages = [];
  return Object.freeze({
    stages,
    async run(name, callback) {
      try {
        const value = await callback();
        stages.push(Object.freeze({ name, status: "passed" }));
        return value;
      } catch (error) {
        stages.push(Object.freeze({ errorCode: receiptErrorCode(error), name, status: "failed" }));
        throw error;
      }
    }
  });
}

function migrationCompatibilityReceipt({ cleanup, plan, stages, target, now = new Date() }) {
  const passed = stages.every((stage) => stage.status === "passed")
    && cleanup.compose === "passed"
    && cleanup.workspace === "passed";
  return Object.freeze({
    artifacts: {
      candidate: {
        artifactEvidence: plan.candidate.artifactEvidence,
        artifactProvenanceSha256: plan.candidate.artifactProvenanceSha256,
        image: plan.candidate.image,
        sha: plan.candidate.sha,
        sourceTreeSha256: plan.candidate.sourceTreeSha256
      },
      infrastructure: {
        artifactEvidence: plan.infrastructure.artifactEvidence,
        postgresImage: plan.infrastructure.postgresImage,
        redisImage: plan.infrastructure.redisImage
      },
      previous: {
        artifactEvidence: plan.previous.artifactEvidence,
        artifactProvenanceSha256: plan.previous.artifactProvenanceSha256,
        image: plan.previous.image,
        sha: plan.previous.sha,
        sourceTreeSha256: plan.previous.sourceTreeSha256
      }
    },
    authorization: {
      approvalReference: plan.approvalReference,
      executionEvidence: plan.authorizationEvidence
    },
    cleanup,
    kind: "talktalk-local-forward-migration-compatibility",
    outcome: passed ? "passed" : "failed",
    recordedAt: now.toISOString(),
    schemaVersion: 1,
    stages,
    target: {
      databaseName: target.databaseName,
      kind: "local-disposable",
      ownershipMarkers: "postgres-and-redis-14",
      project: target.project,
      redisDataDatabase: 15,
      resourcesVerifiedBeforeCleanup: target.ownedResourceCount
    },
    toolchain: {
      runnerNodeSha256: plan.runnerNodeSha256
    }
  });
}

function writeMigrationCompatibilityReceipt(output, receipt) {
  writeFileSync(output, stableJson(receipt), { encoding: "utf8", flag: "wx", mode: 0o600 });
}

export function createInterruptController(processRef = process) {
  const controller = new AbortController();
  let receivedSignal = null;
  const receive = (signal) => {
    if (receivedSignal) return;
    receivedSignal = signal;
    controller.abort();
  };
  const onSigint = () => receive("SIGINT");
  const onSigterm = () => receive("SIGTERM");
  processRef.on("SIGINT", onSigint);
  processRef.on("SIGTERM", onSigterm);
  return Object.freeze({
    dispose: () => {
      processRef.removeListener("SIGINT", onSigint);
      processRef.removeListener("SIGTERM", onSigterm);
    },
    received: () => receivedSignal,
    signal: controller.signal
  });
}

/**
 * Execute only after all preconditions have passed. Tests inject every side
 * effect; the default path is intentionally not used in local regression.
 */
export async function runMigrationCompatibility(options = {}) {
  if (process.platform === "win32") fail("Migration compatibility requires Unix Docker sockets and POSIX process cleanup");
  const environment = options.environment ?? process.env;
  const logError = options.logError ?? ((message) => console.error(message));
  const plan = migrationCompatibilityPlan(environment);
  assertNoNodeExecutionArguments(options.processExecArgv ?? process.execArgv);
  const stageTracker = createStageTracker();
  const verifyCheckout = options.verifyCheckout ?? verifyMigrationCompatibilityCheckout;
  await stageTracker.run("candidate-checkout", () => verifyCheckout(plan, options.repositoryRoot ?? repositoryRoot));

  const localDockerEnvironment = await stageTracker.run("local-docker-endpoint", () => resolveLocalDockerEnvironment({
    DOCKER_CONTEXT: environment.DOCKER_CONTEXT,
    DOCKER_HOST: environment.DOCKER_HOST
  }));
  const resolveToolchain = options.resolveToolchain ?? resolveMigrationCompatibilityToolchain;
  const toolchain = await stageTracker.run("trusted-toolchain", () => resolveToolchain());
  await stageTracker.run("trusted-node-binary", () => assertTrustedRunnerNode(
    toolchain,
    plan.runnerNodeSha256,
    options.readNodeExecutable ?? readFileSync
  ));
  const random = options.randomBytes ?? randomBytes;
  const runCommand = options.runCommand ?? command;
  const runCapture = options.runCapture ?? command;
  const createWorkspace = options.createWorkspace ?? createMigrationCompatibilityWorkspace;
  const runId = random(12).toString("hex");
  const ownershipMarkerHash = sha256(random(32));
  const readinessToken = random(32).toString("hex");
  const project = `talk_and_talk_migration_${runId}`;
  assertProjectName(project);
  const target = Object.freeze({
    databaseName: `talk_and_talk_${runId}_migration`,
    ownershipMarkerHash,
    project,
    runId
  });
  const runtimeEnvironment = safeRuntimeEnvironment({ databaseName: target.databaseName, readinessToken, runId });
  const workspace = await createWorkspace(toolchain, runtimeEnvironment);
  let dockerEnvironment = null;
  let interrupt = null;
  let composeMayExist = false;
  let primaryFailure = null;
  let cleanupFailure = null;
  let workspaceCleanupFailure = null;
  let receiptFailure = null;
  let ownedResourceCount = 0;

  try {
    dockerEnvironment = dockerEnvironmentForPlan(plan, workspace, localDockerEnvironment, target);
    interrupt = options.createInterruptController?.() ?? createInterruptController();
    await stageTracker.run("artifact-preflight", () => verifyImmutableApplicationImages(plan, toolchain, dockerEnvironment, runCapture));
    await stageTracker.run("compose-config", () => runCommand(toolchain.dockerExecutable, composeArguments(project, toolchain.composeFile, ["config", "--quiet"]), {
      abortSignal: interrupt.signal,
      cwd: repositoryRoot,
      env: dockerEnvironment
    }));

    composeMayExist = true;
    await stageTracker.run("target-start", () => runCommand(toolchain.dockerExecutable, composeArguments(project, toolchain.composeFile, ["up", "--detach", "--wait", "--pull", "never", "--no-build", "postgres", "redis"]), {
      abortSignal: interrupt.signal,
      cwd: repositoryRoot,
      env: dockerEnvironment
    }));
    await stageTracker.run("target-ownership", () => assertFreshDisposableDataStores({
      abortSignal: interrupt.signal,
      dockerEnvironment,
      markerHash: ownershipMarkerHash,
      project,
      runCapture,
      runCommand,
      target,
      toolchain
    }));

    await stageTracker.run("previous-migrate", async () => {
      await runCommand(toolchain.dockerExecutable, composeArguments(project, toolchain.composeFile, ["run", "--pull", "never", "--rm", "--no-deps", "previous-migrate"]), {
        abortSignal: interrupt.signal,
        cwd: repositoryRoot,
        env: dockerEnvironment
      });
    });
    const probeService = options.probeService ?? probeServiceReadiness;
    await stageTracker.run("previous-normal-before-candidate-migration", async () => {
      await runCommand(toolchain.dockerExecutable, composeArguments(project, toolchain.composeFile, ["up", "--detach", "--wait", "--pull", "never", "--no-build", "previous-api"]), {
        abortSignal: interrupt.signal,
        cwd: repositoryRoot,
        env: dockerEnvironment
      });
      await probeService("previous-api", { abortSignal: interrupt.signal, dockerEnvironment, project, runCapture, toolchain });
    });
    await stageTracker.run("candidate-migrate-and-status", async () => {
      for (const service of ["candidate-migrate", "candidate-migrate-status"]) {
      await runCommand(toolchain.dockerExecutable, composeArguments(project, toolchain.composeFile, ["run", "--pull", "never", "--rm", "--no-deps", service]), {
        abortSignal: interrupt.signal,
        cwd: repositoryRoot,
        env: dockerEnvironment
      });
      }
    });
    await stageTracker.run("ownership-recheck", () => verifyDisposableDataStoreOwnership({
      abortSignal: interrupt.signal,
      dockerEnvironment,
      markerHash: ownershipMarkerHash,
      project,
      runCapture,
      target,
      toolchain
    }));
    // This is the rolling-upgrade proof: the old replica was started through
    // its normal entrypoint before the schema moved forward, then stayed
    // healthy against the candidate schema.
    await stageTracker.run("previous-normal-after-candidate-migration", () => probeService("previous-api", {
      abortSignal: interrupt.signal,
      dockerEnvironment,
      project,
      runCapture,
      toolchain
    }));
    await stageTracker.run("previous-compiled-binary", async () => {
      await runCommand(toolchain.dockerExecutable, composeArguments(project, toolchain.composeFile, ["stop", "previous-api"]), {
        abortSignal: interrupt.signal,
        cwd: repositoryRoot,
        env: dockerEnvironment
      });
      // The second previous-image service deliberately bypasses the old
      // entrypoint's fail-closed `prisma migrate status` check. That check is
      // expected to reject a newer schema; this service isolates whether the old
      // compiled application itself can boot/read dependencies on that schema.
      await runCommand(toolchain.dockerExecutable, composeArguments(project, toolchain.composeFile, ["up", "--detach", "--wait", "--pull", "never", "--no-build", "previous-api-compatible"]), {
        abortSignal: interrupt.signal,
        cwd: repositoryRoot,
        env: dockerEnvironment
      });
      await probeService("previous-api-compatible", { abortSignal: interrupt.signal, dockerEnvironment, project, runCapture, toolchain });
      await runCommand(toolchain.dockerExecutable, composeArguments(project, toolchain.composeFile, ["stop", "previous-api-compatible"]), {
        abortSignal: interrupt.signal,
        cwd: repositoryRoot,
        env: dockerEnvironment
      });
    });
    await stageTracker.run("candidate-runtime", async () => {
      await runCommand(toolchain.dockerExecutable, composeArguments(project, toolchain.composeFile, ["up", "--detach", "--wait", "--pull", "never", "--no-build", "candidate-api"]), {
        abortSignal: interrupt.signal,
        cwd: repositoryRoot,
        env: dockerEnvironment
      });
      await probeService("candidate-api", { abortSignal: interrupt.signal, dockerEnvironment, project, runCapture, toolchain });
    });
    await stageTracker.run("artifact-recheck", () => verifyImmutableApplicationImages(plan, toolchain, dockerEnvironment, runCapture));
  } catch (error) {
    primaryFailure = error;
  } finally {
    if (composeMayExist && dockerEnvironment) {
      try {
        await stageTracker.run("cleanup-compose", async () => {
          const ownedResources = await verifyOwnedComposeResources({
            dockerEnvironment,
            project,
            runCapture,
            target,
            toolchain
          });
          ownedResourceCount = ownedResources.count;
          await runCommand(toolchain.dockerExecutable, composeArguments(project, toolchain.composeFile, ["down", "--volumes"]), {
            cwd: repositoryRoot,
            env: dockerEnvironment
          });
          const residualResources = await listOwnedDockerResources({ dockerEnvironment, project, runCapture, toolchain });
          if (residualResources.length !== 0) {
            fail("Migration compatibility cleanup left owned Docker resources behind");
          }
        });
      } catch (error) {
        cleanupFailure = error;
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
      const receipt = migrationCompatibilityReceipt({
        cleanup,
        now: options.now?.() ?? new Date(),
        plan,
        stages: stageTracker.stages,
        target: { ...target, ownedResourceCount }
      });
      await (options.writeReceipt ?? writeMigrationCompatibilityReceipt)(plan.receiptOutput, receipt);
    } catch (error) {
      receiptFailure = error;
    }
  }

  if (cleanupFailure) {
    logError(`Migration compatibility cleanup failed${primaryFailure ? " after the primary failure" : ""}: ${cleanupFailure.message}`);
    if (!primaryFailure) throw cleanupFailure;
  }
  if (workspaceCleanupFailure) {
    logError(`Migration compatibility workspace cleanup failed${primaryFailure || cleanupFailure ? " after another failure" : ""}: ${workspaceCleanupFailure.message}`);
    if (!primaryFailure && !cleanupFailure) throw workspaceCleanupFailure;
  }
  if (receiptFailure) {
    logError(`Migration compatibility receipt write failed${primaryFailure || cleanupFailure || workspaceCleanupFailure ? " after another failure" : ""}: ${receiptFailure.message}`);
    if (!primaryFailure && !cleanupFailure && !workspaceCleanupFailure) throw receiptFailure;
  }
  if (primaryFailure) throw primaryFailure;
  return Object.freeze({
    candidateSha: plan.candidate.sha,
    databaseName: target.databaseName,
    previousSha: plan.previous.sha,
    project,
    runId,
    ownedResourceCount,
    receiptOutput: plan.receiptOutput,
    status: "passed"
  });
}

function usage(exitCode = 0) {
  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write("Usage: /bin/sh scripts/run-migration-compatibility.sh (all inputs are environment variables; see backend/api/README.md)\n");
  process.exit(exitCode);
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) usage(0);
  if (argv.length) usage(2);
  const result = await runMigrationCompatibility();
  process.stdout.write(`Migration compatibility passed: ${result.previousSha} -> ${result.candidateSha} (${result.project})\n`);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
