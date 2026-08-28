import assert from "node:assert/strict";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CARD_KIND,
  PUBLIC_ROUTES,
  SCHEMA_VERSION,
  STRUCTURAL_VALIDATION_DISCLAIMER,
  VIEWPORT_WIDTHS,
  assertExternalRegularJsonFile,
  readAndValidateBrowserEvidenceCard,
  runCli,
  validateBrowserEvidenceCard,
} from "./g2-browser-evidence-card-contract.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const scriptPath = join(repositoryRoot, "scripts", "g2-browser-evidence-card-contract.mjs");

function sha(character) {
  return character.repeat(64);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function matrixResult(route, width) {
  const suffix = `${route === "/" ? "home" : route.slice(1)}-${width}`;
  return {
    route,
    viewport: { width, height: 900, devicePixelRatio: 2 },
    browser: { name: "Chromium", version: "128.0.0" },
    operatingSystem: { name: "macOS", version: "15.0" },
    network: { profile: "controlled-wifi-v1", profileSha256: sha("1") },
    cache: { state: "cold", method: "new-context-per-sample" },
    artifacts: {
      screenshot: { reference: `evidence://talkandtalk/browser/${suffix}/screenshot`, sha256: sha("2") },
      dom: { reference: `evidence://talkandtalk/browser/${suffix}/dom`, sha256: sha("3") },
    },
    keyboardFocus: { outcome: "passed", method: "sequential-tab-order" },
    zoom: { percent: 200, reflowOutcome: "passed", horizontalOverflow: "passed" },
    reducedMotion: { outcome: "passed", method: "prefers-reduced-motion" },
  };
}

function validCard({ outcome = "passed" } = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: CARD_KIND,
    outcome,
    cardReference: "card://talkandtalk/g2-browser/20260810",
    evidenceReference: "evidence://talkandtalk/g2-browser/20260810",
    candidate: {
      repository: "talkandtalk/talk-and-talk",
      sha: "a".repeat(40),
      sourceTreeSha256: sha("b"),
    },
    webArtifact: {
      sha256: sha("c"),
      custodyReceipt: {
        reference: "receipt://talkandtalk/oci/web/20260810",
        sha256: sha("d"),
      },
    },
    issuer: { id: "release-control" },
    reviewer: { id: "independent-reviewer" },
    lifecycle: {
      startedAt: "2026-08-10T01:00:00Z",
      finishedAt: "2026-08-10T01:15:00Z",
      recordedAt: "2026-08-10T01:20:00Z",
    },
    cleanup: {
      state: "completed",
      evidenceReference: "evidence://talkandtalk/browser-cleanup/20260810",
      recordedAt: "2026-08-10T01:21:00Z",
    },
    failureState: outcome === "passed"
      ? { status: "none", reasonCode: "none" }
      : { status: outcome, reasonCode: "fixture-failure-state" },
    routeViewportResults: PUBLIC_ROUTES.flatMap((route) => VIEWPORT_WIDTHS.map((width) => matrixResult(route, width))),
    axe: {
      engine: "axe-core",
      version: "4.10.0",
      ruleset: "wcag2aa",
      rulesetSha256: sha("4"),
      blockingSeverities: ["serious", "critical"],
      violationCount: 0,
      blockingViolationCount: 0,
      resultSha256: sha("5"),
    },
    performance: {
      method: "controlled-browser-performance-v1",
      methodSha256: sha("6"),
      resultsSha256: sha("7"),
      cold: { sampleCount: 5, lcpMs: 1200, inpMs: 90, cls: 0.01 },
      warm: { sampleCount: 5, lcpMs: 800, inpMs: 70, cls: 0.005 },
    },
    performanceBudget: {
      version: "web-performance-budget-v1",
      approvedThresholdReference: "policy://talkandtalk/web-performance-budget/v1",
      approvedThresholdSha256: sha("8"),
      thresholds: { lcpMs: 2500, inpMs: 200, cls: 0.1 },
      minimumSampleCounts: { cold: 5, warm: 5 },
    },
    limitations: {
      structuralValidationOnly: true,
      browserRuntimeEvidenceVerified: false,
      custodyEvidenceVerified: false,
      authorizationEvidenceVerified: false,
    },
  };
}

function writeCard(directory, card = validCard(), name = "browser-card.json") {
  const path = join(directory, name);
  writeFileSync(path, `${JSON.stringify(card, null, 2)}\n`, "utf8");
  return path;
}

test("accepts a complete card and explicit candidate/artifact bindings without approving runtime evidence", () => {
  const card = validCard();
  const result = validateBrowserEvidenceCard(card, {
    candidateRepository: card.candidate.repository,
    candidateSha: card.candidate.sha,
    candidateSourceTreeSha256: card.candidate.sourceTreeSha256,
    webArtifactSha256: card.webArtifact.sha256,
  });
  assert.equal(result.outcome, "passed");
  assert.equal(result.routeViewportResultCount, PUBLIC_ROUTES.length * VIEWPORT_WIDTHS.length);
  assert.equal(result.structuralValidationOnly, true);
  assert.equal(result.disclaimer, STRUCTURAL_VALIDATION_DISCLAIMER);
  assert.equal(result.performanceBudget.version, "web-performance-budget-v1");
});

test("rejects malformed candidate and artifact bindings", () => {
  const badRepository = validCard();
  badRepository.candidate.repository = "not-a-repository";
  assert.throws(() => validateBrowserEvidenceCard(badRepository), /candidate\.repository/);

  const badCandidateSha = validCard();
  badCandidateSha.candidate.sha = "A".repeat(40);
  assert.throws(() => validateBrowserEvidenceCard(badCandidateSha), /candidate\.sha/);

  const badTree = validCard();
  badTree.candidate.sourceTreeSha256 = "x".repeat(64);
  assert.throws(() => validateBrowserEvidenceCard(badTree), /candidate\.sourceTreeSha256/);

  const badArtifact = validCard();
  delete badArtifact.webArtifact.custodyReceipt.sha256;
  assert.throws(() => validateBrowserEvidenceCard(badArtifact), /custodyReceipt\.sha256/);

  const mismatch = validCard();
  assert.throws(
    () => validateBrowserEvidenceCard(mismatch, { candidateSha: "f".repeat(40) }),
    /explicit expected binding/,
  );
});

test("requires the exact route/viewport matrix and each browser evidence facet", () => {
  const missing = validCard();
  missing.routeViewportResults.pop();
  assert.throws(() => validateBrowserEvidenceCard(missing), /exactly 20 route\/viewport results/);

  const duplicate = validCard();
  duplicate.routeViewportResults[1] = clone(duplicate.routeViewportResults[0]);
  assert.throws(() => validateBrowserEvidenceCard(duplicate), /duplicate result/);

  const mutations = [
    ["browser version", (card) => { delete card.routeViewportResults[0].browser.version; }, /browser\.version/],
    ["operating system version", (card) => { delete card.routeViewportResults[0].operatingSystem.version; }, /operatingSystem\.version/],
    ["positive DPR", (card) => { card.routeViewportResults[0].viewport.devicePixelRatio = 0; }, /devicePixelRatio/],
    ["network profile hash", (card) => { delete card.routeViewportResults[0].network.profileSha256; }, /network\.profileSha256/],
    ["cache method", (card) => { delete card.routeViewportResults[0].cache.method; }, /cache\.method/],
    ["screenshot reference", (card) => { delete card.routeViewportResults[0].artifacts.screenshot.reference; }, /artifacts\.screenshot\.reference/],
    ["DOM hash", (card) => { delete card.routeViewportResults[0].artifacts.dom.sha256; }, /artifacts\.dom\.sha256/],
    ["keyboard focus outcome", (card) => { delete card.routeViewportResults[0].keyboardFocus.outcome; }, /keyboardFocus\.outcome/],
    ["200 percent zoom", (card) => { card.routeViewportResults[0].zoom.percent = 175; }, /zoom\.percent/],
    ["zoom reflow", (card) => { delete card.routeViewportResults[0].zoom.reflowOutcome; }, /zoom\.reflowOutcome/],
    ["overflow outcome", (card) => { delete card.routeViewportResults[0].zoom.horizontalOverflow; }, /zoom\.horizontalOverflow/],
    ["reduced motion", (card) => { delete card.routeViewportResults[0].reducedMotion.method; }, /reducedMotion\.method/],
  ];
  for (const [name, mutate, expected] of mutations) {
    const card = validCard();
    mutate(card);
    assert.throws(() => validateBrowserEvidenceCard(card), expected, name);
  }
});

test("requires axe and cold/warm performance evidence facets", () => {
  const mutations = [
    ["axe engine", (card) => { delete card.axe.engine; }, /axe\.engine/],
    ["axe ruleset hash", (card) => { delete card.axe.rulesetSha256; }, /axe\.rulesetSha256/],
    ["axe blocking severity", (card) => { card.axe.blockingSeverities = []; }, /blockingSeverities/],
    ["axe violation count", (card) => { card.axe.violationCount = -1; }, /axe\.violationCount/],
    ["axe blocking violation count", (card) => { delete card.axe.blockingViolationCount; }, /axe\.blockingViolationCount/],
    ["axe result hash", (card) => { delete card.axe.resultSha256; }, /axe\.resultSha256/],
    ["performance method hash", (card) => { delete card.performance.methodSha256; }, /performance\.methodSha256/],
    ["performance results hash", (card) => { delete card.performance.resultsSha256; }, /performance\.resultsSha256/],
    ["cold sample count", (card) => { card.performance.cold.sampleCount = 0; }, /performance\.cold\.sampleCount/],
    ["cold LCP", (card) => { delete card.performance.cold.lcpMs; }, /performance\.cold\.lcpMs/],
    ["cold INP", (card) => { delete card.performance.cold.inpMs; }, /performance\.cold\.inpMs/],
    ["cold CLS", (card) => { delete card.performance.cold.cls; }, /performance\.cold\.cls/],
    ["warm sample count", (card) => { card.performance.warm.sampleCount = 0; }, /performance\.warm\.sampleCount/],
    ["warm LCP", (card) => { delete card.performance.warm.lcpMs; }, /performance\.warm\.lcpMs/],
    ["warm INP", (card) => { delete card.performance.warm.inpMs; }, /performance\.warm\.inpMs/],
    ["warm CLS", (card) => { delete card.performance.warm.cls; }, /performance\.warm\.cls/],
  ];
  for (const [name, mutate, expected] of mutations) {
    const card = validCard();
    mutate(card);
    assert.throws(() => validateBrowserEvidenceCard(card), expected, name);
  }
});

test("requires the fixed serious/critical axe blocking-severity policy for every outcome", () => {
  const invalidBlockingSeverities = [
    ["minor only", ["minor"]],
    ["serious only", ["serious"]],
    ["reversed order", ["critical", "serious"]],
    ["extra severity", ["serious", "critical", "moderate"]],
    ["duplicate severity", ["serious", "serious", "critical"]],
  ];

  for (const outcome of ["passed", "failed", "blocked"]) {
    assert.equal(validateBrowserEvidenceCard(validCard({ outcome })).outcome, outcome);
    for (const [name, blockingSeverities] of invalidBlockingSeverities) {
      const card = validCard({ outcome });
      card.axe.blockingSeverities = blockingSeverities;
      assert.throws(
        () => validateBrowserEvidenceCard(card),
        /axe\.blockingSeverities must be exactly \["serious", "critical"\] in that order/,
        `${outcome}: ${name}`,
      );
    }
  }
});

test("requires a passed card to keep every interaction facet and blocking aXe result passed", () => {
  const keyboardFailure = validCard();
  keyboardFailure.routeViewportResults[0].keyboardFocus.outcome = "failed";
  assert.throws(
    () => validateBrowserEvidenceCard(keyboardFailure),
    /routeViewportResults\[0\]\.keyboardFocus to be passed/,
  );

  const overflowFailure = validCard();
  overflowFailure.routeViewportResults[0].zoom.horizontalOverflow = "failed";
  assert.throws(
    () => validateBrowserEvidenceCard(overflowFailure),
    /routeViewportResults\[0\]\.zoomHorizontalOverflow to be passed/,
  );

  const blockingAxe = validCard();
  blockingAxe.axe.violationCount = 1;
  blockingAxe.axe.blockingViolationCount = 1;
  assert.throws(
    () => validateBrowserEvidenceCard(blockingAxe),
    /axe\.blockingViolationCount to be zero/,
  );

  const impossibleAxeCounts = validCard({ outcome: "failed" });
  impossibleAxeCounts.axe.violationCount = 1;
  impossibleAxeCounts.axe.blockingViolationCount = 2;
  assert.throws(
    () => validateBrowserEvidenceCard(impossibleAxeCounts), /must not exceed axe\.violationCount/);
});

test("allows an unapproved performance budget only as an explicitly blocked card", () => {
  const blocked = validCard({ outcome: "blocked" });
  blocked.failureState = { status: "blocked", reasonCode: "performance-budget-unapproved" };
  delete blocked.performanceBudget;
  assert.equal(validateBrowserEvidenceCard(blocked).performanceBudget, null);

  const wrongReason = clone(blocked);
  wrongReason.failureState.reasonCode = "waiting-for-review";
  assert.throws(() => validateBrowserEvidenceCard(wrongReason), /performance-budget-unapproved/);

  const passedWithoutBudget = validCard();
  delete passedWithoutBudget.performanceBudget;
  assert.throws(() => validateBrowserEvidenceCard(passedWithoutBudget), /missing performanceBudget/);

  const failedWithoutBudget = validCard({ outcome: "failed" });
  delete failedWithoutBudget.performanceBudget;
  assert.throws(() => validateBrowserEvidenceCard(failedWithoutBudget), /missing performanceBudget/);
});

test("binds passed performance results to the approved budget and minimum sample counts", () => {
  const insufficientSamples = validCard();
  insufficientSamples.performance.cold.sampleCount = 4;
  assert.throws(
    () => validateBrowserEvidenceCard(insufficientSamples),
    /performance\.cold\.sampleCount must meet performanceBudget\.minimumSampleCounts\.cold/,
  );

  const overBudget = validCard();
  overBudget.performance.warm.inpMs = 201;
  assert.throws(
    () => validateBrowserEvidenceCard(overBudget),
    /a passed outcome requires performance\.warm\.inpMs to meet performanceBudget\.thresholds\.inpMs/,
  );

  const failedWithPreservedMeasurements = validCard({ outcome: "failed" });
  failedWithPreservedMeasurements.performance.cold.lcpMs = 2501;
  assert.equal(validateBrowserEvidenceCard(failedWithPreservedMeasurements).outcome, "failed");
});

test("requires a passed card to record completed cleanup after the lifecycle", () => {
  for (const state of ["pending", "not-required"]) {
    const card = validCard();
    card.cleanup.state = state;
    assert.throws(
      () => validateBrowserEvidenceCard(card),
      /a passed outcome requires cleanup\.state to be completed/,
      state,
    );
  }

  for (const timestamp of ["2026-08-10T01:19:59Z", "2026-08-10T01:20:00Z"]) {
    const staleCleanup = validCard();
    staleCleanup.cleanup.recordedAt = timestamp;
    assert.throws(
      () => validateBrowserEvidenceCard(staleCleanup),
      /a passed outcome requires cleanup\.recordedAt to be after lifecycle\.recordedAt/,
      timestamp,
    );
  }
});

test("CLI requires all frozen bindings before accepting a passed card", () => {
  const directory = mkdtempSync(join(tmpdir(), "talkandtalk-g2-browser-cli-bindings-"));
  try {
    const passedPath = writeCard(directory);
    const missingStdout = [];
    const missingStderr = [];
    assert.equal(runCli(["validate", "--card", passedPath], {
      stdout: { write(value) { missingStdout.push(value); } },
      stderr: { write(value) { missingStderr.push(value); } },
    }), 2);
    assert.equal(missingStdout.join(""), "");
    assert.match(
      missingStderr.join(""),
      /--expected-candidate-repository, --expected-candidate-sha, --expected-candidate-source-tree-sha256, --expected-web-artifact-sha256/,
    );

    const expectedArguments = [
      ["--expected-candidate-repository", "talkandtalk/talk-and-talk"],
      ["--expected-candidate-sha", "a".repeat(40)],
      ["--expected-candidate-source-tree-sha256", sha("b")],
      ["--expected-web-artifact-sha256", sha("c")],
    ];
    for (const [omittedFlag] of expectedArguments) {
      const omittedStderr = [];
      assert.equal(runCli([
        "validate",
        "--card", passedPath,
        ...expectedArguments.filter(([flag]) => flag !== omittedFlag).flat(),
      ], {
        stdout: { write() {} },
        stderr: { write(value) { omittedStderr.push(value); } },
      }), 2, omittedFlag);
      assert.match(omittedStderr.join(""), new RegExp(omittedFlag), omittedFlag);
    }

    const failedPath = writeCard(directory, validCard({ outcome: "failed" }), "failed-card.json");
    const failedStdout = [];
    const failedStderr = [];
    assert.equal(runCli(["validate", "--card", failedPath], {
      stdout: { write(value) { failedStdout.push(value); } },
      stderr: { write(value) { failedStderr.push(value); } },
    }), 0);
    assert.equal(failedStderr.join(""), "");
    assert.match(failedStdout.join(""), /Valid structural G2 browser evidence card/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reads only absolute external regular JSON files and rejects symlinks or repository paths", () => {
  const directory = mkdtempSync(join(tmpdir(), "talkandtalk-g2-browser-card-"));
  try {
    const cardPath = writeCard(directory);
    const result = readAndValidateBrowserEvidenceCard(cardPath);
    assert.equal(result.path, realpathSync(cardPath));

    const symlinkPath = join(directory, "browser-card-link.json");
    symlinkSync(cardPath, symlinkPath);
    assert.throws(() => assertExternalRegularJsonFile(symlinkPath), /symbolic link/);
    assert.throws(() => assertExternalRegularJsonFile(join(directory, "missing.json")), /does not exist/);
    assert.throws(() => assertExternalRegularJsonFile(directory), /regular file/);
    assert.throws(() => assertExternalRegularJsonFile(scriptPath), /outside the candidate repository/);
    assert.throws(() => assertExternalRegularJsonFile("relative-card.json"), /absolute external path/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CLI has no execution side effects and prints the structural-only disclaimer", () => {
  const source = readFileSync(scriptPath, "utf8");
  assert.doesNotMatch(source, /node:(?:child_process|http|https|net|tls|dgram)/);
  assert.doesNotMatch(source, /\b(?:writeFileSync|appendFileSync|mkdirSync|rmSync|unlinkSync|spawnSync|execFileSync|fetch)\b/);

  const directory = mkdtempSync(join(tmpdir(), "talkandtalk-g2-browser-cli-"));
  try {
    const cardPath = writeCard(directory);
    const beforeBytes = readFileSync(cardPath, "utf8");
    const beforeMtime = statSync(cardPath).mtimeMs;
    const stdout = [];
    const stderr = [];
    const code = runCli([
      "validate",
      "--card", cardPath,
      "--expected-candidate-repository", "talkandtalk/talk-and-talk",
      "--expected-candidate-sha", "a".repeat(40),
      "--expected-candidate-source-tree-sha256", sha("b"),
      "--expected-web-artifact-sha256", sha("c"),
    ], {
      stdout: { write(value) { stdout.push(value); } },
      stderr: { write(value) { stderr.push(value); } },
    });
    assert.equal(code, 0);
    assert.equal(stderr.join(""), "");
    assert.match(stdout.join(""), /STRUCTURAL VALIDATION ONLY/);
    assert.match(stdout.join(""), /does NOT prove browser runtime, custody, or authorization evidence/);
    assert.equal(readFileSync(cardPath, "utf8"), beforeBytes);
    assert.equal(statSync(cardPath).mtimeMs, beforeMtime);
    assert.equal(lstatSync(cardPath).isFile(), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
