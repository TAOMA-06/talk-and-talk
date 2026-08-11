import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceWorkflowPath = resolve(repositoryRoot, ".github/workflows/g1-candidate.yml");
const controlPlaneWorkflowPath = resolve(repositoryRoot, ".github/workflows/g1-candidate-control-plane.yml");
const apiRegressionWorkflowPath = resolve(repositoryRoot, ".github/workflows/api.yml");
const iosRegressionWorkflowPath = resolve(repositoryRoot, ".github/workflows/ios.yml");
const miniRegressionWorkflowPath = resolve(repositoryRoot, ".github/workflows/miniprogram.yml");
const webRegressionWorkflowPath = resolve(repositoryRoot, ".github/workflows/web.yml");
const apiPackagePath = resolve(repositoryRoot, "backend/api/package.json");
const webPackagePath = resolve(repositoryRoot, "frontend/web/package.json");

const CHECKOUT = "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683";
const UPLOAD_ARTIFACT = "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function jobBlock(workflow, job) {
  const startMarker = `\n  ${job}:\n`;
  const start = workflow.indexOf(startMarker);
  assert.notEqual(start, -1, `${job} must be a workflow job`);
  const remainder = workflow.slice(start + startMarker.length);
  const nextJob = /\n {2}[a-z][a-z0-9-]*:\n/.exec(remainder);
  return workflow.slice(start, nextJob ? start + startMarker.length + nextJob.index : undefined);
}

function count(workflow, literal) {
  return (workflow.match(new RegExp(escapeRegExp(literal), "g")) || []).length;
}

function assertMetadataOnlyWorkflow(workflow, expectedName) {
  assert.match(workflow, new RegExp(`^name: ${escapeRegExp(expectedName)}$`, "m"));
  const onEnd = workflow.indexOf("\npermissions:\n");
  assert.ok(onEnd > 0, "metadata hygiene needs an explicit permission boundary");
  assert.doesNotMatch(workflow, /\b(?:workflow_dispatch|schedule|workflow_call|workflow_run|pull_request_target)\b/, "metadata hygiene must not accept an authority-bearing trigger in block or flow YAML");
  const triggers = [...workflow.slice(workflow.indexOf("on:\n"), onEnd).matchAll(/^  ([a-z_]+):\n/gm)].map((match) => match[1]);
  assert.deepEqual(triggers, ["push", "pull_request"], "metadata hygiene must use only normal source events");
  const permissionsEnd = workflow.indexOf("\nenv:\n", onEnd);
  assert.equal(workflow.slice(onEnd + 1, permissionsEnd).trimEnd(), "permissions:\n  contents: read", "metadata hygiene needs exactly read-only repository permission");
  const envEnd = workflow.indexOf("\njobs:\n", permissionsEnd);
  assert.equal(workflow.slice(permissionsEnd + 1, envEnd).trimEnd(), `env:
  BASH_ENV: /dev/null
  DYLD_FORCE_FLAT_NAMESPACE: ""
  DYLD_INSERT_LIBRARIES: ""
  DYLD_LIBRARY_PATH: ""
  DYLD_ROOT_PATH: ""
  ENV: /dev/null
  GIT_CONFIG_GLOBAL: /dev/null
  GIT_CONFIG_NOSYSTEM: "1"
  LD_AUDIT: ""
  LD_LIBRARY_PATH: ""
  LD_PRELOAD: ""
  NODE_OPTIONS: ""
  NODE_PATH: ""`, "metadata hygiene must neutralize exactly the approved shell, loader, and Git configuration inputs");
  assert.equal(count(workflow, CHECKOUT), 1, "metadata hygiene must use one pinned checkout");
  assert.deepEqual(workflow.match(/^      - uses: .*$/gm), [`      - uses: ${CHECKOUT} # v4.2.2`], "metadata hygiene must not add an unreviewed action");
  assert.match(workflow, /fetch-depth: 1/);
  assert.match(workflow, /lfs: false/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /submodules: false/);
  assert.doesNotMatch(workflow, /actions\/setup-node@/, "metadata hygiene must not initialize a candidate-code runtime");
  const jobs = workflow.slice(envEnd);
  assert.match(jobs, /^\njobs:\n  metadata:\n/, "metadata hygiene must use the block-style approved metadata job");
  assert.doesNotMatch(jobs, /^  (?!metadata:\n)[^\s#][^:]*:/m, "metadata hygiene must reject every extra job, including flow-style YAML");
  assert.deepEqual([...jobs.matchAll(/^  ([a-z][a-z0-9-]*):\n/gm)].map((match) => match[1]), ["metadata"], "metadata hygiene needs exactly one fixed job");
  const block = jobBlock(workflow, "metadata");
  assert.match(block, /runs-on: ubuntu-latest/);
  assert.doesNotMatch(block, /^    (?:permissions|env|defaults|concurrency|container|services):/m, "metadata job must not add a job-level capability or execution context");
  assert.equal((block.match(/^      - /gm) || []).length, 2, "metadata hygiene must use exactly checkout and one fixed shell step");
  assert.equal((block.match(/^        shell: bash$/gm) || []).length, 1, "metadata hygiene must use one fixed Bash shell");
  assert.equal((block.match(/^        run: \|$/gm) || []).length, 1, "metadata hygiene must use one fixed shell body");
  assert.match(block, /export PATH=\/usr\/bin:\/bin/);
  assert.match(block, /export GITHUB_ENV=\/dev\/null GITHUB_OUTPUT=\/dev\/null GITHUB_PATH=\/dev\/null GITHUB_STEP_SUMMARY=\/dev\/null/);
  assert.match(block, /readonly PATH GITHUB_ENV GITHUB_OUTPUT GITHUB_PATH GITHUB_STEP_SUMMARY/);
  assert.match(block, /\/usr\/bin\/git -c core\.hooksPath=\/dev\/null -c core\.fsmonitor=false rev-parse HEAD/);
  assert.match(block, /status --porcelain --untracked-files=all/);
  assert.match(block, /diff --check --no-ext-diff/);
  const runBody = block.slice(block.indexOf("        run: |\n") + "        run: |\n".length).trimEnd().split("\n").map((line) => line.replace(/^ {10}/, "")).join("\n");
  assert.equal(runBody, `set -euo pipefail
export PATH=/usr/bin:/bin
export GITHUB_ENV=/dev/null GITHUB_OUTPUT=/dev/null GITHUB_PATH=/dev/null GITHUB_STEP_SUMMARY=/dev/null
readonly PATH GITHUB_ENV GITHUB_OUTPUT GITHUB_PATH GITHUB_STEP_SUMMARY
/usr/bin/git -c core.hooksPath=/dev/null -c core.fsmonitor=false rev-parse HEAD | /usr/bin/grep -Fx "$GITHUB_SHA"
test -z "$(/usr/bin/git -c core.hooksPath=/dev/null -c core.fsmonitor=false status --porcelain --untracked-files=all)"
/usr/bin/git -c core.hooksPath=/dev/null -c core.fsmonitor=false diff --check --no-ext-diff`, "metadata hygiene must use only fixed Git metadata commands after sealing command files");
  for (const forbidden of [
    /\b(?:npm|node|npx|yarn|pnpm|tsc|typescript|prisma|sudo|xcodebuild|xcode-select|xcpretty)\b/i,
    /\b(?:docker|compose|buildx)\b/i,
    /\b(?:container|services|self-hosted|environment)\s*:/i,
    /\b(?:DATABASE_URL|REDIS_URL|E2E_[A-Z0-9_]+|DOCKER_HOST)\b/,
    /\b(?:secrets|vars)\./,
    /actions\/upload-artifact@/
  ]) assert.doesNotMatch(workflow, forbidden, `metadata hygiene must not contain candidate-code or privileged executor ${forbidden}`);
}

function assertNoRepositoryOciWritePath(workflow, label) {
  for (const forbidden of [
    /\bdocker\s+(?:buildx?|login|push|pull|tag|manifest|image|trust|sign)\b/i,
    /\bbuildx\s+(?:build|bake|imagetools)\b/i,
    /\b(?:oras|cosign|skopeo|crane)\s+(?:copy|login|push|sign|attach|build|manifest)\b/i,
    /\b(?:registry|artifact)[-_ ]?(?:publish|push|upload|sign)\b/i
  ]) {
    assert.doesNotMatch(workflow, forbidden, `${label} must not contain an OCI build, registry write, or signing path`);
  }
}

export function assertG1CandidateWorkflowContract(workflow) {
  assertMetadataOnlyWorkflow(workflow, "G1 candidate metadata hygiene (untrusted)");
  for (const requiredPath of [
    ".github/workflows/api.yml",
    ".github/workflows/g1-candidate-control-plane.yml",
    ".github/workflows/ios.yml",
    ".github/workflows/miniprogram.yml",
    ".github/workflows/web.yml",
    "scripts/**",
    "backend/api/**",
    "frontend/ios/**",
    "frontend/miniprogram/**",
    "frontend/web/**"
  ]) assert.match(workflow, new RegExp(escapeRegExp(requiredPath)), `metadata hygiene must observe ${requiredPath} changes`);
}

export function assertG1CandidateControlPlaneContract(workflow) {
  assert.match(workflow, /^name: G1 trusted candidate control-plane contract$/m);
  assert.match(workflow, /^on:\n  workflow_dispatch:\n    inputs:/m, "trusted control plane must require explicit operator dispatch");
  assert.doesNotMatch(workflow, /^  (?:push|pull_request|schedule|workflow_call):/m, "trusted control plane must not run from an automatic candidate event");
  assert.match(workflow, /^permissions:\n  contents: read$/m, "control plane must not grant write permissions");
  assert.match(workflow, /^env:\n  BASH_ENV: \/dev\/null\n  DYLD_FORCE_FLAT_NAMESPACE: ""\n  DYLD_INSERT_LIBRARIES: ""\n  DYLD_LIBRARY_PATH: ""\n  DYLD_ROOT_PATH: ""\n  ENV: \/dev\/null\n  LD_AUDIT: ""\n  LD_LIBRARY_PATH: ""\n  LD_PRELOAD: ""\n  NODE_OPTIONS: ""\n  NODE_PATH: ""$/m, "control-owned actions must start with shell and loader preloads neutralized");
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./, "candidate execution must not receive repository secrets");
  for (const requiredInput of ["candidate_repository", "candidate_sha", "candidate_source_tree_sha256", "control_authorization_evidence"]) {
    assert.match(workflow, new RegExp(`      ${requiredInput}:\\n`), `control plane requires ${requiredInput}`);
  }
  for (const externalRequirement of [
    "separate control repository",
    "immutable protected g1-control-* tags",
    "dedicated runner-group ACL",
    "authorization registry",
    "cannot create or verify any of those external controls"
  ]) assert.match(workflow, new RegExp(escapeRegExp(externalRequirement)), `control plane must state its external ${externalRequirement} prerequisite`);

  const bind = jobBlock(workflow, "control-bind");
  assert.match(bind, /environment:\n      name: g1-candidate-control-plane/, "only trusted control jobs may enter the protected environment");
  assert.match(bind, /runs-on: \[self-hosted, linux, x64, talktalk-g1-control\]/, "control binding needs the separately ACLed control runner");
  assert.match(bind, /CONTROL_REF: \$\{\{ vars\.G1_CONTROL_PLANE_IMMUTABLE_REF \}\}/);
  assert.match(bind, /CONTROL_REPOSITORY: \$\{\{ vars\.G1_CONTROL_PLANE_REPOSITORY \}\}/);
  assert.match(bind, /CONTROL_SHA: \$\{\{ vars\.G1_CONTROL_PLANE_SHA \}\}/, "protected control SHA must be injected independently from dispatch inputs");
  assert.match(bind, /CONTROL_AUTHORIZATION_REGISTER_REFERENCE: \$\{\{ vars\.G1_CONTROL_PLANE_AUTHORIZATION_REGISTER_REFERENCE \}\}/, "a protected registry reference must bind authorization to candidate facts");
  assert.match(bind, /CONTROL_AUTHORIZATION_REGISTER_SHA256: \$\{\{ vars\.G1_CONTROL_PLANE_AUTHORIZATION_REGISTER_SHA256 \}\}/, "the protected authorization registry must have an immutable digest");
  assert.match(bind, /CANDIDATE_RUNNER_IMAGE: \$\{\{ vars\.G1_CANDIDATE_SOCKETLESS_RUNNER_IMAGE \}\}/, "candidate container image must come from protected control configuration");
  assert.match(bind, /CONTROL_HARNESS_SHA256: \$\{\{ vars\.G1_CANDIDATE_SOCKETLESS_HARNESS_SHA256 \}\}/, "candidate harness digest must come from protected control configuration");
  assert.match(bind, /\[ "\$GITHUB_REF_PROTECTED" = "true" \]/, "control ref must be protected");
  assert.match(bind, /case "\$CONTROL_REF" in refs\/tags\/g1-control-/, "control ref must use the immutable control-tag namespace");
  assert.match(bind, /\[ "\$GITHUB_REPOSITORY" = "\$CONTROL_REPOSITORY" \]/, "control workflow must execute from the independent control repository");
  assert.match(bind, /\[ "\$CANDIDATE_REPOSITORY" != "\$CONTROL_REPOSITORY" \]/, "candidate and control repositories must be independent");
  assert.match(bind, /\[ "\$GITHUB_REF" = "\$CONTROL_REF" \]/, "runtime ref must match protected control ref");
  assert.match(bind, /\[ "\$GITHUB_WORKFLOW_SHA" = "\$CONTROL_SHA" \]/, "workflow source must bind to protected control SHA");
  assert.match(bind, /repository: \$\{\{ vars\.G1_CONTROL_PLANE_REPOSITORY \}\}[\s\S]*?ref: \$\{\{ vars\.G1_CONTROL_PLANE_IMMUTABLE_REF \}\}[\s\S]*?path: control/, "control source must be checked out from the protected immutable ref");
  assert.doesNotMatch(bind, /path: candidate/, "candidate source must not enter a trusted control job");
  assert.match(bind, /\[\[ "\$CANDIDATE_RUNNER_IMAGE" =~ \^\[a-z0-9\]\[a-z0-9\._\/-\]\*@sha256:/, "only a digest-pinned candidate container may cross into the candidate job");
  assert.match(bind, /AUTHORIZATION_RESOLVER="\$GITHUB_WORKSPACE\/control\/scripts\/g1-candidate-control-plane\/resolve-candidate-authorization\.sh"/, "control source must resolve authorization itself");
  for (const authorizationArgument of [
    "--authorization-evidence",
    "--candidate-repository",
    "--candidate-sha",
    "--candidate-source-tree-sha256",
    "--control-approval-reference",
    "--authorization-register-reference",
    "--authorization-register-sha256"
  ]) assert.match(bind, new RegExp(escapeRegExp(authorizationArgument)), `control resolver must bind ${authorizationArgument}`);
  assert.match(bind, /printf 'control_harness_sha256=%s\\n'/, "only a protected control-harness digest may cross into the candidate executor");

  const candidateRunner = jobBlock(workflow, "candidate-runner");
  assert.doesNotMatch(candidateRunner, /environment:/, "candidate job must not enter the protected environment");
  assert.match(candidateRunner, /runs-on: \[self-hosted, linux, x64, talktalk-g1-candidate-socketless\]/, "candidate execution needs its own socketless runner group");
  assert.match(candidateRunner, /container:\n      image: \$\{\{ needs\.control-bind\.outputs\.candidate_runner_image \}\}/, "candidate job must be containerized from the protected immutable image");
  for (const option of ["--read-only", "--tmpfs /tmp:rw,noexec,nosuid,size=1g", "--cap-drop=ALL", "--security-opt no-new-privileges"]) {
    assert.match(candidateRunner, new RegExp(escapeRegExp(option)), `candidate container must keep ${option}`);
  }
  assert.doesNotMatch(candidateRunner, /(?:--volume|--mount|-v)\b/, "candidate container must not declare host mounts");
  assert.deepEqual(candidateRunner.match(/^      DOCKER_HOST: .*$/gm), ["      DOCKER_HOST: \"\""], "candidate job must only clear, never configure, an engine endpoint");
  assert.match(candidateRunner, /\[ ! -S \/var\/run\/docker\.sock \]/, "candidate job must reject a default engine socket mount");
  assert.match(candidateRunner, /\[ ! -S \/run\/docker\.sock \]/, "candidate job must reject an alternate engine socket mount");
  assert.match(candidateRunner, /repository: \$\{\{ needs\.control-bind\.outputs\.candidate_repository \}\}[\s\S]*?ref: \$\{\{ needs\.control-bind\.outputs\.candidate_sha \}\}[\s\S]*?path: candidate/, "candidate source must be isolated below candidate/");
  assert.doesNotMatch(candidateRunner, /path: control|\$GITHUB_WORKSPACE\/control|candidate\/\.\.\/control/, "candidate executor must not mount or reference a control checkout");
  assert.match(candidateRunner, /CONTROL_HARNESS="\/opt\/talktalk-g1-control\/run-socketless-candidate"/, "candidate execution must start from the immutable executor-image harness");
  assert.match(candidateRunner, /CONTROL_HARNESS_SHA256: \$\{\{ needs\.control-bind\.outputs\.control_harness_sha256 \}\}/, "candidate harness digest must be bound before candidate code starts");
  assert.match(candidateRunner, /\/usr\/bin\/sha256sum "\$CONTROL_HARNESS"/, "candidate executor must verify the immutable harness before executing candidate code");
  assert.match(candidateRunner, /\[ "\$ACTUAL_HARNESS_SHA256" = "\$CONTROL_HARNESS_SHA256" \]/, "candidate executor must reject a harness digest mismatch");
  assert.doesNotMatch(candidateRunner, /candidate\/scripts\//, "candidate scripts must never be selected as the privileged harness");
  assert.match(candidateRunner, /export GITHUB_ENV=\/dev\/null GITHUB_OUTPUT=\/dev\/null GITHUB_PATH=\/dev\/null GITHUB_STEP_SUMMARY=\/dev\/null/, "candidate code must not influence later command-file consumers");
  assert.match(candidateRunner, /unset DOCKER_HOST/, "candidate harness must inherit no engine endpoint");
  assert.doesNotMatch(candidateRunner, /^    outputs:/m, "candidate job must not publish candidate-controlled outputs");

  const receipt = jobBlock(workflow, "trusted-receipt");
  assert.match(receipt, /if: \$\{\{ always\(\) \}\}/, "trusted receipt job must survive a candidate failure");
  assert.match(receipt, /needs: \[control-bind, candidate-runner\]/, "trusted receipt must observe the candidate job result only after control binding");
  assert.match(receipt, /environment:\n      name: g1-candidate-control-plane/, "receipt custody returns to the protected control environment");
  assert.match(receipt, /CANDIDATE_JOB_RESULT: \$\{\{ needs\.candidate-runner\.result \}\}/, "receipt may use the workflow-engine job result");
  assert.match(receipt, /CONTROL_BIND_RESULT: \$\{\{ needs\.control-bind\.result \}\}/, "receipt must distinguish an admission denial from a candidate-job skip");
  assert.match(receipt, /CANDIDATE_RUNNER_IMAGE: \$\{\{ vars\.G1_CANDIDATE_SOCKETLESS_RUNNER_IMAGE \}\}/, "receipt must bind the protected socketless executor image");
  assert.match(receipt, /CONTROL_HARNESS_SHA256: \$\{\{ vars\.G1_CANDIDATE_SOCKETLESS_HARNESS_SHA256 \}\}/, "receipt must bind the protected executor harness digest");
  assert.match(receipt, /BOUND_CANDIDATE_RUNNER_IMAGE: \$\{\{ needs\.control-bind\.outputs\.candidate_runner_image \}\}/, "receipt must compare the admitted runner image with the control binding");
  assert.match(receipt, /BOUND_CONTROL_HARNESS_SHA256: \$\{\{ needs\.control-bind\.outputs\.control_harness_sha256 \}\}/, "receipt must compare the admitted harness with the control binding");
  assert.match(receipt, /CONTROL_AUTHORIZATION_REGISTER_REFERENCE: \$\{\{ vars\.G1_CONTROL_PLANE_AUTHORIZATION_REGISTER_REFERENCE \}\}/, "receipt must record the protected authorization registry reference");
  assert.match(receipt, /CONTROL_AUTHORIZATION_REGISTER_SHA256: \$\{\{ vars\.G1_CONTROL_PLANE_AUTHORIZATION_REGISTER_SHA256 \}\}/, "receipt must record the protected authorization registry digest");
  assert.match(receipt, /ADMISSION_STATE="denied"/, "receipt must record denied admission states");
  assert.match(receipt, /ADMISSION_REASON_CATEGORY="control-bind-failed"/, "receipt must record a denial reason category");
  assert.match(receipt, /authorization-mismatch/, "a rejected authorization must still receive a denial receipt category");
  const controlBindCase = receipt.indexOf('case "$CONTROL_BIND_RESULT"');
  const admittedAuthorizationCheck = receipt.indexOf('[ "$CONTROL_AUTHORIZATION_EVIDENCE" = "$CONTROL_APPROVAL_REFERENCE" ]');
  assert.ok(controlBindCase >= 0 && admittedAuthorizationCheck > controlBindCase, "receipt must evaluate an authorization match only in the admitted branch so a denied admission remains recordable");
  for (const receiptArgument of [
    "--admission-state",
    "--admission-reason-category",
    "--control-bind-result",
    "--candidate-job-result",
    "--candidate-runner-image",
    "--control-harness-sha256",
    "--authorization-register-reference",
    "--authorization-register-sha256",
    "--authorization-evidence"
  ]) {
    assert.match(receipt, new RegExp(escapeRegExp(receiptArgument)), `trusted receipt must include ${receiptArgument}`);
  }
  assert.doesNotMatch(receipt, /needs\.candidate-runner\.outputs/, "trusted receipt must never accept candidate-controlled outputs");
  assert.doesNotMatch(receipt, /path: candidate/, "receipt job must not need a candidate checkout");
  assert.match(receipt, /RECEIPT_WRITER="\$GITHUB_WORKSPACE\/control\/scripts\/g1-candidate-control-plane\/write-trusted-receipt\.sh"/, "receipt must be written by code from the independently checked-out control source");
  assert.match(receipt, /Upload trusted control-plane receipt\n        if: \$\{\{ always\(\) \}\}/, "receipt artifact upload must run even when the candidate job fails");
  assert.match(receipt, new RegExp(escapeRegExp(UPLOAD_ARTIFACT)), "trusted receipt upload must pin its action");
}

test("ordinary candidate workflow is metadata-only and cannot execute candidate code", () => {
  assertG1CandidateWorkflowContract(readFileSync(sourceWorkflowPath, "utf8"));
});

test("future control-plane template binds independent immutable control before socketless candidate execution", () => {
  const workflow = readFileSync(controlPlaneWorkflowPath, "utf8");
  assertG1CandidateControlPlaneContract(workflow);
  assertNoRepositoryOciWritePath(workflow, "future control-plane template");
});

test("ordinary API, Mini, Web, and iOS workflows remain metadata-only hygiene notifications", () => {
  const api = readFileSync(apiRegressionWorkflowPath, "utf8");
  const ios = readFileSync(iosRegressionWorkflowPath, "utf8");
  const mini = readFileSync(miniRegressionWorkflowPath, "utf8");
  const web = readFileSync(webRegressionWorkflowPath, "utf8");
  assertMetadataOnlyWorkflow(api, "API metadata hygiene (untrusted)");
  assertMetadataOnlyWorkflow(ios, "iOS metadata hygiene (untrusted)");
  assertMetadataOnlyWorkflow(mini, "Mini Program metadata hygiene (untrusted)");
  assertMetadataOnlyWorkflow(web, "Web metadata hygiene (untrusted)");
  for (const [label, workflow] of [
    ["ordinary API workflow", api],
    ["ordinary iOS workflow", ios],
    ["ordinary Mini workflow", mini],
    ["ordinary Web workflow", web],
    ["ordinary G1 workflow", readFileSync(sourceWorkflowPath, "utf8")]
  ]) assertNoRepositoryOciWritePath(workflow, label);
});

test("metadata hygiene allowlist rejects extra jobs, permissions, actions, and commands", () => {
  const source = readFileSync(sourceWorkflowPath, "utf8");
  const mutations = [
    [
      source.replace("\njobs:\n", "\njobs:\n  extra:\n    runs-on: ubuntu-latest\n"),
      /block-style approved metadata job/
    ],
    [
      source.replace("\njobs:\n", "\njobs:\n  extra: {runs-on: ubuntu-latest, steps: [{run: /usr/bin/true}]}\n"),
      /block-style approved metadata job/
    ],
    [
      source.replace("\npermissions:\n", "\n  workflow_dispatch: {}\n\npermissions:\n"),
      /authority-bearing trigger/
    ],
    [
      source.replace("permissions:\n  contents: read", "permissions:\n  contents: read\n  id-token: write"),
      /exactly read-only repository permission/
    ],
    [
      source.replace("    runs-on: ubuntu-latest", "    permissions:\n      id-token: write\n    runs-on: ubuntu-latest"),
      /job-level capability/
    ],
    [
      source.replace("steps:\n", "steps:\n      - uses: acme\/opaque-action@0123456789abcdef0123456789abcdef01234567\n"),
      /must not add an unreviewed action/
    ],
    [
      source.replace("diff --check --no-ext-diff", "diff --check --no-ext-diff\n          /usr/bin/true"),
      /only fixed Git metadata commands/
    ]
  ];
  for (const [mutated, expected] of mutations) {
    assert.throws(() => assertG1CandidateWorkflowContract(mutated), expected);
  }
});

test("repository workflow contracts reject an OCI publishing command even in the future template", () => {
  const control = readFileSync(controlPlaneWorkflowPath, "utf8");
  assert.throws(
    () => assertNoRepositoryOciWritePath(`${control}\n# docker buildx build --push .`, "mutated control-plane template"),
    /OCI build, registry write, or signing path/
  );
});

test("candidate package scripts keep every test-oriented API and Web gate zero-skip", () => {
  const api = JSON.parse(readFileSync(apiPackagePath, "utf8"));
  const web = JSON.parse(readFileSync(webPackagePath, "utf8"));
  for (const script of ["test", "test:preflight:static", "test:preflight:postgres", "test:e2e", "test:e2e:guard"]) {
    assert.match(api.scripts[script], /assert-zero-skips\.mjs/, `API ${script} must fail on a skipped or pending test`);
  }
  assert.match(web.scripts["check:candidate"], /assert-zero-skips\.mjs --npm run check/, "Web candidate check must reject skipped or pending Node test output");
});
