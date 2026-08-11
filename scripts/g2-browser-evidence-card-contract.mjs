#!/usr/bin/env node
/**
 * Structural-only validator for a G2 browser evidence card.
 *
 * This module deliberately reads one JSON document and validates its shape and
 * explicit bindings. It never launches a browser, opens a network connection,
 * starts a child process, creates a container, or writes a file. A successful
 * result is not browser-runtime, custody, or authorization evidence.
 */
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA_VERSION = 1;
export const CARD_KIND = "talk-and-talk-g2-browser-evidence-card";
export const PUBLIC_ROUTES = Object.freeze([
  "/",
  "/how-it-works",
  "/safety",
  "/partners",
  "/about",
]);
export const VIEWPORT_WIDTHS = Object.freeze([320, 390, 768, 1440]);
export const STRUCTURAL_VALIDATION_DISCLAIMER = "STRUCTURAL VALIDATION ONLY: a valid card shape does NOT prove browser runtime, custody, or authorization evidence.";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const REFERENCE_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/[A-Za-z0-9][A-Za-z0-9._~!$&'()*+,;=:@/%#?-]{1,239}$/;
const REPOSITORY_PATTERN = /^(?:[A-Za-z0-9][A-Za-z0-9.-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const REASON_CODE_PATTERN = /^[a-z][a-z0-9-]{2,79}$/;
const OUTCOMES = new Set(["passed", "failed", "blocked"]);
const RESULT_OUTCOMES = new Set(["passed", "failed", "blocked"]);
const REQUIRED_AXE_BLOCKING_SEVERITIES = Object.freeze(["serious", "critical"]);
const CLEANUP_STATES = new Set(["completed", "pending", "not-required"]);
const REQUIRED_PASSED_CLI_BINDINGS = Object.freeze([
  "candidateRepository",
  "candidateSha",
  "candidateSourceTreeSha256",
  "webArtifactSha256",
]);
const REPOSITORY_ROOT = realpathSync(resolve(fileURLToPath(new URL("..", import.meta.url))));

function fail(message) {
  const error = new Error(`G2 browser evidence card: ${message}`);
  error.code = "G2_BROWSER_EVIDENCE_CARD_ERROR";
  throw error;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireObject(value, label) {
  if (!isObject(value)) fail(`${label} must be an object`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    fail(`${label} must be a non-empty trimmed string`);
  }
  return value;
}

function requireSha(value, label) {
  if (typeof value !== "string" || !SHA_PATTERN.test(value)) {
    fail(`${label} must be an exact lowercase 40-character Git SHA`);
  }
  return value;
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(`${label} must be an exact lowercase SHA-256 value`);
  }
  return value;
}

function requireReference(value, label) {
  if (typeof value !== "string" || !REFERENCE_PATTERN.test(value)) {
    fail(`${label} must be a canonical URI-like evidence reference`);
  }
  return value;
}

function requireRepository(value, label) {
  const repository = requireString(value, label);
  if (!REPOSITORY_PATTERN.test(repository)) {
    fail(`${label} must be a canonical owner/repository or host/owner/repository identifier`);
  }
  return repository;
}

function requireUtcTimestamp(value, label) {
  if (typeof value !== "string" || !UTC_TIMESTAMP_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    fail(`${label} must be a valid UTC timestamp ending in Z`);
  }
  return { value, epochMs: Date.parse(value) };
}

function requireNonNegativeNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail(`${label} must be a finite non-negative number`);
  }
  return value;
}

function requirePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) fail(`${label} must be a positive integer`);
  return value;
}

function requireOutcome(value, label) {
  if (!RESULT_OUTCOMES.has(value)) fail(`${label} must be passed, failed, or blocked`);
  return value;
}

function pathInside(parent, child) {
  const relation = relative(parent, child);
  return relation === "" || (relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation));
}

function requireActor(value, label) {
  const actor = requireObject(value, label);
  return { id: requireString(actor.id, `${label}.id`) };
}

function requireArtifactReference(value, label) {
  const artifact = requireObject(value, label);
  return {
    reference: requireReference(artifact.reference, `${label}.reference`),
    sha256: requireSha256(artifact.sha256, `${label}.sha256`),
  };
}

function validateCandidate(value) {
  const candidate = requireObject(value, "candidate");
  return {
    repository: requireRepository(candidate.repository, "candidate.repository"),
    sha: requireSha(candidate.sha, "candidate.sha"),
    sourceTreeSha256: requireSha256(candidate.sourceTreeSha256, "candidate.sourceTreeSha256"),
  };
}

function validateWebArtifact(value) {
  const artifact = requireObject(value, "webArtifact");
  const custodyReceipt = requireObject(artifact.custodyReceipt, "webArtifact.custodyReceipt");
  return {
    sha256: requireSha256(artifact.sha256, "webArtifact.sha256"),
    custodyReceipt: {
      reference: requireReference(custodyReceipt.reference, "webArtifact.custodyReceipt.reference"),
      sha256: requireSha256(custodyReceipt.sha256, "webArtifact.custodyReceipt.sha256"),
    },
  };
}

function validateLifecycle(value) {
  const lifecycle = requireObject(value, "lifecycle");
  const startedAt = requireUtcTimestamp(lifecycle.startedAt, "lifecycle.startedAt");
  const finishedAt = requireUtcTimestamp(lifecycle.finishedAt, "lifecycle.finishedAt");
  const recordedAt = requireUtcTimestamp(lifecycle.recordedAt, "lifecycle.recordedAt");
  if (finishedAt.epochMs < startedAt.epochMs) fail("lifecycle.finishedAt must not precede lifecycle.startedAt");
  if (recordedAt.epochMs < finishedAt.epochMs) fail("lifecycle.recordedAt must not precede lifecycle.finishedAt");
  return {
    startedAt: startedAt.value,
    finishedAt: finishedAt.value,
    recordedAt: recordedAt.value,
    recordedAtEpochMs: recordedAt.epochMs,
  };
}

function validateCleanup(value, outcome, lifecycle) {
  const cleanup = requireObject(value, "cleanup");
  if (!CLEANUP_STATES.has(cleanup.state)) fail("cleanup.state must be completed, pending, or not-required");
  if (outcome === "passed" && cleanup.state !== "completed") {
    fail("a passed outcome requires cleanup.state to be completed");
  }
  const recordedAt = requireUtcTimestamp(cleanup.recordedAt, "cleanup.recordedAt");
  if (outcome === "passed" && recordedAt.epochMs <= lifecycle.recordedAtEpochMs) {
    fail("a passed outcome requires cleanup.recordedAt to be after lifecycle.recordedAt");
  }
  return {
    state: cleanup.state,
    evidenceReference: requireReference(cleanup.evidenceReference, "cleanup.evidenceReference"),
    recordedAt: recordedAt.value,
  };
}

function validateFailureState(value, outcome) {
  const failureState = requireObject(value, "failureState");
  const status = failureState.status;
  const reasonCode = failureState.reasonCode;
  if (outcome === "passed") {
    if (status !== "none" || reasonCode !== "none") {
      fail("a passed outcome must declare failureState.status and failureState.reasonCode as none");
    }
    return { status, reasonCode };
  }
  if (status !== outcome) fail(`a ${outcome} outcome must declare failureState.status as ${outcome}`);
  if (typeof reasonCode !== "string" || !REASON_CODE_PATTERN.test(reasonCode) || reasonCode === "none") {
    fail(`a ${outcome} outcome must declare a canonical non-none failureState.reasonCode`);
  }
  return { status, reasonCode };
}

function validateMatrixEntry(value, index) {
  const result = requireObject(value, `routeViewportResults[${index}]`);
  const route = result.route;
  if (!PUBLIC_ROUTES.includes(route)) fail(`routeViewportResults[${index}].route must name one approved public route`);

  const viewport = requireObject(result.viewport, `routeViewportResults[${index}].viewport`);
  if (!VIEWPORT_WIDTHS.includes(viewport.width)) {
    fail(`routeViewportResults[${index}].viewport.width must be one of ${VIEWPORT_WIDTHS.join(", ")}`);
  }
  requirePositiveInteger(viewport.height, `routeViewportResults[${index}].viewport.height`);
  requireNonNegativeNumber(viewport.devicePixelRatio, `routeViewportResults[${index}].viewport.devicePixelRatio`);
  if (viewport.devicePixelRatio <= 0) fail(`routeViewportResults[${index}].viewport.devicePixelRatio must be greater than zero`);

  const browser = requireObject(result.browser, `routeViewportResults[${index}].browser`);
  requireString(browser.name, `routeViewportResults[${index}].browser.name`);
  requireString(browser.version, `routeViewportResults[${index}].browser.version`);

  const operatingSystem = requireObject(result.operatingSystem, `routeViewportResults[${index}].operatingSystem`);
  requireString(operatingSystem.name, `routeViewportResults[${index}].operatingSystem.name`);
  requireString(operatingSystem.version, `routeViewportResults[${index}].operatingSystem.version`);

  const network = requireObject(result.network, `routeViewportResults[${index}].network`);
  requireString(network.profile, `routeViewportResults[${index}].network.profile`);
  requireSha256(network.profileSha256, `routeViewportResults[${index}].network.profileSha256`);

  const cache = requireObject(result.cache, `routeViewportResults[${index}].cache`);
  requireString(cache.state, `routeViewportResults[${index}].cache.state`);
  requireString(cache.method, `routeViewportResults[${index}].cache.method`);

  const artifacts = requireObject(result.artifacts, `routeViewportResults[${index}].artifacts`);
  requireArtifactReference(artifacts.screenshot, `routeViewportResults[${index}].artifacts.screenshot`);
  requireArtifactReference(artifacts.dom, `routeViewportResults[${index}].artifacts.dom`);

  const keyboardFocus = requireObject(result.keyboardFocus, `routeViewportResults[${index}].keyboardFocus`);
  requireOutcome(keyboardFocus.outcome, `routeViewportResults[${index}].keyboardFocus.outcome`);
  requireString(keyboardFocus.method, `routeViewportResults[${index}].keyboardFocus.method`);

  const zoom = requireObject(result.zoom, `routeViewportResults[${index}].zoom`);
  if (zoom.percent !== 200) fail(`routeViewportResults[${index}].zoom.percent must be exactly 200`);
  requireOutcome(zoom.reflowOutcome, `routeViewportResults[${index}].zoom.reflowOutcome`);
  requireOutcome(zoom.horizontalOverflow, `routeViewportResults[${index}].zoom.horizontalOverflow`);

  const reducedMotion = requireObject(result.reducedMotion, `routeViewportResults[${index}].reducedMotion`);
  requireOutcome(reducedMotion.outcome, `routeViewportResults[${index}].reducedMotion.outcome`);
  requireString(reducedMotion.method, `routeViewportResults[${index}].reducedMotion.method`);

  return {
    route,
    viewportWidth: viewport.width,
    interactionOutcomes: {
      keyboardFocus: keyboardFocus.outcome,
      zoomReflow: zoom.reflowOutcome,
      zoomHorizontalOverflow: zoom.horizontalOverflow,
      reducedMotion: reducedMotion.outcome,
    },
  };
}

function validateRouteViewportResults(value, outcome) {
  if (!Array.isArray(value)) fail("routeViewportResults must be an array");
  const expectedCount = PUBLIC_ROUTES.length * VIEWPORT_WIDTHS.length;
  if (value.length !== expectedCount) {
    fail(`routeViewportResults must contain exactly ${expectedCount} route/viewport results`);
  }
  const expected = new Set(PUBLIC_ROUTES.flatMap((route) => VIEWPORT_WIDTHS.map((width) => `${route}\u0000${width}`)));
  const actual = new Set();
  for (const [index, entry] of value.entries()) {
    const result = validateMatrixEntry(entry, index);
    const key = `${result.route}\u0000${result.viewportWidth}`;
    if (actual.has(key)) fail(`routeViewportResults contains a duplicate result for ${result.route} at ${result.viewportWidth}px`);
    actual.add(key);
    if (outcome === "passed") {
      for (const [facet, facetOutcome] of Object.entries(result.interactionOutcomes)) {
        if (facetOutcome !== "passed") {
          fail(`a passed outcome requires routeViewportResults[${index}].${facet} to be passed`);
        }
      }
    }
  }
  for (const key of expected) {
    if (!actual.has(key)) {
      const [route, width] = key.split("\u0000");
      fail(`routeViewportResults is missing ${route} at ${width}px`);
    }
  }
  return expectedCount;
}

function validateAxe(value, outcome) {
  const axe = requireObject(value, "axe");
  requireString(axe.engine, "axe.engine");
  requireString(axe.version, "axe.version");
  requireString(axe.ruleset, "axe.ruleset");
  requireSha256(axe.rulesetSha256, "axe.rulesetSha256");
  if (
    !Array.isArray(axe.blockingSeverities)
    || axe.blockingSeverities.length !== REQUIRED_AXE_BLOCKING_SEVERITIES.length
    || axe.blockingSeverities.some(
      (severity, index) => severity !== REQUIRED_AXE_BLOCKING_SEVERITIES[index],
    )
  ) {
    fail('axe.blockingSeverities must be exactly ["serious", "critical"] in that order');
  }
  requireNonNegativeNumber(axe.violationCount, "axe.violationCount");
  if (!Number.isInteger(axe.violationCount)) fail("axe.violationCount must be an integer");
  requireNonNegativeNumber(axe.blockingViolationCount, "axe.blockingViolationCount");
  if (!Number.isInteger(axe.blockingViolationCount)) fail("axe.blockingViolationCount must be an integer");
  if (axe.blockingViolationCount > axe.violationCount) {
    fail("axe.blockingViolationCount must not exceed axe.violationCount");
  }
  if (outcome === "passed" && axe.blockingViolationCount !== 0) {
    fail("a passed outcome requires axe.blockingViolationCount to be zero");
  }
  requireSha256(axe.resultSha256, "axe.resultSha256");
  return {
    blockingSeverities: [...REQUIRED_AXE_BLOCKING_SEVERITIES],
    blockingViolationCount: axe.blockingViolationCount,
  };
}

function validatePerformanceAggregate(value, label) {
  const aggregate = requireObject(value, label);
  return {
    sampleCount: requirePositiveInteger(aggregate.sampleCount, `${label}.sampleCount`),
    lcpMs: requireNonNegativeNumber(aggregate.lcpMs, `${label}.lcpMs`),
    inpMs: requireNonNegativeNumber(aggregate.inpMs, `${label}.inpMs`),
    cls: requireNonNegativeNumber(aggregate.cls, `${label}.cls`),
  };
}

function validatePerformance(value) {
  const performance = requireObject(value, "performance");
  const cold = validatePerformanceAggregate(performance.cold, "performance.cold");
  const warm = validatePerformanceAggregate(performance.warm, "performance.warm");
  return {
    method: requireString(performance.method, "performance.method"),
    methodSha256: requireSha256(performance.methodSha256, "performance.methodSha256"),
    resultsSha256: requireSha256(performance.resultsSha256, "performance.resultsSha256"),
    cold,
    warm,
  };
}

function validatePerformanceBudget(value) {
  const budget = requireObject(value, "performanceBudget");
  const thresholds = requireObject(budget.thresholds, "performanceBudget.thresholds");
  const minimumSampleCounts = requireObject(budget.minimumSampleCounts, "performanceBudget.minimumSampleCounts");
  return {
    version: requireString(budget.version, "performanceBudget.version"),
    approvedThresholdReference: requireReference(budget.approvedThresholdReference, "performanceBudget.approvedThresholdReference"),
    approvedThresholdSha256: requireSha256(budget.approvedThresholdSha256, "performanceBudget.approvedThresholdSha256"),
    thresholds: {
      lcpMs: requireNonNegativeNumber(thresholds.lcpMs, "performanceBudget.thresholds.lcpMs"),
      inpMs: requireNonNegativeNumber(thresholds.inpMs, "performanceBudget.thresholds.inpMs"),
      cls: requireNonNegativeNumber(thresholds.cls, "performanceBudget.thresholds.cls"),
    },
    minimumSampleCounts: {
      cold: requirePositiveInteger(minimumSampleCounts.cold, "performanceBudget.minimumSampleCounts.cold"),
      warm: requirePositiveInteger(minimumSampleCounts.warm, "performanceBudget.minimumSampleCounts.warm"),
    },
  };
}

function validatePerformanceAgainstBudget(performance, budget, outcome) {
  const aggregates = [
    ["cold", performance.cold, budget.minimumSampleCounts.cold],
    ["warm", performance.warm, budget.minimumSampleCounts.warm],
  ];
  for (const [label, aggregate, minimumSampleCount] of aggregates) {
    if (aggregate.sampleCount < minimumSampleCount) {
      fail(`performance.${label}.sampleCount must meet performanceBudget.minimumSampleCounts.${label}`);
    }
  }

  // A failed or blocked card may deliberately preserve the over-budget values
  // that explain its outcome. A passed card cannot merely carry a budget; its
  // recorded cold and warm aggregates must comply with it.
  if (outcome !== "passed") return;
  for (const [label, aggregate] of aggregates) {
    for (const [metric, threshold] of Object.entries(budget.thresholds)) {
      const aggregateMetric = aggregate[metric];
      if (aggregateMetric > threshold) {
        fail(`a passed outcome requires performance.${label}.${metric} to meet performanceBudget.thresholds.${metric}`);
      }
    }
  }
}

function validateLimitations(value) {
  const limitations = requireObject(value, "limitations");
  if (limitations.structuralValidationOnly !== true
    || limitations.browserRuntimeEvidenceVerified !== false
    || limitations.custodyEvidenceVerified !== false
    || limitations.authorizationEvidenceVerified !== false) {
    fail("limitations must explicitly state structural-only validation and false runtime, custody, and authorization verification");
  }
  return limitations;
}

function validateExpectedBindings(expected, candidate, webArtifact) {
  if (expected === undefined) return;
  const bindings = requireObject(expected, "expected bindings");
  const allowed = new Set(["candidateRepository", "candidateSha", "candidateSourceTreeSha256", "webArtifactSha256"]);
  for (const key of Object.keys(bindings)) {
    if (!allowed.has(key)) fail(`expected bindings does not allow ${key}`);
  }
  if (bindings.candidateRepository !== undefined
    && requireRepository(bindings.candidateRepository, "expected bindings.candidateRepository") !== candidate.repository) {
    fail("candidate.repository does not match the explicit expected binding");
  }
  if (bindings.candidateSha !== undefined && requireSha(bindings.candidateSha, "expected bindings.candidateSha") !== candidate.sha) {
    fail("candidate.sha does not match the explicit expected binding");
  }
  if (bindings.candidateSourceTreeSha256 !== undefined
    && requireSha256(bindings.candidateSourceTreeSha256, "expected bindings.candidateSourceTreeSha256") !== candidate.sourceTreeSha256) {
    fail("candidate.sourceTreeSha256 does not match the explicit expected binding");
  }
  if (bindings.webArtifactSha256 !== undefined
    && requireSha256(bindings.webArtifactSha256, "expected bindings.webArtifactSha256") !== webArtifact.sha256) {
    fail("webArtifact.sha256 does not match the explicit expected binding");
  }
}

/**
 * Validate the JSON structure only. The returned summary intentionally carries
 * a limitation marker instead of an evidence approval or release decision.
 */
export function validateBrowserEvidenceCard(card, expectedBindings = undefined) {
  const value = requireObject(card, "browser evidence card");
  if (value.schemaVersion !== SCHEMA_VERSION) fail(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (value.kind !== CARD_KIND) fail(`kind must be ${CARD_KIND}`);
  if (!OUTCOMES.has(value.outcome)) fail("outcome must be passed, failed, or blocked");
  const outcome = value.outcome;

  const cardReference = requireReference(value.cardReference, "cardReference");
  const evidenceReference = requireReference(value.evidenceReference, "evidenceReference");
  if (cardReference === evidenceReference) fail("cardReference and evidenceReference must be distinct canonical references");

  const candidate = validateCandidate(value.candidate);
  const webArtifact = validateWebArtifact(value.webArtifact);
  const issuer = requireActor(value.issuer, "issuer");
  const reviewer = requireActor(value.reviewer, "reviewer");
  if (issuer.id === reviewer.id) fail("issuer.id and reviewer.id must be distinct");
  const lifecycle = validateLifecycle(value.lifecycle);
  const cleanup = validateCleanup(value.cleanup, outcome, lifecycle);
  const failureState = validateFailureState(value.failureState, outcome);
  const routeViewportResultCount = validateRouteViewportResults(value.routeViewportResults, outcome);
  const axe = validateAxe(value.axe, outcome);
  const performance = validatePerformance(value.performance);

  let performanceBudget;
  if (value.performanceBudget === undefined || value.performanceBudget === null) {
    if (outcome !== "blocked" || failureState.reasonCode !== "performance-budget-unapproved") {
      fail("a missing performanceBudget permits only a blocked outcome with reasonCode performance-budget-unapproved");
    }
  } else {
    performanceBudget = validatePerformanceBudget(value.performanceBudget);
  }
  if ((outcome === "passed" || outcome === "failed") && !performanceBudget) {
    fail(`a ${outcome} outcome requires a performanceBudget`);
  }
  if (performanceBudget) {
    validatePerformanceAgainstBudget(performance, performanceBudget, outcome);
  }

  validateLimitations(value.limitations);
  validateExpectedBindings(expectedBindings, candidate, webArtifact);

  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    kind: CARD_KIND,
    outcome,
    cardReference,
    evidenceReference,
    candidate: Object.freeze(candidate),
    webArtifact: Object.freeze(webArtifact),
    issuer: Object.freeze(issuer),
    reviewer: Object.freeze(reviewer),
    lifecycle: Object.freeze({
      startedAt: lifecycle.startedAt,
      finishedAt: lifecycle.finishedAt,
      recordedAt: lifecycle.recordedAt,
    }),
    cleanup: Object.freeze(cleanup),
    failureState: Object.freeze(failureState),
    routeViewportResultCount,
    axe: Object.freeze(axe),
    performance: Object.freeze(performance),
    performanceBudget: performanceBudget ? Object.freeze(performanceBudget) : null,
    structuralValidationOnly: true,
    disclaimer: STRUCTURAL_VALIDATION_DISCLAIMER,
  });
}

/**
 * Read an external, regular, non-symlink JSON card. Candidate-repository paths
 * are explicitly rejected so this read-only verifier cannot treat repository
 * output as independently captured evidence.
 */
export function assertExternalRegularJsonFile(path, repositoryRoot = REPOSITORY_ROOT) {
  if (!isAbsolute(path)) fail("card path must be an absolute external path");
  const requested = resolve(path);
  let root;
  try {
    root = realpathSync(repositoryRoot);
  } catch (error) {
    fail(`repository root is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (pathInside(root, requested)) fail("card path must be outside the candidate repository");
  if (!existsSync(requested)) fail(`card path does not exist: ${requested}`);
  let metadata;
  try {
    metadata = lstatSync(requested);
  } catch (error) {
    fail(`card path cannot be inspected: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (metadata.isSymbolicLink()) fail("card path must not be a symbolic link");
  if (!metadata.isFile()) fail("card path must be a regular file");
  if (!requested.endsWith(".json")) fail("card path must have a .json filename");
  let canonical;
  try {
    canonical = realpathSync(requested);
  } catch (error) {
    fail(`card path cannot be resolved: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (pathInside(root, canonical)) fail("card path resolves inside the candidate repository");
  return canonical;
}

export function readAndValidateBrowserEvidenceCard(path, options = {}) {
  const canonicalPath = assertExternalRegularJsonFile(path, options.repositoryRoot);
  let card;
  try {
    card = JSON.parse(readFileSync(canonicalPath, "utf8"));
  } catch (error) {
    fail(`card must be readable JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return Object.freeze({ path: canonicalPath, ...validateBrowserEvidenceCard(card, options.expectedBindings) });
}

function usage() {
  return [
    "Usage:",
    "  node scripts/g2-browser-evidence-card-contract.mjs validate --card <absolute-external-card.json> [expected bindings]",
    "",
    "Expected binding options (all are required for a passed card):",
    "  --expected-candidate-repository <repository>",
    "  --expected-candidate-sha <40-hex-sha>",
    "  --expected-candidate-source-tree-sha256 <64-hex-sha256>",
    "  --expected-web-artifact-sha256 <64-hex-sha256>",
    "",
    STRUCTURAL_VALIDATION_DISCLAIMER,
    "",
  ].join("\n");
}

export function parseOptions(argv) {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) return { help: true };
  if (argv[0] !== "validate") fail("the only supported command is validate");
  const optionNames = new Map([
    ["--card", "card"],
    ["--expected-candidate-repository", "candidateRepository"],
    ["--expected-candidate-sha", "candidateSha"],
    ["--expected-candidate-source-tree-sha256", "candidateSourceTreeSha256"],
    ["--expected-web-artifact-sha256", "webArtifactSha256"],
  ]);
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    const key = optionNames.get(flag);
    if (!key) fail(`unsupported option: ${flag}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) fail(`${flag} requires a value`);
    if (Object.hasOwn(options, key)) fail(`${flag} may be supplied only once`);
    options[key] = value;
  }
  if (!options.card) fail("--card is required");
  const { card, ...expectedBindings } = options;
  return { card, expectedBindings };
}

function assertPassedCliBindings(outcome, expectedBindings) {
  if (outcome !== "passed") return;
  const missing = REQUIRED_PASSED_CLI_BINDINGS.filter(
    (binding) => expectedBindings[binding] === undefined,
  );
  if (missing.length) {
    const flags = missing.map((binding) => {
      if (binding === "candidateRepository") return "--expected-candidate-repository";
      if (binding === "candidateSha") return "--expected-candidate-sha";
      if (binding === "candidateSourceTreeSha256") return "--expected-candidate-source-tree-sha256";
      return "--expected-web-artifact-sha256";
    });
    fail(`a passed card requires explicit CLI bindings: ${flags.join(", ")}`);
  }
}

/**
 * CLI adapter with injectable streams for local tests. It only reads the card;
 * its only output is a human-readable structural-validation result.
 */
export function runCli(argv, streams = {}) {
  const stdout = streams.stdout || process.stdout;
  const stderr = streams.stderr || process.stderr;
  try {
    const options = parseOptions(argv);
    if (options.help) {
      stdout.write(usage());
      return 0;
    }
    const result = readAndValidateBrowserEvidenceCard(options.card, { expectedBindings: options.expectedBindings });
    assertPassedCliBindings(result.outcome, options.expectedBindings);
    stdout.write(`${STRUCTURAL_VALIDATION_DISCLAIMER}\n`);
    stdout.write(`Valid structural G2 browser evidence card: ${result.cardReference} (${result.outcome})\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runCli(process.argv.slice(2));
}
