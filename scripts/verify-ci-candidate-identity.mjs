#!/usr/bin/env node
/**
 * Verify that a manually dispatched candidate workflow is executing the exact
 * immutable source selected by its operator. This is intentionally independent
 * from the local candidate-capture tool: it does not create a candidate, run a
 * deployment, or grant permission for Docker, databases, or external systems.
 */
import { appendFileSync, existsSync, lstatSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertCandidateInputPolicy } from "./candidate-input-policy.mjs";
import { hashCandidateSourceTree } from "./candidate-source-tree.mjs";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const CANDIDATE_TAG_REF_PATTERN = /^refs\/tags\/[0-9A-Za-z][0-9A-Za-z._/-]{0,199}$/;

function fail(message) {
  const error = new Error(message);
  error.code = "CANDIDATE_IDENTITY_ERROR";
  throw error;
}

function assertSafeInvokerEnvironment(environment) {
  // This cannot undo a preload that has already executed, but it makes the
  // identity result unusable whenever the runner was configured to load an
  // arbitrary Node module or lookup path. The workflow also performs this
  // check before invoking Node so a protected candidate run fails earlier.
  if (String(environment.NODE_OPTIONS ?? "").trim()) {
    fail("NODE_OPTIONS must be empty before candidate identity verification can start");
  }
  if (String(environment.NODE_PATH ?? "").trim()) {
    fail("NODE_PATH must be empty before candidate identity verification can start");
  }
}

function trustedGitExecutable() {
  const candidates = process.platform === "win32" ? [] : ["/usr/bin/git", "/bin/git"];
  const executable = candidates.find((candidate) => existsSync(candidate) && lstatSync(candidate).isFile() && !lstatSync(candidate).isSymbolicLink());
  if (!executable) fail("Candidate identity verification requires an absolute trusted git executable");
  return executable;
}

function git(root, args) {
  const result = spawnSync(trustedGitExecutable(), args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    env: {
      PATH: "/usr/bin:/bin",
      HOME: "/tmp",
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  if (result.error) fail(`Unable to run git ${args.join(" ")}: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = `${result.stdout || ""}${result.stderr || ""}`.trim();
    fail(`git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
  return (result.stdout || "").trim();
}

function requireSha(value, label) {
  if (typeof value !== "string" || !SHA_PATTERN.test(value)) {
    fail(`${label} must be an exact lowercase 40-character Git SHA`);
  }
  return value;
}

function assertMatchesCandidate(candidateSha, value, label) {
  const normalized = requireSha(value, label);
  if (normalized !== candidateSha) fail(`${label} ${normalized} does not match candidate SHA ${candidateSha}`);
  return normalized;
}

function requireProtectedCandidateTagRef(environment) {
  const candidateRef = String(environment.GITHUB_REF ?? "");
  if (!CANDIDATE_TAG_REF_PATTERN.test(candidateRef)) {
    fail("GITHUB_REF must be a refs/tags/... candidate ref; GitHub Actions cannot dispatch this workflow from a bare SHA");
  }
  if (String(environment.GITHUB_REF_PROTECTED ?? "") !== "true") {
    fail("GITHUB_REF_PROTECTED must be true for the immutable candidate tag/ref");
  }
  return candidateRef;
}

function assertCandidateInputs(root) {
  assertCandidateInputPolicy({
    gitText(args) {
      return git(root, args);
    },
    fail,
  });
}

function writeGithubOutput(result, environment) {
  const output = environment.GITHUB_OUTPUT;
  if (!output || !isAbsolute(output) || !existsSync(output) || !lstatSync(output).isFile() || lstatSync(output).isSymbolicLink()) {
    fail("--emit-github-output requires GITHUB_OUTPUT to name an existing regular absolute file");
  }
  appendFileSync(output, [
    `candidate_sha=${result.candidateSha}`,
    `candidate_ref=${result.candidateRef}`,
    `git_tree_sha=${result.gitTreeSha}`,
    `source_tree_sha256=${result.sourceTreeSha256}`,
    `verified_head=${result.head}`,
    "",
  ].join("\n"), "utf8");
}

export function verifyCandidateIdentity({
  root = process.cwd(),
  candidateSha,
  githubSha,
  workflowSha,
  environment = process.env,
  emitGithubOutput = false,
} = {}) {
  assertSafeInvokerEnvironment(environment);
  const expected = requireSha(candidateSha, "--sha");
  assertMatchesCandidate(expected, githubSha, "--github-sha");
  assertMatchesCandidate(expected, workflowSha, "--workflow-sha");
  const candidateRef = requireProtectedCandidateTagRef(environment);

  const normalizedRoot = realpathSync(root);
  const repositoryRoot = realpathSync(git(normalizedRoot, ["rev-parse", "--show-toplevel"]));
  if (repositoryRoot !== normalizedRoot) fail(`Run from the repository root, not ${normalizedRoot}`);

  const head = git(repositoryRoot, ["rev-parse", "HEAD"]);
  if (head !== expected) fail(`HEAD ${head} does not match candidate SHA ${expected}`);
  const symbolicRef = spawnSync(trustedGitExecutable(), ["symbolic-ref", "-q", "--short", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { PATH: "/usr/bin:/bin", HOME: "/tmp", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });
  if (symbolicRef.status === 0) fail(`Candidate checkout must be detached; HEAD is attached to ${(symbolicRef.stdout || "").trim()}`);

  const status = git(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status) fail(`Candidate checkout is dirty or contains untracked files:\n${status}`);
  const diffCheck = git(repositoryRoot, ["diff", "--check"]);
  if (diffCheck) fail("git diff --check produced output");
  assertCandidateInputs(repositoryRoot);

  const result = Object.freeze({
    candidateSha: expected,
    candidateRef,
    gitTreeSha: git(repositoryRoot, ["rev-parse", "HEAD^{tree}"]),
    sourceTreeSha256: hashCandidateSourceTree(repositoryRoot, git(repositoryRoot, ["ls-tree", "-r", "HEAD"])).treeSha256,
    head,
  });
  if (emitGithubOutput) writeGithubOutput(result, environment);
  return result;
}

function usage(exitCode = 0) {
  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write(
    "Usage: node scripts/verify-ci-candidate-identity.mjs --sha <40-hex-sha> --github-sha <40-hex-sha> --workflow-sha <40-hex-sha> [--emit-github-output] (requires GitHub GITHUB_REF=refs/tags/... and GITHUB_REF_PROTECTED=true)\n",
  );
  process.exit(exitCode);
}

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--emit-github-output") {
      if (options.emitGithubOutput) fail("--emit-github-output may be supplied only once");
      options.emitGithubOutput = true;
      continue;
    }
    if (!new Set(["--sha", "--github-sha", "--workflow-sha"]).has(argument)) usage(2);
    const value = argv[++index];
    if (!value || value.startsWith("--")) fail(`${argument} requires a value`);
    const key = argument.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    if (Object.hasOwn(options, key)) fail(`${argument} may be supplied only once`);
    options[key] = value;
  }
  return options;
}

export function main(argv = process.argv.slice(2), root = process.cwd(), environment = process.env) {
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) usage(argv.length ? 0 : 2);
  const options = parseOptions(argv);
  const result = verifyCandidateIdentity({ root, environment, ...options });
  process.stdout.write(`Candidate source identity verified: ${result.candidateSha} ${result.gitTreeSha} ${result.sourceTreeSha256}\n`);
  return result;
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
