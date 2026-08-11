#!/usr/bin/env node
/**
 * Candidate evidence capture for Talk&Talk.
 *
 * This script deliberately cannot create a candidate or declare G1/G2. It only
 * records reproducible, non-secret facts from an already frozen detached
 * checkout. External platform evidence, browser/device evidence, and approved
 * migration/rollback exercises remain separate evidence records.
 */
import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { release as osRelease, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SBOM_GENERATOR_NAME,
  SBOM_GENERATOR_VERSION,
  SBOM_SPEC_VERSION,
  generateCandidateSbom,
  validateGeneratedCandidateSbom,
} from "./generate-candidate-sbom.mjs";
import {
  assertCandidateInputPolicy,
  isForbiddenIgnoredCandidateConfig,
} from "./candidate-input-policy.mjs";
import { hashCandidateSourceTree, sha256, stableJson } from "./candidate-source-tree.mjs";

export { sha256, stableJson };

// Schema v5 removes local Docker/E2E execution, distinguishes the static
// preflight from its separately authorized PostgreSQL runtime suite, and
// requires a deterministic, lockfile-bound CycloneDX SBOM. A syntactically
// valid Evidence ID is an audit reference, not authority to create resources.
export const SCHEMA_VERSION = 5;

export const REQUIRED_GATES = Object.freeze([
  "WEB_CHECK",
  "MINI_VALIDATE",
  "MINI_TSC",
  "MINI_SMOKE",
  "MINI_LOCAL_BUILD",
  "MINI_RELEASE",
  "API_PREFLIGHT_STATIC",
  "API_BUILD",
  "API_UNIT",
  "OPENAPI_SCHEMA",
  "API_VERIFY_ARTIFACTS",
  "DIFF_CHECK",
]);

const REQUIRED_SOURCE_PATHS = Object.freeze([
  { path: "backend/api/package-lock.json", kind: "file" },
  { path: "backend/api/package.json", kind: "file" },
  { path: "frontend/miniprogram/package-lock.json", kind: "file" },
  { path: "frontend/miniprogram/package.json", kind: "file" },
  { path: "frontend/web/package-lock.json", kind: "file" },
  { path: "frontend/web/package.json", kind: "file" },
  { path: "shared/contracts/openapi/v1.yaml", kind: "file" },
  { path: "backend/api/prisma/schema.prisma", kind: "file" },
  { path: "backend/api/prisma/migrations", kind: "directory" },
  { path: "backend/api/src/config/first-release-capability-matrix.ts", kind: "file" },
  { path: "frontend/miniprogram/utils/config.ts", kind: "file" },
  { path: "frontend/web/lib/web-surface-policy.ts", kind: "file" },
  { path: ".github/workflows/api.yml", kind: "file" },
  { path: ".github/workflows/miniprogram.yml", kind: "file" },
  { path: ".github/workflows/web.yml", kind: "file" },
  { path: ".github/workflows/g1-candidate.yml", kind: "file" },
  { path: ".github/workflows/g1-candidate-control-plane.yml", kind: "file" },
  { path: "backend/api/Dockerfile", kind: "file" },
  { path: "backend/api/scripts/run-isolated-e2e.sh", kind: "file" },
  { path: "backend/api/scripts/run-migration-compatibility.mjs", kind: "file" },
  { path: "backend/api/scripts/run-migration-compatibility.sh", kind: "file" },
  { path: "backend/api/scripts/run-migration-compatibility.test.mjs", kind: "file" },
  { path: "infra/docker-compose.e2e.yml", kind: "file" },
  { path: "infra/docker-compose.migration-compatibility.yml", kind: "file" },
  { path: "scripts/candidate-evidence.mjs", kind: "file" },
  { path: "scripts/candidate-evidence.test.mjs", kind: "file" },
  { path: "scripts/candidate-input-policy.mjs", kind: "file" },
  { path: "scripts/candidate-input-policy.test.mjs", kind: "file" },
  { path: "scripts/candidate-source-tree.mjs", kind: "file" },
  { path: "scripts/generate-candidate-sbom.mjs", kind: "file" },
  { path: "scripts/generate-candidate-sbom.test.mjs", kind: "file" },
  { path: "scripts/verify-ci-candidate-identity.mjs", kind: "file" },
  { path: "scripts/verify-ci-candidate-identity.test.mjs", kind: "file" },
  { path: "scripts/g1-candidate-ci-contract.test.mjs", kind: "file" },
  { path: "scripts/g2-browser-evidence-card-contract.mjs", kind: "file" },
  { path: "scripts/g2-browser-evidence-card-contract.test.mjs", kind: "file" },
  { path: "scripts/oci-builder-custody-contract.mjs", kind: "file" },
  { path: "scripts/oci-builder-custody-contract.test.mjs", kind: "file" },
  { path: "docs/cto-self-audit/runs/2026-08-08-g1-remediation/candidate-evidence-template.md", kind: "file" },
  { path: "docs/cto-self-audit/runs/2026-08-08-g1-remediation/g2-execution-package.md", kind: "file" },
  { path: "docs/cto-self-audit/runs/2026-08-08-g1-remediation/external-control-plane-oci-custody-contract.md", kind: "file" },
].map((entry) => Object.freeze(entry)));

const ARTIFACT_REQUIREMENTS = Object.freeze({
  web: {
    root: "frontend/web/dist",
    required: ["server/index.js", "server/wrangler.json", "client/_headers"],
  },
  api: {
    root: "backend/api/dist",
    required: [
      "src/main.js",
      "src/database/seed.js",
      "src/database/bootstrap-staff.js",
      "src/database/bootstrap-review-staff.js",
      "config/transactional-template-manifest.js",
    ],
  },
  apiGenerated: {
    root: "backend/api/generated/prisma",
    required: ["client.ts", "models.ts", "internal/class.ts"],
  },
  miniReleaseSource: {
    root: "frontend/miniprogram",
    required: ["app.json", "project.config.json", "utils/config.ts", "package.json", "package-lock.json"],
    ignoredNames: new Set(["node_modules", "miniprogram_npm", "project.private.config.json", ".DS_Store"]),
  },
});

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVIDENCE_ID_PATTERN = /^E[A-Z0-9]*(?:-[A-Z0-9][A-Z0-9._-]*)+$/;
const VAULT_REFERENCE_PATTERN = /^vault:\/\/[A-Za-z0-9][A-Za-z0-9._/-]{2,159}(?:#[A-Za-z0-9._-]+)?$/;
const GENERATED_ARTIFACTS_BY_GATE = Object.freeze({
  WEB_CHECK: ["web"],
  API_BUILD: ["api", "apiGenerated"],
});

function usage(exitCode = 0) {
  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write(`Usage:\n\n` +
    `  node scripts/candidate-evidence.mjs begin --sha <40-hex-sha> --source-ref <ref> --out <absolute-external-directory>\n` +
    `  node scripts/candidate-evidence.mjs run --freeze <absolute-freeze-json> --gate <${REQUIRED_GATES.join("|")}> [--mini-app-id-ref <vault-reference>]\n` +
    `  node scripts/candidate-evidence.mjs sbom --freeze <absolute-freeze-json> --out <absolute-external-sbom-json>\n` +
    `  node scripts/candidate-evidence.mjs finalize --freeze <absolute-freeze-json> --sbom <absolute-sbom-file> --reviewer-evidence <Evidence-ID> --cleanup-evidence <Evidence-ID>\n` +
    `  node scripts/candidate-evidence.mjs compare --left <absolute-manifest-json> --right <absolute-manifest-json>\n`);
  process.exit(exitCode);
}

function fail(message) {
  const error = new Error(message);
  error.code = "CANDIDATE_EVIDENCE_ERROR";
  throw error;
}

function assertSafeInvokerEnvironment() {
  if (String(process.env.NODE_OPTIONS ?? "").trim()) {
    fail("NODE_OPTIONS must be empty before candidate evidence capture can start");
  }
  if (String(process.env.NODE_PATH ?? "").trim()) {
    fail("NODE_PATH must be empty before candidate evidence capture can start");
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`Cannot read JSON ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeJson(path, value) {
  writeFileSync(path, stableJson(value), "utf8");
}

function normalizeRelative(path) {
  return path.split(sep).join("/");
}

function pathInside(parent, child) {
  const relation = relative(parent, child);
  return relation === "" || (relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation));
}

function requireAbsoluteExistingParent(path, description) {
  if (!isAbsolute(path)) fail(`${description} must be an absolute path`);
  const parent = dirname(path);
  if (!existsSync(parent)) fail(`${description} parent does not exist: ${parent}`);
  return resolve(realpathSync(parent), path.split(sep).pop() || "");
}

function trustedGitExecutable() {
  const candidates = process.platform === "win32"
    ? []
    : ["/usr/bin/git", "/bin/git"];
  const executable = candidates.find((candidate) => existsSync(candidate) && lstatSync(candidate).isFile() && !lstatSync(candidate).isSymbolicLink());
  if (!executable) fail("Candidate evidence requires a trusted absolute git executable; a PATH-resolved git is not accepted");
  return executable;
}

function trustedNpmCli() {
  const nodeRoot = dirname(dirname(process.execPath));
  const candidates = [
    join(nodeRoot, "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    join(dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ].map((candidate) => resolve(candidate));
  const cli = candidates.find((candidate) => existsSync(candidate) && lstatSync(candidate).isFile() && !lstatSync(candidate).isSymbolicLink());
  if (!cli) fail("Candidate evidence requires an npm CLI colocated with the active Node runtime; a PATH-resolved npm is not accepted");
  return cli;
}

function trustedTypeScriptCli(root) {
  const candidate = join(root, "backend", "api", "node_modules", "typescript", "lib", "tsc.js");
  if (!existsSync(candidate) || !lstatSync(candidate).isFile() || lstatSync(candidate).isSymbolicLink()) {
    fail("MINI_TSC requires the regular TypeScript CLI from backend/api/node_modules/typescript/lib/tsc.js");
  }
  return realpathSync(candidate);
}

function trustedChildPath() {
  const candidates = [dirname(process.execPath), "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  return [...new Set(candidates.filter((candidate) => existsSync(candidate) && statSync(candidate).isDirectory()))].join(sep === "\\" ? ";" : ":");
}

function safeGitEnvironment() {
  return {
    PATH: trustedChildPath(),
    HOME: join(tmpdir(), "talkandtalk-candidate-git-home"),
    NODE_OPTIONS: "",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
}

function git(root, args, options = {}) {
  const result = spawnSync(trustedGitExecutable(), args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    env: safeGitEnvironment(),
  });
  if (result.error) fail(`Unable to run git ${args.join(" ")}: ${result.error.message}`);
  if (result.status !== 0 && !options.allowFailure) {
    const detail = `${result.stdout || ""}${result.stderr || ""}`.trim();
    fail(`git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function gitTrim(root, args) {
  return git(root, args).stdout.trim();
}

function parseOptions(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") usage(command ? 0 : 2);
  const allowed = {
    begin: new Set(["sha", "sourceRef", "out"]),
    run: new Set(["freeze", "gate", "miniAppIdRef"]),
    sbom: new Set(["freeze", "out"]),
    finalize: new Set(["freeze", "sbom", "reviewerEvidence", "cleanupEvidence"]),
    compare: new Set(["left", "right"]),
  }[command];
  if (!allowed) fail(`Unsupported command: ${command}`);
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (!argument.startsWith("--")) fail(`Unexpected argument: ${argument}`);
    const key = argument.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    if (!allowed.has(key)) fail(`${argument} is not accepted for ${command}`);
    const value = rest[++index];
    if (!value || value.startsWith("--")) fail(`${argument} requires a value`);
    if (Object.hasOwn(options, key)) fail(`${argument} may be supplied only once`);
    options[key] = value;
  }
  return { command, options };
}

function requireOption(options, key) {
  const value = options[key];
  if (!value) fail(`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
  return value;
}

function requireEvidenceId(value, label) {
  if (typeof value !== "string" || !EVIDENCE_ID_PATTERN.test(value)) {
    fail(`${label} must be a non-secret canonical Evidence ID`);
  }
  return value;
}

function requireVaultReference(value, label) {
  if (typeof value !== "string" || !VAULT_REFERENCE_PATTERN.test(value)) {
    fail(`${label} must be a non-secret vault:// reference`);
  }
  if (/^vault:\/\/wx[a-zA-Z0-9]{16}(?:#|$)/.test(value)) {
    fail(`${label} must name a vault path, not embed a raw Mini Program AppID`);
  }
  return value;
}

function assertRegularFile(path, label) {
  if (!existsSync(path) || !lstatSync(path).isFile()) fail(`${label} is missing or not a regular file: ${path}`);
}

function assertCandidateInputs(root) {
  assertCandidateInputPolicy({
    gitText(args) {
      return git(root, args).stdout;
    },
    fail,
  });
}

function assertRequiredSourcePaths(root) {
  for (const { path, kind } of REQUIRED_SOURCE_PATHS) {
    const result = git(root, ["ls-files", "--error-unmatch", "--", path], { allowFailure: true });
    if (result.status !== 0) fail(`Candidate is missing required tracked source path: ${path}`);
    const sourcePath = join(root, path);
    if (!existsSync(sourcePath)) fail(`Candidate source path is missing from checkout: ${path}`);
    const metadata = lstatSync(sourcePath);
    const hasExpectedKind = kind === "file" ? metadata.isFile() : kind === "directory" && metadata.isDirectory();
    if (metadata.isSymbolicLink() || !hasExpectedKind) {
      fail(`Candidate required source path must be a non-symbolic-link ${kind}: ${path}`);
    }
  }
}

function ignoredPaths(root) {
  return git(root, ["status", "--ignored", "--porcelain=v1", "--untracked-files=all"])
    .stdout
    .split("\n")
    .filter((line) => line.startsWith("!! "))
    .map((line) => line.slice(3).trim().replace(/^"|"$/g, ""))
    .map((path) => path.replace(/\\\\/g, "/"));
}

function artifactNameForIgnoredPath(path) {
  if (path === "frontend/web/dist" || path.startsWith("frontend/web/dist/")) return "web";
  if (path === "backend/api/dist" || path.startsWith("backend/api/dist/")) return "api";
  if (path === "backend/api/generated/prisma" || path.startsWith("backend/api/generated/prisma/")) return "apiGenerated";
  return null;
}

function assertControlledIgnoredInputs(root, allowedGeneratedArtifacts = new Set()) {
  for (const path of ignoredPaths(root)) {
    if (isForbiddenIgnoredCandidateConfig(path)) {
      fail(`Candidate contains an ignored configuration input that can affect a gate: ${path}`);
    }
    const artifact = artifactNameForIgnoredPath(path);
    if (artifact && !allowedGeneratedArtifacts.has(artifact)) {
      fail(`Candidate contains a stale generated artifact before its recorded build gate: ${path}`);
    }
  }
}

export function ensureCandidateState(root, candidateSha, sourceRef, options = {}) {
  const normalizedRoot = realpathSync(root);
  if (!SHA_PATTERN.test(candidateSha)) fail("--sha must be an exact lowercase 40-character Git SHA");
  const repoRoot = realpathSync(gitTrim(normalizedRoot, ["rev-parse", "--show-toplevel"]));
  if (repoRoot !== normalizedRoot) fail(`Run from the repository root, not ${normalizedRoot}`);

  const head = gitTrim(repoRoot, ["rev-parse", "HEAD"]);
  if (head !== candidateSha) fail(`HEAD ${head} does not match requested candidate SHA ${candidateSha}`);
  const resolvedSourceRef = gitTrim(repoRoot, ["rev-parse", "--verify", `${sourceRef}^{commit}`]);
  if (resolvedSourceRef !== candidateSha) {
    fail(`Source ref ${sourceRef} resolves to ${resolvedSourceRef}, not candidate SHA ${candidateSha}`);
  }
  const symbolicRef = git(repoRoot, ["symbolic-ref", "-q", "--short", "HEAD"], { allowFailure: true });
  if (symbolicRef.status === 0) {
    fail(`Candidate checkout must be detached; HEAD is attached to ${symbolicRef.stdout.trim()}`);
  }
  const diffCheck = git(repoRoot, ["diff", "--check"]);
  if (diffCheck.stdout.trim()) fail("git diff --check produced output");
  const status = gitTrim(repoRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status) fail(`Candidate checkout is dirty or contains untracked files:\n${status}`);
  assertCandidateInputs(repoRoot);
  assertRequiredSourcePaths(repoRoot);
  assertControlledIgnoredInputs(repoRoot, options.allowedGeneratedArtifacts || new Set());
  return {
    repoRoot,
    head,
    parent: gitTrim(repoRoot, ["rev-parse", "HEAD^"]),
    sourceRef,
    sourceRefSha: resolvedSourceRef,
    gitVersion: gitTrim(repoRoot, ["--version"]),
  };
}

function fileEntry(root, absolutePath, relativePath) {
  const stat = lstatSync(absolutePath);
  if (stat.isSymbolicLink()) {
    const target = readlinkSync(absolutePath, "utf8");
    return { path: relativePath, kind: "symlink", mode: stat.mode & 0o777, sha256: sha256(target) };
  }
  if (!stat.isFile()) fail(`Expected a regular file: ${relative(root, absolutePath)}`);
  return {
    path: relativePath,
    kind: "file",
    mode: stat.mode & 0o777,
    bytes: stat.size,
    sha256: sha256(readFileSync(absolutePath)),
  };
}

export function hashDirectory(root, directory, options = {}) {
  const absoluteDirectory = resolve(root, directory);
  if (!existsSync(absoluteDirectory) || !lstatSync(absoluteDirectory).isDirectory() || lstatSync(absoluteDirectory).isSymbolicLink()) {
    fail(`Required artifact directory is missing: ${normalizeRelative(directory)}`);
  }
  const ignoredNames = options.ignoredNames || new Set();
  const entries = [];
  const visit = (absolute, localRelative) => {
    for (const child of readdirSync(absolute, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (ignoredNames.has(child.name)) continue;
      const nextAbsolute = join(absolute, child.name);
      const nextRelative = normalizeRelative(join(localRelative, child.name));
      if (child.isDirectory()) {
        visit(nextAbsolute, nextRelative);
      } else {
        if (child.isSymbolicLink()) fail(`Artifact contains a symbolic link: ${normalizeRelative(join(directory, nextRelative))}`);
        entries.push(fileEntry(root, nextAbsolute, nextRelative));
      }
    }
  };
  visit(absoluteDirectory, "");
  if (!entries.length) fail(`Artifact directory is empty: ${normalizeRelative(directory)}`);
  const treeSha256 = sha256(stableJson(entries));
  return { root: normalizeRelative(directory), entries, treeSha256 };
}

export function hashGitTree(root) {
  try {
    return hashCandidateSourceTree(root, git(root, ["ls-tree", "-r", "HEAD"]).stdout);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function producedArtifactNames(gate) {
  return GENERATED_ARTIFACTS_BY_GATE[gate] || [];
}

function artifactSnapshots(root, names) {
  return Object.fromEntries(names.map((name) => {
    const requirement = ARTIFACT_REQUIREMENTS[name];
    assertRequiredArtifactFiles(root, requirement);
    return [name, hashDirectory(root, requirement.root, { ignoredNames: requirement.ignoredNames })];
  }));
}

function assertArtifactSnapshots(root, artifacts, label) {
  if (!artifacts || typeof artifacts !== "object" || Array.isArray(artifacts)) {
    fail(`${label} is missing its generated-artifact manifest`);
  }
  for (const [name, recorded] of Object.entries(artifacts)) {
    const requirement = ARTIFACT_REQUIREMENTS[name];
    if (!requirement || !recorded || typeof recorded !== "object" || !SHA256_PATTERN.test(recorded.treeSha256 || "")) {
      fail(`${label} has an invalid generated-artifact entry: ${name}`);
    }
    const current = hashDirectory(root, requirement.root, { ignoredNames: requirement.ignoredNames });
    if (current.treeSha256 !== recorded.treeSha256 || stableJson(current) !== stableJson(recorded)) {
      fail(`${label} generated artifact changed after its recorded build gate: ${name}`);
    }
  }
}

function completedArtifactNames(outputDirectory, candidateSha, sourceTreeSha256) {
  const names = new Set();
  for (const gate of Object.keys(GENERATED_ARTIFACTS_BY_GATE)) {
    const path = gateFile(outputDirectory, gate);
    if (!existsSync(path)) continue;
    const record = readJson(path);
    if (
      record?.kind === "talk-and-talk-candidate-gate-record"
      && record.schemaVersion === SCHEMA_VERSION
      && record.gate === gate
      && record.candidateSha === candidateSha
      && record.sourceTreeSha256 === sourceTreeSha256
      && record.exitCode === 0
      && record.skipped === 0
    ) {
      for (const name of producedArtifactNames(gate)) names.add(name);
    }
  }
  return names;
}

function assertCompletedArtifactIntegrity(root, outputDirectory, candidateSha, sourceTreeSha256) {
  for (const gate of Object.keys(GENERATED_ARTIFACTS_BY_GATE)) {
    const path = gateFile(outputDirectory, gate);
    if (!existsSync(path)) continue;
    const record = readJson(path);
    if (
      record?.kind === "talk-and-talk-candidate-gate-record"
      && record.schemaVersion === SCHEMA_VERSION
      && record.gate === gate
      && record.candidateSha === candidateSha
      && record.sourceTreeSha256 === sourceTreeSha256
      && record.exitCode === 0
      && record.skipped === 0
    ) {
      assertArtifactSnapshots(root, record.generatedArtifacts, `Gate ${gate}`);
    }
  }
}

function assertRequiredArtifactFiles(root, artifact) {
  for (const required of artifact.required) {
    const absolute = join(root, artifact.root, required);
    if (!existsSync(absolute) || !lstatSync(absolute).isFile()) {
      fail(`Required artifact is missing: ${normalizeRelative(join(artifact.root, required))}`);
    }
  }
}

function createOutputDirectory(root, requestedOutput) {
  const output = requireAbsoluteExistingParent(requestedOutput, "--out");
  if (pathInside(root, output)) fail("--out must be outside the repository");
  if (existsSync(output)) fail(`--out must not already exist: ${output}`);
  mkdirSync(output, { recursive: false });
  for (const child of ["gates", "logs", "manifests"]) mkdirSync(join(output, child));
  return output;
}

function captureToolchain(outputDirectory, gitVersion) {
  const npmCli = trustedNpmCli();
  const result = spawnSync(process.execPath, [npmCli, "--version"], {
    encoding: "utf8",
    env: safeChildEnvironment(outputDirectory),
  });
  if (result.error || result.status !== 0) {
    const detail = `${result.stdout || ""}${result.stderr || ""}`.trim();
    fail(`Unable to capture npm version${detail ? `: ${detail}` : ""}`);
  }
  const npmVersion = (result.stdout || "").trim();
  if (!npmVersion) fail("Unable to capture npm version");
  return {
    platform: process.platform,
    architecture: process.arch,
    osRelease: osRelease(),
    node: { executable: process.execPath, version: process.version },
    npm: { command: "npm", cli: npmCli, cliSha256: sha256(readFileSync(npmCli)), version: npmVersion },
    git: { command: "git", executable: trustedGitExecutable(), version: gitVersion },
  };
}

function freezePath(output) {
  return join(output, "00-freeze.json");
}

function now() {
  return new Date().toISOString();
}

export function beginCapture({ root = process.cwd(), candidateSha, sourceRef, output }) {
  assertSafeInvokerEnvironment();
  const state = ensureCandidateState(root, candidateSha, sourceRef);
  const source = hashGitTree(state.repoRoot);
  const outputDirectory = createOutputDirectory(state.repoRoot, output);
  const toolchain = captureToolchain(outputDirectory, state.gitVersion);
  const freeze = {
    schemaVersion: SCHEMA_VERSION,
    kind: "talk-and-talk-candidate-freeze",
    createdAt: now(),
    candidateSha: state.head,
    parentSha: state.parent,
    sourceRef: state.sourceRef,
    sourceRefSha: state.sourceRefSha,
    gitVersion: state.gitVersion,
    toolchain,
    captureId: randomUUID(),
    checkoutFingerprint: sha256(state.repoRoot),
    sourceTreeSha256: source.treeSha256,
  };
  writeJson(freezePath(outputDirectory), freeze);
  writeJson(join(outputDirectory, "manifests", "source-tree.json"), source);
  return { outputDirectory, freeze, source };
}

function loadFreeze(requestedFreeze, root = process.cwd()) {
  if (!isAbsolute(requestedFreeze)) fail("--freeze must be an absolute path");
  const path = resolve(requestedFreeze);
  assertRegularFile(path, "Freeze record");
  if (lstatSync(path).isSymbolicLink()) fail("Freeze record must not be a symbolic link");
  const freeze = readJson(path);
  if (
    freeze?.kind !== "talk-and-talk-candidate-freeze"
    || freeze.schemaVersion !== SCHEMA_VERSION
    || !SHA_PATTERN.test(freeze.candidateSha || "")
    || !SHA_PATTERN.test(freeze.parentSha || "")
    || !SHA256_PATTERN.test(freeze.sourceTreeSha256 || "")
    || !UUID_PATTERN.test(freeze.captureId || "")
    || !SHA256_PATTERN.test(freeze.checkoutFingerprint || "")
    || !freeze.toolchain
  ) {
    fail(`Invalid freeze record: ${path}`);
  }
  const outputDirectory = dirname(realpathSync(path));
  if (!lstatSync(outputDirectory).isDirectory() || lstatSync(outputDirectory).isSymbolicLink()) {
    fail("Candidate evidence output directory must be a real directory");
  }
  const repoRoot = realpathSync(gitTrim(root, ["rev-parse", "--show-toplevel"]));
  if (pathInside(repoRoot, outputDirectory)) fail("Freeze record must remain outside the candidate repository");
  return { path, freeze, outputDirectory, repoRoot };
}

function safeChildEnvironment(outputDirectory, extra = {}) {
  const toolingRoot = join(outputDirectory, "tooling");
  const home = join(toolingRoot, "home");
  const temporary = join(toolingRoot, "tmp");
  const npmCache = join(toolingRoot, "npm-cache");
  const npmrc = join(home, ".npmrc");
  const globalNpmrc = join(toolingRoot, "npm-globalrc");
  mkdirSync(home, { recursive: true });
  mkdirSync(temporary, { recursive: true });
  mkdirSync(npmCache, { recursive: true });
  if (!existsSync(npmrc)) writeFileSync(npmrc, "", "utf8");
  if (!existsSync(globalNpmrc)) writeFileSync(globalNpmrc, "", "utf8");
  const trustedPath = trustedChildPath();
  if (!trustedPath) fail("Candidate gate requires a trusted system PATH");
  return {
    PATH: trustedPath,
    CI: "true",
    NO_COLOR: "1",
    HOME: home,
    TMPDIR: temporary,
    TMP: temporary,
    TEMP: temporary,
    NODE_OPTIONS: "",
    NODE_PATH: "",
    npm_config_userconfig: npmrc,
    NPM_CONFIG_USERCONFIG: npmrc,
    npm_config_cache: npmCache,
    NPM_CONFIG_CACHE: npmCache,
    npm_config_globalconfig: globalNpmrc,
    NPM_CONFIG_GLOBALCONFIG: globalNpmrc,
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    NPM_CONFIG_OFFLINE: "true",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    ...extra,
  };
}

function gateCommand(root, gate, options) {
  const node = process.execPath;
  const npmCli = trustedNpmCli();
  const api = join(root, "backend", "api");
  const miniValidate = join(root, "frontend", "miniprogram", "scripts", "validate.mjs");
  const npmCommand = (args, cwd) => ({ command: node, args: [npmCli, "run", ...args], cwd, display: `npm run ${args.join(" ")}` });
  const commands = {
    WEB_CHECK: npmCommand(["check"], join(root, "frontend", "web")),
    MINI_VALIDATE: { command: node, args: [miniValidate], cwd: root },
    MINI_SMOKE: { command: node, args: [join(root, "frontend", "miniprogram", "scripts", "smoke.mjs")], cwd: root },
    MINI_LOCAL_BUILD: { command: node, args: [join(root, "frontend", "miniprogram", "scripts", "test-local-build.mjs")], cwd: root },
    API_PREFLIGHT_STATIC: npmCommand(["test:preflight:static"], api),
    API_BUILD: npmCommand(["build"], api),
    API_UNIT: npmCommand(["test"], api),
    OPENAPI_SCHEMA: { command: node, args: [join(api, "scripts", "openapi-controller-contract.test.mjs")], cwd: api },
    API_VERIFY_ARTIFACTS: npmCommand(["verify:prod-artifacts"], api),
  };
  if (gate === "DIFF_CHECK") return { internal: true };
  if (gate === "MINI_TSC") {
    return {
      command: node,
      args: [trustedTypeScriptCli(root), "-p", join(root, "frontend", "miniprogram", "tsconfig.json"), "--noEmit"],
      cwd: root,
    };
  }
  if (gate === "MINI_RELEASE") {
    const appId = options.miniAppId || process.env.WECHAT_MINIPROGRAM_APP_ID || "";
    if (!options.miniAppIdRef) fail("MINI_RELEASE requires --mini-app-id-ref; use a vault reference, never the AppID value");
    const miniAppIdRef = requireVaultReference(options.miniAppIdRef, "--mini-app-id-ref");
    if (!/^wx[a-zA-Z0-9]{16}$/.test(appId)) {
      fail("MINI_RELEASE requires WECHAT_MINIPROGRAM_APP_ID to be injected as a valid wx-prefixed AppID");
    }
    return {
      command: node,
      args: [miniValidate],
      cwd: root,
      environment: { MINIPROGRAM_RELEASE: "1", WECHAT_MINIPROGRAM_APP_ID: appId },
      redactions: [appId],
      miniAppIdRef,
      label: `WECHAT_MINIPROGRAM_APP_ID=<vault:${miniAppIdRef}>`,
    };
  }
  const command = commands[gate];
  if (!command) fail(`Unsupported gate: ${gate}`);
  return command;
}

export function skippedCount(output) {
  const text = String(output ?? "").replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
  const statuses = "skipped|todo|pending|cancelled";
  const lines = text.split(/\r?\n/);
  const outcomeCount = (line) => {
    const outcome = new RegExp(`\\b(\\d+)\\s+(${statuses})\\b`, "gi");
    return [...line.matchAll(outcome)].reduce((sum, match) => sum + Number(match[1] || 0), 0);
  };

  let jestTotal = 0;
  for (let index = 0; index + 4 < lines.length; index += 1) {
    // A real Jest footer is a complete, unindented block. Jest indents a
    // test's console output, so a log such as `Tests: 2 skipped, 2 total`
    // cannot become a synthetic outcome.
    if (
      /^Test Suites:\s+.*\btotal\b/i.test(lines[index])
      && /^Tests:\s+.*\btotal\b/i.test(lines[index + 1])
      && /^Snapshots:\s+.*\btotal\b/i.test(lines[index + 2])
      && /^Time:\s+/i.test(lines[index + 3])
      && /^Ran all test suites\b/i.test(lines[index + 4])
    ) {
      jestTotal += outcomeCount(lines[index]) + outcomeCount(lines[index + 1]);
    }
  }

  let tapTotal = 0;
  let hasTapSummary = false;
  for (let index = 0; index + 7 < lines.length; index += 1) {
    // Node's terminal TAP block follows the final top-level plan and includes
    // every aggregate counter. Console output can be prefixed with `# `, so a
    // bare `# skipped N` is never sufficient evidence by itself.
    if (
      /^1\.\.\d+\s*$/.test(lines[index])
      && /^# tests \d+\s*$/i.test(lines[index + 1])
      && /^# suites \d+\s*$/i.test(lines[index + 2])
      && /^# pass \d+\s*$/i.test(lines[index + 3])
      && /^# fail \d+\s*$/i.test(lines[index + 4])
      && /^# cancelled \d+\s*$/i.test(lines[index + 5])
      && /^# skipped \d+\s*$/i.test(lines[index + 6])
      && /^# todo \d+\s*$/i.test(lines[index + 7])
    ) {
      hasTapSummary = true;
      for (const line of lines.slice(index + 5, index + 8)) {
        tapTotal += Number(line.match(/\d+/)?.[0] || 0);
      }
    }
  }

  const hasTapHeader = lines.some((line) => /^TAP version \d+\s*$/i.test(line));
  const inlineTapTotal = hasTapHeader
    ? (text.match(/^ok\s+\d+\b[^\r\n]*#\s*(?:SKIP|TODO)\b/gim) ?? []).length
    : 0;
  return jestTotal + (hasTapSummary ? Math.max(tapTotal, inlineTapTotal) : inlineTapTotal);
}

function redact(output, secrets) {
  let redacted = secrets.reduce((result, secret) => secret ? result.split(secret).join("<redacted>") : result, output);
  let potentialSecretCount = 0;
  const replace = (pattern) => {
    redacted = redacted.replace(pattern, (match) => {
      potentialSecretCount += 1;
      return "<redacted-potential-secret>";
    });
  };
  replace(/\bwx[a-zA-Z0-9]{16}\b/g);
  replace(/\b(?:sk|rk)_[A-Za-z0-9_-]{16,}\b/g);
  replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]{16,}\b/gi);
  replace(/\b[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY)[A-Z0-9_]*\s*[=:]\s*[^\s"']+/g);
  return { output: redacted, potentialSecretCount };
}

function commandDisplay(command) {
  if (command.internal) return "git diff --check and candidate-state verification";
  if (command.display) return [command.label, command.display].filter(Boolean).join(" ");
  const executable = command.command === process.execPath ? "node" : command.command;
  return [command.label, executable, ...command.args].filter(Boolean).join(" ");
}

function expectedGateCommandDisplay(root, gate, record) {
  const options = {};
  if (gate === "MINI_RELEASE") {
    options.miniAppIdRef = requireVaultReference(record.miniAppIdRef, `Gate ${gate} miniAppIdRef`);
    options.miniAppId = "wx0000000000000000";
  }
  return commandDisplay(gateCommand(root, gate, options));
}

function gateFile(outputDirectory, gate) {
  return join(outputDirectory, "gates", `${gate}.json`);
}

export function runGate({ root = process.cwd(), freezePath: requestedFreeze, gate, options = {} }) {
  assertSafeInvokerEnvironment();
  if (!REQUIRED_GATES.includes(gate)) fail(`--gate must be one of ${REQUIRED_GATES.join(", ")}`);
  const loaded = loadFreeze(requestedFreeze, root);
  const completedBefore = completedArtifactNames(
    loaded.outputDirectory,
    loaded.freeze.candidateSha,
    loaded.freeze.sourceTreeSha256,
  );
  const stateBefore = ensureCandidateState(root, loaded.freeze.candidateSha, loaded.freeze.sourceRef, {
    allowedGeneratedArtifacts: completedBefore,
  });
  assertCompletedArtifactIntegrity(
    stateBefore.repoRoot,
    loaded.outputDirectory,
    loaded.freeze.candidateSha,
    loaded.freeze.sourceTreeSha256,
  );
  const sourceBefore = hashGitTree(stateBefore.repoRoot);
  if (sourceBefore.treeSha256 !== loaded.freeze.sourceTreeSha256) fail("Source tree hash changed after freeze");

  const command = gateCommand(stateBefore.repoRoot, gate, options);
  const startedAt = now();
  let output = "";
  let exitCode = 0;
  if (command.internal) {
    // ensureCandidateState above already performed the integrity command.
    output = "Candidate state and git diff --check passed.\n";
  } else {
    const result = spawnSync(command.command, command.args, {
      cwd: command.cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: safeChildEnvironment(loaded.outputDirectory, command.environment),
    });
    output = `${result.stdout || ""}${result.stderr || ""}`;
    exitCode = result.error ? 1 : (result.status ?? 1);
    if (result.error) output += `\nUnable to launch command: ${result.error.message}\n`;
  }
  const redaction = redact(output, command.redactions || []);
  const redactedOutput = redaction.output;
  const logPath = join(loaded.outputDirectory, "logs", `${gate}.log`);
  writeFileSync(logPath, redactedOutput, "utf8");

  let stateAfter;
  let sourceAfter;
  let candidateError = null;
  const skipped = skippedCount(redactedOutput);
  if (skipped > 0) {
    candidateError = `Gate output reports ${skipped} skipped, todo, pending, or cancelled checks`;
    exitCode = exitCode || 1;
  }
  if (redaction.potentialSecretCount > 0) {
    candidateError = candidateError || "Gate output contained a potential secret and was redacted";
    exitCode = exitCode || 1;
  }
  try {
    const completedAfter = new Set([...completedBefore, ...producedArtifactNames(gate)]);
    stateAfter = ensureCandidateState(root, loaded.freeze.candidateSha, loaded.freeze.sourceRef, {
      allowedGeneratedArtifacts: completedAfter,
    });
    sourceAfter = hashGitTree(stateAfter.repoRoot);
    if (sourceAfter.treeSha256 !== loaded.freeze.sourceTreeSha256) fail("Source tree hash changed while running the gate");
  } catch (error) {
    candidateError = error instanceof Error ? error.message : String(error);
    exitCode = exitCode || 1;
  }
  const record = {
    schemaVersion: SCHEMA_VERSION,
    kind: "talk-and-talk-candidate-gate-record",
    gate,
    candidateSha: loaded.freeze.candidateSha,
    sourceTreeSha256: loaded.freeze.sourceTreeSha256,
    startedAt,
    finishedAt: now(),
    command: commandDisplay(command),
    exitCode,
    skipped,
    logSha256: sha256(redactedOutput),
    redactedPotentialSecretCount: redaction.potentialSecretCount,
    ...(command.miniAppIdRef ? { miniAppIdRef: command.miniAppIdRef } : {}),
    ...(exitCode === 0 && !candidateError
      ? { generatedArtifacts: artifactSnapshots(stateAfter.repoRoot, producedArtifactNames(gate)) }
      : {}),
    ...(candidateError ? { candidateStateError: candidateError } : {}),
  };
  writeJson(gateFile(loaded.outputDirectory, gate), record);
  if (exitCode !== 0 || candidateError) fail(`${gate} failed; see ${logPath}`);
  return record;
}

function validateGateRecord(root, outputDirectory, gate, record, candidateSha, sourceTreeSha256) {
  if (!record || typeof record !== "object" || Array.isArray(record)) fail(`Gate ${gate} record is invalid`);
  if (record.schemaVersion !== SCHEMA_VERSION || record.kind !== "talk-and-talk-candidate-gate-record") {
    fail(`Gate ${gate} record has an unsupported schema or kind`);
  }
  if (record.gate !== gate) fail(`Gate ${gate} record names a different gate: ${record.gate || "missing"}`);
  if (record.candidateSha !== candidateSha || record.sourceTreeSha256 !== sourceTreeSha256) {
    fail(`Gate ${gate} belongs to a different candidate or source tree`);
  }
  if (record.exitCode !== 0) fail(`Gate ${gate} did not pass`);
  if (!Number.isInteger(record.skipped) || record.skipped !== 0) fail(`Gate ${gate} recorded ${record.skipped} skipped checks`);
  if (!Number.isInteger(record.redactedPotentialSecretCount) || record.redactedPotentialSecretCount !== 0) {
    fail(`Gate ${gate} recorded potential-secret redactions`);
  }
  if (!SHA256_PATTERN.test(record.logSha256 || "")) fail(`Gate ${gate} log hash is invalid`);
  const expectedCommand = expectedGateCommandDisplay(root, gate, record);
  if (record.command !== expectedCommand) fail(`Gate ${gate} command does not match the allowlisted recipe`);
  const produced = producedArtifactNames(gate);
  if (produced.length) {
    if (!record.generatedArtifacts || Object.keys(record.generatedArtifacts).length !== produced.length) {
      fail(`Gate ${gate} must record exactly its generated artifacts`);
    }
    for (const name of produced) {
      if (!record.generatedArtifacts[name]) fail(`Gate ${gate} is missing generated artifact ${name}`);
    }
  } else if (record.generatedArtifacts && Object.keys(record.generatedArtifacts).length !== 0) {
    fail(`Gate ${gate} must not claim generated artifacts`);
  }
  const logPath = join(outputDirectory, "logs", `${gate}.log`);
  assertRegularFile(logPath, `Gate ${gate} log`);
  if (lstatSync(logPath).isSymbolicLink()) fail(`Gate ${gate} log must not be a symbolic link`);
  if (sha256(readFileSync(logPath)) !== record.logSha256) fail(`Gate ${gate} log hash does not match its record`);
  return record;
}

function requiredGateRecords(root, outputDirectory, candidateSha, sourceTreeSha256) {
  return REQUIRED_GATES.map((gate) => {
    const path = gateFile(outputDirectory, gate);
    if (!existsSync(path)) fail(`Missing required gate record: ${gate}`);
    assertRegularFile(path, `Gate ${gate} record`);
    if (lstatSync(path).isSymbolicLink()) fail(`Gate ${gate} record must not be a symbolic link`);
    return validateGateRecord(root, outputDirectory, gate, readJson(path), candidateSha, sourceTreeSha256);
  });
}

function hashSingleFile(path, label, root) {
  if (!isAbsolute(path)) fail(`${label} must be an absolute path`);
  assertRegularFile(path, label);
  if (lstatSync(path).isSymbolicLink()) fail(`${label} must not be a symbolic link`);
  const canonical = realpathSync(path);
  if (root && pathInside(realpathSync(root), canonical)) fail(`${label} must be stored outside the candidate repository`);
  return { name: label, bytes: statSync(canonical).size, sha256: sha256(readFileSync(canonical)) };
}

export function generateSbomForFreeze({ root = process.cwd(), freezePath: requestedFreeze, output }) {
  assertSafeInvokerEnvironment();
  const loaded = loadFreeze(requestedFreeze, root);
  const generatedArtifacts = completedArtifactNames(
    loaded.outputDirectory,
    loaded.freeze.candidateSha,
    loaded.freeze.sourceTreeSha256,
  );
  const state = ensureCandidateState(root, loaded.freeze.candidateSha, loaded.freeze.sourceRef, {
    allowedGeneratedArtifacts: generatedArtifacts,
  });
  assertCompletedArtifactIntegrity(
    state.repoRoot,
    loaded.outputDirectory,
    loaded.freeze.candidateSha,
    loaded.freeze.sourceTreeSha256,
  );
  const source = hashGitTree(state.repoRoot);
  if (source.treeSha256 !== loaded.freeze.sourceTreeSha256) {
    fail("Source tree hash changed after freeze; refusing to generate a candidate SBOM");
  }
  const result = generateCandidateSbom({
    root: state.repoRoot,
    candidateSha: loaded.freeze.candidateSha,
    sourceTreeSha256: loaded.freeze.sourceTreeSha256,
    outputPath: output,
  });
  const provenance = validateGeneratedCandidateSbom(result.document, {
    root: state.repoRoot,
    candidateSha: loaded.freeze.candidateSha,
    sourceTreeSha256: loaded.freeze.sourceTreeSha256,
  });
  return { ...result, provenance };
}

export function validateSbom(path, root, expectedCandidate = undefined) {
  const descriptor = hashSingleFile(path, "sbom", root);
  let document;
  try {
    document = JSON.parse(readFileSync(realpathSync(path), "utf8"));
  } catch (error) {
    fail(`SBOM must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (expectedCandidate) {
    if (!expectedCandidate.candidateSha || !expectedCandidate.sourceTreeSha256) {
      fail("Candidate SBOM validation requires the frozen candidate SHA and source tree hash");
    }
    const provenance = validateGeneratedCandidateSbom(document, {
      root,
      candidateSha: expectedCandidate.candidateSha,
      sourceTreeSha256: expectedCandidate.sourceTreeSha256,
    });
    return { ...descriptor, ...provenance };
  }
  if (document?.bomFormat === "CycloneDX" && typeof document.specVersion === "string") {
    const tools = Array.isArray(document.metadata?.tools)
      ? document.metadata.tools
      : Array.isArray(document.metadata?.tools?.components)
        ? document.metadata.tools.components
        : [];
    if (!tools.length) fail("CycloneDX SBOM must identify its generator/tool");
    return {
      ...descriptor,
      format: "CycloneDX",
      specificationVersion: document.specVersion,
      generator: tools.map((tool) => ({ name: tool?.name || "unknown", version: tool?.version || "unknown" })),
    };
  }
  if (typeof document?.spdxVersion === "string" && document.spdxVersion.startsWith("SPDX-")) {
    const creators = document.creationInfo?.creators;
    if (!Array.isArray(creators) || creators.length === 0) fail("SPDX SBOM must identify its generator/creator");
    return {
      ...descriptor,
      format: "SPDX",
      specificationVersion: document.spdxVersion,
      generator: creators.map((creator) => String(creator)),
    };
  }
  fail("SBOM must be a CycloneDX or SPDX JSON document with generator metadata");
}

export function finalizeCapture({
  root = process.cwd(),
  freezePath: requestedFreeze,
  sbom,
  reviewerEvidence,
  cleanupEvidence,
}) {
  assertSafeInvokerEnvironment();
  const loaded = loadFreeze(requestedFreeze, root);
  const generatedArtifacts = completedArtifactNames(
    loaded.outputDirectory,
    loaded.freeze.candidateSha,
    loaded.freeze.sourceTreeSha256,
  );
  const state = ensureCandidateState(root, loaded.freeze.candidateSha, loaded.freeze.sourceRef, {
    allowedGeneratedArtifacts: generatedArtifacts,
  });
  const source = hashGitTree(state.repoRoot);
  if (source.treeSha256 !== loaded.freeze.sourceTreeSha256) fail("Source tree hash changed after freeze");
  const gates = requiredGateRecords(
    state.repoRoot,
    loaded.outputDirectory,
    loaded.freeze.candidateSha,
    loaded.freeze.sourceTreeSha256,
  );
  assertCompletedArtifactIntegrity(
    state.repoRoot,
    loaded.outputDirectory,
    loaded.freeze.candidateSha,
    loaded.freeze.sourceTreeSha256,
  );
  const normalizedReviewerEvidence = requireEvidenceId(reviewerEvidence, "--reviewer-evidence");
  const normalizedCleanupEvidence = requireEvidenceId(cleanupEvidence, "--cleanup-evidence");

  const artifacts = {};
  for (const [name, requirement] of Object.entries(ARTIFACT_REQUIREMENTS)) {
    assertRequiredArtifactFiles(state.repoRoot, requirement);
    artifacts[name] = hashDirectory(state.repoRoot, requirement.root, { ignoredNames: requirement.ignoredNames });
    writeJson(join(loaded.outputDirectory, "manifests", `${name}.json`), artifacts[name]);
  }
  artifacts.sbom = validateSbom(sbom, state.repoRoot, {
    candidateSha: loaded.freeze.candidateSha,
    sourceTreeSha256: loaded.freeze.sourceTreeSha256,
  });
  const freezeSha256 = sha256(readFileSync(loaded.path));
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    kind: "talk-and-talk-candidate-evidence-manifest",
    finalizedAt: now(),
    candidateSha: loaded.freeze.candidateSha,
    parentSha: loaded.freeze.parentSha,
    sourceRef: loaded.freeze.sourceRef,
    sourceTreeSha256: source.treeSha256,
    source,
    freezeSha256,
    toolchain: loaded.freeze.toolchain,
    reviewerEvidence: normalizedReviewerEvidence,
    cleanupEvidence: normalizedCleanupEvidence,
    gates: gates.map(({
      gate,
      exitCode,
      skipped,
      logSha256,
      command,
      miniAppIdRef,
      generatedArtifacts,
    }) => ({
      gate,
      exitCode,
      skipped,
      logSha256,
      command,
      ...(miniAppIdRef ? { miniAppIdRef } : {}),
      ...(generatedArtifacts ? { generatedArtifacts } : {}),
    })),
    artifacts,
    limitations: [
      "This manifest does not prove browser/device, remote CI, staging, provider, migration-forward-upgrade, rollback-drill, or external-platform evidence.",
      "This local capture is internally integrity-checked but is not an authenticated execution record, external authorization check, immutable evidence custody record, or dependency-install provenance attestation.",
      "Only an independent reviewer may use this manifest as part of a G1 or G2-ready decision.",
    ],
  };
  const manifestPath = join(loaded.outputDirectory, "manifest.json");
  writeJson(manifestPath, manifest);
  writeFileSync(join(loaded.outputDirectory, "manifest.json.sha256"), `${sha256(readFileSync(manifestPath))}  manifest.json\n`, "utf8");
  return { manifestPath, manifest };
}

function assertManifestArtifact(name, artifact) {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    fail(`Candidate manifest is missing artifact ${name}`);
  }
  if (!SHA256_PATTERN.test(artifact.treeSha256 || "") && !SHA256_PATTERN.test(artifact.sha256 || "")) {
    fail(`Candidate manifest artifact ${name} has no valid hash`);
  }
  if (!Number.isInteger(artifact.bytes) && !Array.isArray(artifact.entries)) {
    fail(`Candidate manifest artifact ${name} has no size or entries`);
  }
  if (name === "sbom") {
    if (
      artifact.format !== "CycloneDX"
      || artifact.specificationVersion !== SBOM_SPEC_VERSION
      || stableJson(artifact.generator) !== stableJson([{ name: SBOM_GENERATOR_NAME, version: SBOM_GENERATOR_VERSION }])
      || !artifact.lockHashes
      || !["api", "miniprogram", "web"].every((id) => SHA256_PATTERN.test(artifact.lockHashes[id] || ""))
      || Object.keys(artifact.lockHashes).length !== 3
    ) fail("Candidate manifest SBOM is not the required deterministic lockfile-bound CycloneDX record");
  }
}

function validateManifestGate(gate) {
  if (!gate || typeof gate !== "object" || Array.isArray(gate)) fail("Candidate manifest contains an invalid gate");
  if (!REQUIRED_GATES.includes(gate.gate)) fail(`Candidate manifest contains an unsupported gate: ${gate.gate || "missing"}`);
  if (gate.exitCode !== 0 || gate.skipped !== 0) fail(`Candidate manifest gate ${gate.gate} did not pass with zero skips`);
  if (!SHA256_PATTERN.test(gate.logSha256 || "")) fail(`Candidate manifest gate ${gate.gate} has an invalid log hash`);
  if (typeof gate.command !== "string" || !gate.command) fail(`Candidate manifest gate ${gate.gate} has no command recipe`);
  if (gate.gate === "MINI_RELEASE") requireVaultReference(gate.miniAppIdRef, "Candidate manifest MINI_RELEASE miniAppIdRef");
  for (const name of producedArtifactNames(gate.gate)) {
    if (!gate.generatedArtifacts?.[name]) fail(`Candidate manifest gate ${gate.gate} is missing generated artifact ${name}`);
    assertManifestArtifact(`${gate.gate}.${name}`, gate.generatedArtifacts[name]);
  }
}

export function validateEvidenceManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) fail("Candidate manifest is invalid");
  if (manifest.schemaVersion !== SCHEMA_VERSION || manifest.kind !== "talk-and-talk-candidate-evidence-manifest") {
    fail("Candidate manifest has an unsupported schema or kind");
  }
  for (const field of ["candidateSha", "parentSha"]) {
    if (!SHA_PATTERN.test(manifest[field] || "")) fail(`Candidate manifest ${field} is invalid`);
  }
  if (typeof manifest.sourceRef !== "string" || !manifest.sourceRef) fail("Candidate manifest sourceRef is missing");
  if (!SHA256_PATTERN.test(manifest.sourceTreeSha256 || "") || !SHA256_PATTERN.test(manifest.freezeSha256 || "")) {
    fail("Candidate manifest source or freeze hash is invalid");
  }
  if (!manifest.source || manifest.source.treeSha256 !== manifest.sourceTreeSha256) {
    fail("Candidate manifest source tree does not match its top-level hash");
  }
  if (!manifest.toolchain || typeof manifest.toolchain !== "object" || !manifest.toolchain.node?.version || !manifest.toolchain.npm?.version || !manifest.toolchain.git?.version) {
    fail("Candidate manifest is missing a complete toolchain record");
  }
  requireEvidenceId(manifest.reviewerEvidence, "Candidate manifest reviewerEvidence");
  requireEvidenceId(manifest.cleanupEvidence, "Candidate manifest cleanupEvidence");
  if (!Array.isArray(manifest.gates) || manifest.gates.length !== REQUIRED_GATES.length) {
    fail("Candidate manifest must contain exactly one record for every required gate");
  }
  const gateNames = new Set();
  for (const gate of manifest.gates) {
    validateManifestGate(gate);
    if (gateNames.has(gate.gate)) fail(`Candidate manifest repeats gate ${gate.gate}`);
    gateNames.add(gate.gate);
  }
  for (const gate of REQUIRED_GATES) {
    if (!gateNames.has(gate)) fail(`Candidate manifest is missing required gate ${gate}`);
  }
  if (!manifest.artifacts || typeof manifest.artifacts !== "object") fail("Candidate manifest artifacts are missing");
  for (const name of Object.keys(ARTIFACT_REQUIREMENTS)) assertManifestArtifact(name, manifest.artifacts[name]);
  assertManifestArtifact("sbom", manifest.artifacts.sbom);
  return manifest;
}

function manifestSidecarPath(manifestPath) {
  return `${manifestPath}.sha256`;
}

function readVerifiedEvidenceManifest(manifestPath, root) {
  if (!isAbsolute(manifestPath)) fail("Candidate manifest path must be absolute");
  assertRegularFile(manifestPath, "Candidate manifest");
  if (lstatSync(manifestPath).isSymbolicLink()) fail("Candidate manifest must not be a symbolic link");
  const checksumPath = manifestSidecarPath(manifestPath);
  assertRegularFile(checksumPath, "Candidate manifest checksum");
  if (lstatSync(checksumPath).isSymbolicLink()) fail("Candidate manifest checksum must not be a symbolic link");
  const expected = readFileSync(checksumPath, "utf8").trim().match(/^([0-9a-f]{64})\s+manifest\.json$/);
  if (!expected) fail("Candidate manifest checksum has an invalid format");
  const raw = readFileSync(manifestPath);
  if (sha256(raw) !== expected[1]) fail("Candidate manifest checksum does not match");
  const manifest = validateEvidenceManifest(JSON.parse(raw.toString("utf8")));
  const outputDirectory = dirname(realpathSync(manifestPath));
  if (root) {
    const repoRoot = realpathSync(gitTrim(root, ["rev-parse", "--show-toplevel"]));
    if (pathInside(repoRoot, outputDirectory)) fail("Candidate evidence capture must remain outside the repository");
  }
  const freeze = readJson(join(outputDirectory, "00-freeze.json"));
  if (
    freeze?.kind !== "talk-and-talk-candidate-freeze"
    || freeze.schemaVersion !== SCHEMA_VERSION
    || !UUID_PATTERN.test(freeze.captureId || "")
    || !SHA256_PATTERN.test(freeze.checkoutFingerprint || "")
    || sha256(readFileSync(join(outputDirectory, "00-freeze.json"))) !== manifest.freezeSha256
    || freeze.candidateSha !== manifest.candidateSha
    || freeze.sourceTreeSha256 !== manifest.sourceTreeSha256
    || stableJson(freeze.toolchain) !== stableJson(manifest.toolchain)
  ) {
    fail("Candidate manifest does not bind to its verified freeze record");
  }
  for (const gate of manifest.gates) {
    const recordPath = gateFile(outputDirectory, gate.gate);
    const logPath = join(outputDirectory, "logs", `${gate.gate}.log`);
    assertRegularFile(recordPath, `Captured gate ${gate.gate} record`);
    assertRegularFile(logPath, `Captured gate ${gate.gate} log`);
    const record = readJson(recordPath);
    if (
      record?.kind !== "talk-and-talk-candidate-gate-record"
      || record.schemaVersion !== SCHEMA_VERSION
      || stableJson({
        gate: record.gate,
        exitCode: record.exitCode,
        skipped: record.skipped,
        logSha256: record.logSha256,
        command: record.command,
        ...(record.miniAppIdRef ? { miniAppIdRef: record.miniAppIdRef } : {}),
        ...(record.generatedArtifacts ? { generatedArtifacts: record.generatedArtifacts } : {}),
      }) !== stableJson(gate)
      || sha256(readFileSync(logPath)) !== gate.logSha256
    ) {
      fail(`Candidate manifest gate ${gate.gate} does not bind to its captured record and log`);
    }
  }
  return { manifest, freeze, outputDirectory, manifestPath: realpathSync(manifestPath) };
}

function comparableManifest(manifest) {
  validateEvidenceManifest(manifest);
  return {
    kind: manifest.kind,
    schemaVersion: manifest.schemaVersion,
    candidateSha: manifest.candidateSha,
    parentSha: manifest.parentSha,
    sourceRef: manifest.sourceRef,
    sourceTreeSha256: manifest.sourceTreeSha256,
    source: manifest.source,
    toolchain: manifest.toolchain,
    gates: manifest.gates.map(({
      gate,
      exitCode,
      skipped,
      command,
      miniAppIdRef,
      generatedArtifacts,
    }) => ({
      gate,
      exitCode,
      skipped,
      command,
      ...(miniAppIdRef ? { miniAppIdRef } : {}),
      ...(generatedArtifacts ? { generatedArtifacts } : {}),
    })),
    artifacts: manifest.artifacts,
  };
}

export function compareEvidenceManifests(left, right) {
  if (stableJson(comparableManifest(left)) !== stableJson(comparableManifest(right))) {
    fail("Candidate evidence manifests differ; source, gate, or artifact bytes are not reproducible");
  }
  return { candidateSha: left.candidateSha, sourceTreeSha256: left.sourceTreeSha256 };
}

export function main(argv = process.argv.slice(2), root = process.cwd()) {
  assertSafeInvokerEnvironment();
  const { command, options } = parseOptions(argv);
  if (command === "begin") {
    const candidateSha = requireOption(options, "sha");
    const sourceRef = requireOption(options, "sourceRef");
    const output = requireOption(options, "out");
    const result = beginCapture({ root, candidateSha, sourceRef, output });
    process.stdout.write(`Candidate freeze recorded: ${freezePath(result.outputDirectory)}\n`);
    return result;
  }
  if (command === "run") {
    const requestedFreeze = requireOption(options, "freeze");
    const gate = requireOption(options, "gate");
    const result = runGate({ root, freezePath: requestedFreeze, gate, options });
    process.stdout.write(`Candidate gate recorded: ${result.gate}\n`);
    return result;
  }
  if (command === "sbom") {
    const requestedFreeze = requireOption(options, "freeze");
    const output = requireOption(options, "out");
    const result = generateSbomForFreeze({ root, freezePath: requestedFreeze, output });
    process.stdout.write(`Candidate SBOM recorded: ${result.path} ${result.sha256}\n`);
    return result;
  }
  if (command === "finalize") {
    const requestedFreeze = requireOption(options, "freeze");
    const sbom = requireOption(options, "sbom");
    const reviewerEvidence = requireOption(options, "reviewerEvidence");
    const cleanupEvidence = requireOption(options, "cleanupEvidence");
    const result = finalizeCapture({ root, freezePath: requestedFreeze, sbom, reviewerEvidence, cleanupEvidence });
    process.stdout.write(`Candidate manifest recorded: ${result.manifestPath}\n`);
    return result;
  }
  if (command === "compare") {
    const left = readVerifiedEvidenceManifest(requireOption(options, "left"), root);
    const right = readVerifiedEvidenceManifest(requireOption(options, "right"), root);
    if (left.manifestPath === right.manifestPath || left.outputDirectory === right.outputDirectory) {
      fail("Compare requires two distinct independently captured output directories");
    }
    if (left.freeze.captureId === right.freeze.captureId || left.freeze.checkoutFingerprint === right.freeze.checkoutFingerprint) {
      fail("Compare requires captures from two distinct checkout paths and capture IDs");
    }
    const result = compareEvidenceManifests(left.manifest, right.manifest);
    process.stdout.write(`Candidate evidence manifests match: ${result.candidateSha}\n`);
    return result;
  }
  fail(`Unsupported command: ${command}`);
}

const executedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (executedPath === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
