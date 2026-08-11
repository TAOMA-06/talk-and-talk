#!/usr/bin/env node
/**
 * Pure structural validation for an externally issued OCI builder-custody
 * receipt. This module deliberately performs no build, registry, network,
 * Docker, credential, or child-process action. A successful validation only
 * means that an external JSON record has the required shape and self-hash.
 */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const OCI_BUILDER_CUSTODY_SCHEMA_VERSION = 1;
export const OCI_BUILDER_CUSTODY_RECEIPT_KIND = "talk-and-talk-oci-builder-custody-receipt";
// These names deliberately mirror backend/api/Dockerfile. The receipt cannot
// treat an invented candidate-label namespace as equivalent provenance.
export const OCI_CANDIDATE_LABELS = Object.freeze({
  candidateRevision: "org.opencontainers.image.revision",
  sourceTreeSha256: "io.talkandtalk.source-tree-sha256",
  artifactProvenanceSha256: "io.talkandtalk.artifact-provenance-sha256",
  provenanceKind: "io.talkandtalk.provenance-kind",
});

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHA1_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const REPOSITORY_PATTERN = /^[a-z0-9][a-z0-9.-]*(?::[0-9]+)?\/[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
const OCI_REPOSITORY_PATTERN = /^[a-z0-9][a-z0-9.-]*(?::[0-9]+)?\/[a-z0-9][a-z0-9._/-]*$/;
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@#-]{2,255}$/;
const REVIEWER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PLATFORM_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?$/;
const PROTECTED_TAG_REF_PATTERN = /^refs\/tags\/[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const REQUIRED_PASSED_CLI_BINDINGS = Object.freeze([
  "candidateRepository",
  "candidateSha",
  "candidateSourceTreeSha256",
  "buildContextTreeSha256",
  "dockerfileSha256",
  "artifactProvenanceSha256",
  "imageManifestDigest",
]);

export class OciBuilderCustodyContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "OciBuilderCustodyContractError";
    this.code = "OCI_BUILDER_CUSTODY_CONTRACT_ERROR";
  }
}

function fail(message) {
  throw new OciBuilderCustodyContractError(message);
}

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertRecord(value, label) {
  if (!isRecord(value)) fail(`${label} must be a JSON object`);
  return value;
}

function assertExactKeys(value, label, requiredKeys) {
  assertRecord(value, label);
  const allowed = new Set(requiredKeys);
  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) fail(`${label} is missing required field: ${key}`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label} has an unexpected field: ${key}`);
  }
}

function assertString(value, label, pattern = null) {
  if (typeof value !== "string" || !value) fail(`${label} must be a non-empty string`);
  if (pattern && !pattern.test(value)) fail(`${label} has an invalid format`);
  return value;
}

function assertSha(value, label) {
  return assertString(value, label, SHA256_PATTERN);
}

function assertGitSha(value, label) {
  return assertString(value, label, SHA1_PATTERN);
}

function assertDigest(value, label) {
  return assertString(value, label, SHA256_DIGEST_PATTERN);
}

function assertReference(value, label) {
  return assertString(value, label, REFERENCE_PATTERN);
}

function assertCanonicalRepository(value, label) {
  return assertString(value, label, REPOSITORY_PATTERN);
}

function assertOciRepository(value, label) {
  return assertString(value, label, OCI_REPOSITORY_PATTERN);
}

function assertRelativeDockerfilePath(value) {
  if (typeof value !== "string" || !value || isAbsolute(value) || value.includes("\\")) {
    fail("buildContext.dockerfile.path must be a nonescaping relative POSIX path");
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    fail("buildContext.dockerfile.path must be a nonescaping relative POSIX path");
  }
  return value;
}

function assertDigestPinnedExecutorImage(value) {
  const match = typeof value === "string"
    ? /^(.+)@sha256:([0-9a-f]{64})$/.exec(value)
    : null;
  if (!match) fail("builder.executorImage must be an immutable digest-pinned OCI image");
  assertOciRepository(match[1], "builder.executorImage repository");
  return value;
}

function assertUtcTimestamp(value, label) {
  assertString(value, label, UTC_TIMESTAMP_PATTERN);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail(`${label} must be a valid UTC timestamp with millisecond precision`);
  }
  return parsed;
}

function pathInside(parent, child) {
  const relation = relative(parent, child);
  return relation === "" || (relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation));
}

/** Deterministic JSON rendering used for the body checksum. */
export function stableJson(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("Canonical receipt JSON cannot include a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  fail("Canonical receipt JSON contains an unsupported value");
}

/** Returns the receipt body without the self-referential checksum field. */
export function canonicalReceiptBody(receipt) {
  assertRecord(receipt, "OCI builder custody receipt");
  const { canonicalBodySha256: _selfHash, ...body } = receipt;
  return body;
}

/** Computes the checksum over deterministic JSON excluding canonicalBodySha256. */
export function calculateCanonicalBodySha256(receipt) {
  return createHash("sha256").update(stableJson(canonicalReceiptBody(receipt)), "utf8").digest("hex");
}

function validateCandidate(candidate) {
  assertExactKeys(candidate, "candidate", ["repository", "sha", "sourceTreeSha256"]);
  assertCanonicalRepository(candidate.repository, "candidate.repository");
  assertGitSha(candidate.sha, "candidate.sha");
  assertSha(candidate.sourceTreeSha256, "candidate.sourceTreeSha256");
}

function validateBuildContext(buildContext) {
  assertExactKeys(buildContext, "buildContext", ["treeSha256", "dockerfile"]);
  assertSha(buildContext.treeSha256, "buildContext.treeSha256");
  assertExactKeys(buildContext.dockerfile, "buildContext.dockerfile", ["path", "sha256"]);
  assertRelativeDockerfilePath(buildContext.dockerfile.path);
  assertSha(buildContext.dockerfile.sha256, "buildContext.dockerfile.sha256");
}

function validateControlPlane(controlPlane, candidate) {
  assertExactKeys(controlPlane, "controlPlane", [
    "repository",
    "protectedImmutableRef",
    "commitSha",
    "harness",
    "provenanceSha256",
  ]);
  const repository = assertCanonicalRepository(controlPlane.repository, "controlPlane.repository");
  if (repository.toLowerCase() === candidate.repository.toLowerCase()) {
    fail("controlPlane.repository must be independent from candidate.repository");
  }
  const protectedRef = assertString(
    controlPlane.protectedImmutableRef,
    "controlPlane.protectedImmutableRef",
    PROTECTED_TAG_REF_PATTERN,
  );
  if (protectedRef.includes("//") || protectedRef.includes("..")) {
    fail("controlPlane.protectedImmutableRef must be a nonescaping immutable protected tag ref");
  }
  assertGitSha(controlPlane.commitSha, "controlPlane.commitSha");
  assertExactKeys(controlPlane.harness, "controlPlane.harness", ["version", "sha256"]);
  assertString(controlPlane.harness.version, "controlPlane.harness.version", VERSION_PATTERN);
  assertSha(controlPlane.harness.sha256, "controlPlane.harness.sha256");
  assertSha(controlPlane.provenanceSha256, "controlPlane.provenanceSha256");
}

function validateAuthorization(authorization) {
  assertExactKeys(authorization, "authorization", ["evidenceReference", "approvalReference", "register"]);
  assertReference(authorization.evidenceReference, "authorization.evidenceReference");
  assertReference(authorization.approvalReference, "authorization.approvalReference");
  assertExactKeys(authorization.register, "authorization.register", ["reference", "sha256"]);
  assertReference(authorization.register.reference, "authorization.register.reference");
  assertSha(authorization.register.sha256, "authorization.register.sha256");
}

function validateBuilder(builder, controlPlane) {
  assertExactKeys(builder, "builder", ["executorImage", "harnessSha256", "isolationAttestationReference"]);
  assertDigestPinnedExecutorImage(builder.executorImage);
  assertSha(builder.harnessSha256, "builder.harnessSha256");
  if (builder.harnessSha256 !== controlPlane.harness.sha256) {
    fail("builder.harnessSha256 must match controlPlane.harness.sha256");
  }
  assertReference(builder.isolationAttestationReference, "builder.isolationAttestationReference");
}

function validateImage(image, candidate, controlPlane) {
  assertExactKeys(image, "image", ["repository", "manifestDigest", "platforms", "labels"]);
  assertOciRepository(image.repository, "image.repository");
  assertDigest(image.manifestDigest, "image.manifestDigest");
  if (!Array.isArray(image.platforms) || image.platforms.length === 0) {
    fail("image.platforms must be a non-empty array");
  }
  const sortedPlatforms = [...image.platforms].sort((left, right) => String(left).localeCompare(String(right)));
  if (JSON.stringify(image.platforms) !== JSON.stringify(sortedPlatforms) || new Set(image.platforms).size !== image.platforms.length) {
    fail("image.platforms must be sorted and contain unique platforms");
  }
  for (const platform of image.platforms) assertString(platform, "image.platforms entry", PLATFORM_PATTERN);

  assertExactKeys(image.labels, "image.labels", Object.values(OCI_CANDIDATE_LABELS));
  if (image.labels[OCI_CANDIDATE_LABELS.candidateRevision] !== candidate.sha) {
    fail(`image.labels.${OCI_CANDIDATE_LABELS.candidateRevision} must match candidate.sha`);
  }
  if (image.labels[OCI_CANDIDATE_LABELS.sourceTreeSha256] !== candidate.sourceTreeSha256) {
    fail(`image.labels.${OCI_CANDIDATE_LABELS.sourceTreeSha256} must match candidate.sourceTreeSha256`);
  }
  if (image.labels[OCI_CANDIDATE_LABELS.artifactProvenanceSha256] !== controlPlane.provenanceSha256) {
    fail(`image.labels.${OCI_CANDIDATE_LABELS.artifactProvenanceSha256} must match controlPlane.provenanceSha256`);
  }
  if (image.labels[OCI_CANDIDATE_LABELS.provenanceKind] !== "approved-candidate") {
    fail(`image.labels.${OCI_CANDIDATE_LABELS.provenanceKind} must equal approved-candidate`);
  }
}

function validateCustody(custody, image) {
  assertExactKeys(custody, "custody", [
    "immutableRegistryReference",
    "retentionReference",
    "signatureOrAttestationDigest",
  ]);
  const expectedReference = `${image.repository}@${image.manifestDigest}`;
  if (custody.immutableRegistryReference !== expectedReference) {
    fail("custody.immutableRegistryReference must bind image.repository and image.manifestDigest");
  }
  assertReference(custody.retentionReference, "custody.retentionReference");
  assertDigest(custody.signatureOrAttestationDigest, "custody.signatureOrAttestationDigest");
}

function validateTimestamps(timestamps) {
  assertExactKeys(timestamps, "timestamps", ["startedAt", "finishedAt", "recordedAt"]);
  const startedAt = assertUtcTimestamp(timestamps.startedAt, "timestamps.startedAt");
  const finishedAt = assertUtcTimestamp(timestamps.finishedAt, "timestamps.finishedAt");
  const recordedAt = assertUtcTimestamp(timestamps.recordedAt, "timestamps.recordedAt");
  if (finishedAt < startedAt || recordedAt < finishedAt) {
    fail("timestamps must satisfy startedAt <= finishedAt <= recordedAt");
  }
}

function validateReviewActor(actor, label) {
  assertExactKeys(actor, label, ["id", "evidenceReference"]);
  assertString(actor.id, `${label}.id`, REVIEWER_PATTERN);
  assertReference(actor.evidenceReference, `${label}.evidenceReference`);
}

function validateExpectedBindings(expectedBindings, receipt) {
  if (expectedBindings === undefined) return;
  const bindings = assertRecord(expectedBindings, "expected bindings");
  const allowed = new Set([
    "candidateRepository",
    "candidateSha",
    "candidateSourceTreeSha256",
    "buildContextTreeSha256",
    "dockerfileSha256",
    "artifactProvenanceSha256",
    "imageManifestDigest",
  ]);
  for (const key of Object.keys(bindings)) {
    if (!allowed.has(key)) fail(`expected bindings does not allow ${key}`);
  }
  if (bindings.candidateRepository !== undefined
    && assertCanonicalRepository(bindings.candidateRepository, "expected bindings.candidateRepository") !== receipt.candidate.repository) {
    fail("candidate.repository does not match the independent expected binding");
  }
  if (bindings.candidateSha !== undefined
    && assertGitSha(bindings.candidateSha, "expected bindings.candidateSha") !== receipt.candidate.sha) {
    fail("candidate.sha does not match the independent expected binding");
  }
  if (bindings.candidateSourceTreeSha256 !== undefined
    && assertSha(bindings.candidateSourceTreeSha256, "expected bindings.candidateSourceTreeSha256") !== receipt.candidate.sourceTreeSha256) {
    fail("candidate.sourceTreeSha256 does not match the independent expected binding");
  }
  if (bindings.buildContextTreeSha256 !== undefined
    && assertSha(bindings.buildContextTreeSha256, "expected bindings.buildContextTreeSha256") !== receipt.buildContext.treeSha256) {
    fail("buildContext.treeSha256 does not match the independent expected binding");
  }
  if (bindings.dockerfileSha256 !== undefined
    && assertSha(bindings.dockerfileSha256, "expected bindings.dockerfileSha256") !== receipt.buildContext.dockerfile.sha256) {
    fail("buildContext.dockerfile.sha256 does not match the independent expected binding");
  }
  if (bindings.artifactProvenanceSha256 !== undefined
    && assertSha(bindings.artifactProvenanceSha256, "expected bindings.artifactProvenanceSha256") !== receipt.controlPlane.provenanceSha256) {
    fail("controlPlane.provenanceSha256 does not match the independent expected binding");
  }
  if (bindings.imageManifestDigest !== undefined
    && assertDigest(bindings.imageManifestDigest, "expected bindings.imageManifestDigest") !== receipt.image.manifestDigest) {
    fail("image.manifestDigest does not match the independent expected binding");
  }
}

/**
 * Validates an already-loaded receipt. It is intentionally structural-only:
 * it cannot establish that any recorded reference, image, signature, or
 * attestation exists outside this JSON document.
 */
export function validateOciBuilderCustodyReceipt(receipt, expectedBindings = undefined) {
  assertRecord(receipt, "OCI builder custody receipt");
  if (receipt.schemaVersion !== OCI_BUILDER_CUSTODY_SCHEMA_VERSION) {
    fail(`schemaVersion must equal ${OCI_BUILDER_CUSTODY_SCHEMA_VERSION}`);
  }
  if (receipt.kind !== OCI_BUILDER_CUSTODY_RECEIPT_KIND) {
    fail(`kind must equal ${OCI_BUILDER_CUSTODY_RECEIPT_KIND}`);
  }
  if (receipt.outcome !== "passed" && receipt.outcome !== "denied") {
    fail("outcome must be passed or denied");
  }

  if (receipt.outcome === "passed" && !Object.hasOwn(receipt, "custody")) {
    fail("A passed receipt must include custody");
  }
  if (receipt.outcome === "denied" && Object.hasOwn(receipt, "custody")) {
    fail("A denied receipt must not claim custody");
  }
  assertExactKeys(
    receipt,
    "OCI builder custody receipt",
    receipt.outcome === "passed"
      ? [
        "schemaVersion",
        "kind",
        "outcome",
        "candidate",
        "buildContext",
        "controlPlane",
        "authorization",
        "builder",
        "image",
        "custody",
        "timestamps",
        "issuer",
        "reviewer",
        "canonicalBodySha256",
      ]
      : [
        "schemaVersion",
        "kind",
        "outcome",
        "candidate",
        "buildContext",
        "controlPlane",
        "authorization",
        "builder",
        "image",
        "denialReason",
        "timestamps",
        "issuer",
        "reviewer",
        "canonicalBodySha256",
      ],
  );

  validateCandidate(receipt.candidate);
  validateBuildContext(receipt.buildContext);
  validateControlPlane(receipt.controlPlane, receipt.candidate);
  validateAuthorization(receipt.authorization);
  validateBuilder(receipt.builder, receipt.controlPlane);
  validateImage(receipt.image, receipt.candidate, receipt.controlPlane);
  if (receipt.outcome === "passed") {
    validateCustody(receipt.custody, receipt.image);
  } else {
    assertString(receipt.denialReason, "denialReason", REFERENCE_PATTERN);
  }
  validateTimestamps(receipt.timestamps);
  validateReviewActor(receipt.issuer, "issuer");
  validateReviewActor(receipt.reviewer, "reviewer");
  if (receipt.issuer.id === receipt.reviewer.id) {
    fail("issuer.id and reviewer.id must be distinct for independent review");
  }
  assertSha(receipt.canonicalBodySha256, "canonicalBodySha256");
  const expectedHash = calculateCanonicalBodySha256(receipt);
  if (receipt.canonicalBodySha256 !== expectedHash) {
    fail("canonicalBodySha256 does not match the canonical receipt body");
  }
  validateExpectedBindings(expectedBindings, receipt);
  return receipt;
}

/**
 * Resolves an input receipt without following a final symlink and rejects any
 * lexical or canonical location inside the candidate repository.
 */
export function resolveExternalReceiptPath(requestedPath, options = {}) {
  const repositoryRoot = resolve(options.repositoryRoot || REPOSITORY_ROOT);
  if (typeof requestedPath !== "string" || !isAbsolute(requestedPath)) {
    fail("--receipt must be an absolute path");
  }
  const absolutePath = resolve(requestedPath);
  if (pathInside(repositoryRoot, absolutePath)) {
    fail("--receipt must be outside the repository");
  }
  if (extname(absolutePath) !== ".json") fail("--receipt must name a JSON file");
  let entry;
  try {
    entry = lstatSync(absolutePath);
  } catch (error) {
    fail(`--receipt is missing: ${absolutePath}`);
  }
  if (entry.isSymbolicLink()) fail("--receipt must not be a symbolic link");
  if (!entry.isFile()) fail("--receipt must be a regular file");

  let canonicalRepositoryRoot;
  let canonicalReceiptPath;
  try {
    canonicalRepositoryRoot = realpathSync(repositoryRoot);
    canonicalReceiptPath = realpathSync(absolutePath);
  } catch (error) {
    fail(`--receipt path cannot be resolved safely: ${absolutePath}`);
  }
  if (pathInside(canonicalRepositoryRoot, canonicalReceiptPath)) {
    fail("--receipt must be outside the repository");
  }
  return canonicalReceiptPath;
}

/** Reads one external JSON receipt and performs no file-system mutation. */
export function loadExternalOciBuilderCustodyReceipt(requestedPath, options = {}) {
  const path = resolveExternalReceiptPath(requestedPath, options);
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`Cannot read JSON receipt ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { path, receipt };
}

/** Reads and structurally validates one external OCI custody receipt. */
export function validateExternalOciBuilderCustodyReceipt(requestedPath, options = {}) {
  const loaded = loadExternalOciBuilderCustodyReceipt(requestedPath, options);
  validateOciBuilderCustodyReceipt(loaded.receipt, options.expectedBindings);
  return loaded;
}

function usage() {
  return [
    "Usage:",
    "",
    "  node scripts/oci-builder-custody-contract.mjs --receipt <absolute-external-json> [expected bindings]",
    "",
    "Expected binding options (all are required for a passed receipt):",
    "  --expected-candidate-repository <repository>",
    "  --expected-candidate-sha <40-hex-sha>",
    "  --expected-candidate-source-tree-sha256 <64-hex-sha256>",
    "  --expected-build-context-tree-sha256 <64-hex-sha256>",
    "  --expected-dockerfile-sha256 <64-hex-sha256>",
    "  --expected-artifact-provenance-sha256 <64-hex-sha256>",
    "  --expected-image-manifest-digest <sha256:64-hex-sha256>",
    "",
    "STRUCTURAL-ONLY: this checks JSON shape and the self-hash only. It does not prove a build, OCI custody, registry immutability, authorization, independent control-plane protection, signature validity, retention, or G1/G2 readiness.",
    "",
  ].join("\n");
}

export function parseOciBuilderCustodyCliArguments(argv) {
  if (!Array.isArray(argv)) fail("CLI arguments must be an array");
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) return { help: true };
  const optionNames = new Map([
    ["--receipt", "receiptPath"],
    ["--expected-candidate-repository", "candidateRepository"],
    ["--expected-candidate-sha", "candidateSha"],
    ["--expected-candidate-source-tree-sha256", "candidateSourceTreeSha256"],
    ["--expected-build-context-tree-sha256", "buildContextTreeSha256"],
    ["--expected-dockerfile-sha256", "dockerfileSha256"],
    ["--expected-artifact-provenance-sha256", "artifactProvenanceSha256"],
    ["--expected-image-manifest-digest", "imageManifestDigest"],
  ]);
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const key = optionNames.get(flag);
    if (!key) fail(`unsupported option: ${flag}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) fail(`${flag} requires a value`);
    if (Object.hasOwn(options, key)) fail(`${flag} may be supplied only once`);
    options[key] = value;
  }
  if (!options.receiptPath) fail("--receipt is required");
  const { receiptPath, ...expectedBindings } = options;
  return { receiptPath, expectedBindings };
}

function assertPassedCliBindings(outcome, expectedBindings) {
  if (outcome !== "passed") return;
  const missing = REQUIRED_PASSED_CLI_BINDINGS.filter((binding) => expectedBindings[binding] === undefined);
  if (!missing.length) return;
  const flags = missing.map((binding) => {
    if (binding === "candidateRepository") return "--expected-candidate-repository";
    if (binding === "candidateSha") return "--expected-candidate-sha";
    if (binding === "candidateSourceTreeSha256") return "--expected-candidate-source-tree-sha256";
    if (binding === "buildContextTreeSha256") return "--expected-build-context-tree-sha256";
    if (binding === "dockerfileSha256") return "--expected-dockerfile-sha256";
    if (binding === "artifactProvenanceSha256") return "--expected-artifact-provenance-sha256";
    return "--expected-image-manifest-digest";
  });
  fail(`a passed receipt requires explicit CLI bindings: ${flags.join(", ")}`);
}

/** Executes the read-only CLI with injectable streams for in-process tests. */
export function runOciBuilderCustodyCli(argv = process.argv.slice(2), options = {}) {
  const stdout = options.stdout || process.stdout;
  const parsed = parseOciBuilderCustodyCliArguments(argv);
  if (parsed.help) {
    stdout.write(usage());
    return { help: true };
  }
  const result = validateExternalOciBuilderCustodyReceipt(parsed.receiptPath, {
    ...options,
    expectedBindings: parsed.expectedBindings,
  });
  assertPassedCliBindings(result.receipt.outcome, parsed.expectedBindings);
  stdout.write(`OCI builder custody receipt structural validation passed: ${result.path}\n`);
  stdout.write("STRUCTURAL-ONLY: this does not prove a build, OCI custody, registry immutability, authorization, independent control-plane protection, signature validity, retention, or G1/G2 readiness.\n");
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runOciBuilderCustodyCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
