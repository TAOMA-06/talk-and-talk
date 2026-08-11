import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { hashGitTree } from "./candidate-evidence.mjs";
import { verifyCandidateIdentity } from "./verify-ci-candidate-identity.mjs";

const candidateWorkflowEnvironment = Object.freeze({
  GITHUB_REF: "refs/tags/g1-candidate-test",
  GITHUB_REF_PROTECTED: "true",
});

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function fixture({ detach = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "talkandtalk-ci-identity-"));
  git(root, "init", "-q");
  git(root, "config", "user.name", "Candidate Fixture");
  git(root, "config", "user.email", "candidate-fixture@example.test");
  writeFileSync(join(root, "source.txt"), "fixture\n", "utf8");
  git(root, "add", "source.txt");
  git(root, "commit", "-qm", "fixture");
  if (detach) git(root, "checkout", "--detach", "-q");
  return { root, sha: git(root, "rev-parse", "HEAD") };
}

function verifyFixture(root) {
  const sha = git(root, "rev-parse", "HEAD");
  return verifyCandidateIdentity({
    root,
    candidateSha: sha,
    githubSha: sha,
    workflowSha: sha,
    environment: candidateWorkflowEnvironment,
  });
}

test("candidate identity binds dispatch, workflow, HEAD, tree, and clean detached checkout", () => {
  const candidate = fixture();
  const output = `${candidate.root}-github-output`;
  try {
    writeFileSync(output, "", "utf8");
    const result = verifyCandidateIdentity({
      root: candidate.root,
      candidateSha: candidate.sha,
      githubSha: candidate.sha,
      workflowSha: candidate.sha,
      emitGithubOutput: true,
      environment: { ...candidateWorkflowEnvironment, GITHUB_OUTPUT: output },
    });
    assert.equal(result.candidateSha, candidate.sha);
    assert.equal(result.candidateRef, candidateWorkflowEnvironment.GITHUB_REF);
    assert.match(result.gitTreeSha, /^[0-9a-f]{40}$/);
    assert.match(result.sourceTreeSha256, /^[0-9a-f]{64}$/);
    assert.equal(result.sourceTreeSha256, hashGitTree(candidate.root).treeSha256);
    assert.match(readFileSync(output, "utf8"), new RegExp(`candidate_sha=${candidate.sha}`));
    assert.match(readFileSync(output, "utf8"), new RegExp(`candidate_ref=${candidateWorkflowEnvironment.GITHUB_REF}`));
    assert.match(readFileSync(output, "utf8"), new RegExp(`source_tree_sha256=${result.sourceTreeSha256}`));
    chmodSync(join(candidate.root, "source.txt"), 0o600);
    const permissionVariant = verifyCandidateIdentity({
      root: candidate.root,
      candidateSha: candidate.sha,
      githubSha: candidate.sha,
      workflowSha: candidate.sha,
      environment: candidateWorkflowEnvironment,
    });
    assert.equal(permissionVariant.sourceTreeSha256, result.sourceTreeSha256, "same Git tree must not drift with local umask/read-permission bits");
  } finally {
    rmSync(candidate.root, { recursive: true, force: true });
    rmSync(output, { force: true });
  }
});

test("candidate identity rejects mismatched dispatch/workflow SHA, attached HEAD, and dirty source", () => {
  const detached = fixture();
  const attached = fixture({ detach: false });
  try {
    assert.throws(() => verifyCandidateIdentity({
      root: detached.root,
      candidateSha: detached.sha,
      githubSha: "a".repeat(40),
      workflowSha: detached.sha,
      environment: candidateWorkflowEnvironment,
    }), /does not match candidate SHA/);
    assert.throws(() => verifyCandidateIdentity({
      root: detached.root,
      candidateSha: detached.sha,
      githubSha: detached.sha,
      workflowSha: "b".repeat(40),
      environment: candidateWorkflowEnvironment,
    }), /does not match candidate SHA/);
    assert.throws(() => verifyCandidateIdentity({
      root: attached.root,
      candidateSha: attached.sha,
      githubSha: attached.sha,
      workflowSha: attached.sha,
      environment: candidateWorkflowEnvironment,
    }), /must be detached/);
    writeFileSync(join(detached.root, "untracked.txt"), "dirty\n", "utf8");
    assert.throws(() => verifyCandidateIdentity({
      root: detached.root,
      candidateSha: detached.sha,
      githubSha: detached.sha,
      workflowSha: detached.sha,
      environment: candidateWorkflowEnvironment,
    }), /dirty or contains untracked files/);
    assert.throws(() => verifyCandidateIdentity({
      root: attached.root,
      candidateSha: attached.sha,
      githubSha: attached.sha,
      workflowSha: attached.sha,
      environment: { GITHUB_REF: "refs/heads/main", GITHUB_REF_PROTECTED: "true" },
    }), /refs\/tags/);
    assert.throws(() => verifyCandidateIdentity({
      root: attached.root,
      candidateSha: attached.sha,
      githubSha: attached.sha,
      workflowSha: attached.sha,
      environment: { GITHUB_REF: candidateWorkflowEnvironment.GITHUB_REF, GITHUB_REF_PROTECTED: "false" },
    }), /GITHUB_REF_PROTECTED/);
    assert.throws(() => verifyCandidateIdentity({
      root: detached.root,
      candidateSha: detached.sha,
      githubSha: detached.sha,
      workflowSha: detached.sha,
      environment: { ...candidateWorkflowEnvironment, NODE_OPTIONS: "--require=/tmp/untrusted-preload.cjs" },
    }), /NODE_OPTIONS must be empty/);
    assert.throws(() => verifyCandidateIdentity({
      root: detached.root,
      candidateSha: detached.sha,
      githubSha: detached.sha,
      workflowSha: detached.sha,
      environment: { ...candidateWorkflowEnvironment, NODE_PATH: "/tmp/untrusted-modules" },
    }), /NODE_PATH must be empty/);
  } finally {
    rmSync(detached.root, { recursive: true, force: true });
    rmSync(attached.root, { recursive: true, force: true });
  }
});

test("candidate identity applies the same private-input and self-contained-source policy before and after installation", () => {
  const tracked = fixture();
  const ignored = fixture();
  const symlink = fixture();
  const gitlink = fixture();
  try {
    writeFileSync(join(tracked.root, ".npmrc"), "registry=https://registry.example.test\n", "utf8");
    git(tracked.root, "add", ".npmrc");
    git(tracked.root, "commit", "-qm", "tracked config");
    assert.throws(() => verifyFixture(tracked.root), /tracked private configuration input/);

    writeFileSync(join(ignored.root, ".gitignore"), ".npmrc\n", "utf8");
    git(ignored.root, "add", ".gitignore");
    git(ignored.root, "commit", "-qm", "ignore config");
    writeFileSync(join(ignored.root, ".npmrc"), "registry=https://registry.example.test\n", "utf8");
    assert.throws(() => verifyFixture(ignored.root), /ignored configuration input/);

    symlinkSync("source.txt", join(symlink.root, "linked-source"));
    git(symlink.root, "add", "linked-source");
    git(symlink.root, "commit", "-qm", "tracked symlink");
    assert.throws(() => verifyFixture(symlink.root), /tracked symbolic link/);

    const object = git(gitlink.root, "rev-parse", "HEAD");
    git(gitlink.root, "update-index", "--add", "--cacheinfo", `160000,${object},vendor/unmapped`);
    git(gitlink.root, "commit", "-qm", "gitlink");
    mkdirSync(join(gitlink.root, "vendor", "unmapped"), { recursive: true });
    assert.throws(() => verifyFixture(gitlink.root), /unresolved gitlink/);
  } finally {
    for (const candidate of [tracked, ignored, symlink, gitlink]) {
      rmSync(candidate.root, { recursive: true, force: true });
    }
  }
});
