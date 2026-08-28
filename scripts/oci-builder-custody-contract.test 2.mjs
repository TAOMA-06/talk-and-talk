import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  OCI_BUILDER_CUSTODY_RECEIPT_KIND,
  OCI_BUILDER_CUSTODY_SCHEMA_VERSION,
  OCI_CANDIDATE_LABELS,
  calculateCanonicalBodySha256,
  canonicalReceiptBody,
  runOciBuilderCustodyCli,
  validateExternalOciBuilderCustodyReceipt,
  validateOciBuilderCustodyReceipt,
} from "./oci-builder-custody-contract.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dockerfilePath = join(repositoryRoot, "backend", "api", "Dockerfile");
const candidateEvidenceTemplatePath = join(
  repositoryRoot,
  "docs",
  "cto-self-audit",
  "runs",
  "2026-08-08-g1-remediation",
  "candidate-evidence-template.md",
);
const g2ExecutionPackagePath = join(
  repositoryRoot,
  "docs",
  "cto-self-audit",
  "runs",
  "2026-08-08-g1-remediation",
  "g2-execution-package.md",
);
const externalControlPlaneOciContractPath = join(
  repositoryRoot,
  "docs",
  "cto-self-audit",
  "runs",
  "2026-08-08-g1-remediation",
  "external-control-plane-oci-custody-contract.md",
);
const sha = (character) => character.repeat(64);
const gitSha = (character) => character.repeat(40);
const REQUIRED_PASSED_CLI_FLAGS = Object.freeze([
  "--expected-candidate-repository",
  "--expected-candidate-sha",
  "--expected-candidate-source-tree-sha256",
  "--expected-build-context-tree-sha256",
  "--expected-dockerfile-sha256",
  "--expected-artifact-provenance-sha256",
  "--expected-image-manifest-digest",
]);

function sign(receipt) {
  receipt.canonicalBodySha256 = calculateCanonicalBodySha256(receipt);
  return receipt;
}

function validReceipt() {
  const candidateSha = gitSha("a");
  const candidateTree = sha("b");
  const harnessSha = sha("c");
  const provenanceSha = sha("d");
  const manifestDigest = `sha256:${sha("e")}`;
  const imageRepository = "registry.example.test/talk-and-talk/api";
  return sign({
    schemaVersion: OCI_BUILDER_CUSTODY_SCHEMA_VERSION,
    kind: OCI_BUILDER_CUSTODY_RECEIPT_KIND,
    outcome: "passed",
    candidate: {
      repository: "github.com/talk-and-talk/talk-and-talk",
      sha: candidateSha,
      sourceTreeSha256: candidateTree,
    },
    buildContext: {
      treeSha256: sha("f"),
      dockerfile: {
        path: "backend/api/Dockerfile",
        sha256: sha("0"),
      },
    },
    controlPlane: {
      repository: "github.com/talk-and-talk/release-control",
      protectedImmutableRef: "refs/tags/oci-custody-v1.0.0",
      commitSha: gitSha("1"),
      harness: {
        version: "v1.0.0",
        sha256: harnessSha,
      },
      provenanceSha256: provenanceSha,
    },
    authorization: {
      evidenceReference: "E1-OCI-BUILDER-20260810",
      approvalReference: "APPROVAL-OCI-BUILDER-20260810",
      register: {
        reference: "register://release/candidates/oci-builder-v1",
        sha256: sha("2"),
      },
    },
    builder: {
      executorImage: `registry.example.test/release-control/oci-builder@sha256:${sha("3")}`,
      harnessSha256: harnessSha,
      isolationAttestationReference: "attestation://isolation/runs/oci-builder-v1",
    },
    image: {
      repository: imageRepository,
      manifestDigest,
      platforms: ["linux/amd64", "linux/arm64"],
      labels: {
        [OCI_CANDIDATE_LABELS.candidateRevision]: candidateSha,
        [OCI_CANDIDATE_LABELS.sourceTreeSha256]: candidateTree,
        [OCI_CANDIDATE_LABELS.artifactProvenanceSha256]: provenanceSha,
        [OCI_CANDIDATE_LABELS.provenanceKind]: "approved-candidate",
      },
    },
    custody: {
      immutableRegistryReference: `${imageRepository}@${manifestDigest}`,
      retentionReference: "retention://oci/talk-and-talk/api/policy-v1",
      signatureOrAttestationDigest: `sha256:${sha("4")}`,
    },
    timestamps: {
      startedAt: "2026-08-10T04:00:00.000Z",
      finishedAt: "2026-08-10T04:01:00.000Z",
      recordedAt: "2026-08-10T04:02:00.000Z",
    },
    issuer: {
      id: "release-control",
      evidenceReference: "E1-OCI-CUSTODY-ISSUED-20260810",
    },
    reviewer: {
      id: "release-security-reviewer",
      evidenceReference: "E1-OCI-CUSTODY-REVIEW-20260810",
    },
    canonicalBodySha256: "",
  });
}

function expectedBindings(receipt) {
  return {
    candidateRepository: receipt.candidate.repository,
    candidateSha: receipt.candidate.sha,
    candidateSourceTreeSha256: receipt.candidate.sourceTreeSha256,
    buildContextTreeSha256: receipt.buildContext.treeSha256,
    dockerfileSha256: receipt.buildContext.dockerfile.sha256,
    artifactProvenanceSha256: receipt.controlPlane.provenanceSha256,
    imageManifestDigest: receipt.image.manifestDigest,
  };
}

function cliArguments(receiptPath, bindings) {
  return [
    "--receipt", receiptPath,
    "--expected-candidate-repository", bindings.candidateRepository,
    "--expected-candidate-sha", bindings.candidateSha,
    "--expected-candidate-source-tree-sha256", bindings.candidateSourceTreeSha256,
    "--expected-build-context-tree-sha256", bindings.buildContextTreeSha256,
    "--expected-dockerfile-sha256", bindings.dockerfileSha256,
    "--expected-artifact-provenance-sha256", bindings.artifactProvenanceSha256,
    "--expected-image-manifest-digest", bindings.imageManifestDigest,
  ];
}

function assertRejected(mutator, pattern) {
  const receipt = validReceipt();
  mutator(receipt);
  sign(receipt);
  assert.throws(() => validateOciBuilderCustodyReceipt(receipt), pattern);
}

test("valid passed receipt has deterministic self-hash and explicit OCI crossbindings", () => {
  const receipt = validReceipt();
  assert.equal(validateOciBuilderCustodyReceipt(receipt), receipt);
  assert.equal("canonicalBodySha256" in canonicalReceiptBody(receipt), false);
  assert.equal(receipt.canonicalBodySha256, calculateCanonicalBodySha256(receipt));
});

test("independent expected bindings reject a different but internally self-consistent candidate or artifact", () => {
  const receipt = validReceipt();
  const bindings = expectedBindings(receipt);
  assert.equal(validateOciBuilderCustodyReceipt(receipt, bindings), receipt);

  const alternateCandidate = validReceipt();
  alternateCandidate.candidate.sha = gitSha("9");
  alternateCandidate.image.labels[OCI_CANDIDATE_LABELS.candidateRevision] = alternateCandidate.candidate.sha;
  sign(alternateCandidate);
  assert.throws(
    () => validateOciBuilderCustodyReceipt(alternateCandidate, bindings),
    /candidate\.sha does not match the independent expected binding/,
  );

  const alternateBuildContext = validReceipt();
  alternateBuildContext.buildContext.treeSha256 = sha("8");
  sign(alternateBuildContext);
  assert.throws(
    () => validateOciBuilderCustodyReceipt(alternateBuildContext, bindings),
    /buildContext\.treeSha256 does not match the independent expected binding/,
  );

  for (const [binding, value, pattern] of [
    ["candidateRepository", "github.com/talk-and-talk/another-candidate", /candidate\.repository/],
    ["candidateSourceTreeSha256", sha("8"), /candidate\.sourceTreeSha256/],
    ["buildContextTreeSha256", sha("7"), /buildContext\.treeSha256/],
    ["dockerfileSha256", sha("7"), /buildContext\.dockerfile\.sha256/],
    ["artifactProvenanceSha256", sha("6"), /controlPlane\.provenanceSha256/],
    ["imageManifestDigest", `sha256:${sha("5")}`, /image\.manifestDigest/],
  ]) {
    assert.throws(
      () => validateOciBuilderCustodyReceipt(receipt, { ...bindings, [binding]: value }),
      pattern,
      `${binding} must bind an independently supplied frozen fact`,
    );
  }
});

test("valid denied receipt retains an audited reason but cannot claim custody", () => {
  const receipt = validReceipt();
  receipt.outcome = "denied";
  delete receipt.custody;
  receipt.denialReason = "custody-signature-verification-denied";
  sign(receipt);
  assert.equal(validateOciBuilderCustodyReceipt(receipt), receipt);
});

test("rejects floating builder images, same control repository, and Dockerfile escapes", () => {
  assertRejected((receipt) => {
    receipt.builder.executorImage = "registry.example.test/release-control/oci-builder:latest";
  }, /digest-pinned OCI image/);
  assertRejected((receipt) => {
    receipt.controlPlane.repository = receipt.candidate.repository;
  }, /independent from candidate\.repository/);
  assertRejected((receipt) => {
    receipt.buildContext.dockerfile.path = "../Dockerfile";
  }, /nonescaping relative POSIX path/);
  assertRejected((receipt) => {
    receipt.buildContext.dockerfile.path = "backend/../api/Dockerfile";
  }, /nonescaping relative POSIX path/);
});

test("rejects every OCI label mismatch", () => {
  assertRejected((receipt) => {
    receipt.image.labels[OCI_CANDIDATE_LABELS.candidateRevision] = gitSha("9");
  }, /candidate\.sha/);
  assertRejected((receipt) => {
    receipt.image.labels[OCI_CANDIDATE_LABELS.sourceTreeSha256] = sha("8");
  }, /candidate\.sourceTreeSha256/);
  assertRejected((receipt) => {
    receipt.image.labels[OCI_CANDIDATE_LABELS.artifactProvenanceSha256] = sha("7");
  }, /controlPlane\.provenanceSha256/);
  assertRejected((receipt) => {
    receipt.image.labels[OCI_CANDIDATE_LABELS.provenanceKind] = "unverified";
  }, /approved-candidate/);
});

test("keeps the receipt label schema aligned with the repository Dockerfile and rejects self-review", () => {
  const dockerfile = readFileSync(dockerfilePath, "utf8");
  for (const label of Object.values(OCI_CANDIDATE_LABELS)) {
    assert.match(dockerfile, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assertRejected((receipt) => {
    receipt.reviewer.id = receipt.issuer.id;
  }, /must be distinct/);
  assertRejected((receipt) => {
    delete receipt.issuer;
  }, /issuer/);
});

test("rejects missing isolation, retention, signature, and passed custody", () => {
  assertRejected((receipt) => {
    delete receipt.builder.isolationAttestationReference;
  }, /isolationAttestationReference/);
  assertRejected((receipt) => {
    delete receipt.custody.retentionReference;
  }, /retentionReference/);
  assertRejected((receipt) => {
    delete receipt.custody.signatureOrAttestationDigest;
  }, /signatureOrAttestationDigest/);
  assertRejected((receipt) => {
    delete receipt.custody;
  }, /passed receipt must include custody/);
});

test("rejects denied custody claims, missing denial reasons, and invalid body hashes", () => {
  assertRejected((receipt) => {
    receipt.outcome = "denied";
    receipt.denialReason = "registry-policy-denied";
  }, /denied receipt must not claim custody/);
  assertRejected((receipt) => {
    receipt.outcome = "denied";
    delete receipt.custody;
  }, /denialReason/);
  const receipt = validReceipt();
  receipt.canonicalBodySha256 = sha("9");
  assert.throws(() => validateOciBuilderCustodyReceipt(receipt), /does not match the canonical receipt body/);
});

test("external receipt boundary rejects relative, repository, symlink, and nonregular inputs without mutation", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "talkandtalk-oci-custody-contract-"));
  const externalReceiptPath = join(temporaryDirectory, "receipt.json");
  const symlinkPath = join(temporaryDirectory, "receipt-link.json");
  const nonRegularPath = join(temporaryDirectory, "not-a-file.json");
  try {
    writeFileSync(externalReceiptPath, `${JSON.stringify(validReceipt(), null, 2)}\n`, "utf8");
    const before = readFileSync(externalReceiptPath, "utf8");
    const receipt = JSON.parse(before);
    const bindings = expectedBindings(receipt);
    const captured = [];
    const result = runOciBuilderCustodyCli(cliArguments(externalReceiptPath, bindings), {
      repositoryRoot,
      stdout: { write(value) { captured.push(String(value)); } },
    });
    assert.equal(result.receipt.kind, OCI_BUILDER_CUSTODY_RECEIPT_KIND);
    assert.equal(readFileSync(externalReceiptPath, "utf8"), before, "validation must not mutate the external receipt");
    assert.match(captured.join(""), /STRUCTURAL-ONLY/);
    assert.match(captured.join(""), /does not prove a build, OCI custody/);

    for (const missingBinding of Object.keys(bindings)) {
      const argumentsWithMissingBinding = cliArguments(externalReceiptPath, bindings);
      const flag = `--expected-${missingBinding.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)}`;
      const index = argumentsWithMissingBinding.indexOf(flag);
      argumentsWithMissingBinding.splice(index, 2);
      assert.throws(
        () => runOciBuilderCustodyCli(argumentsWithMissingBinding, { repositoryRoot, stdout: { write() {} } }),
        /a passed receipt requires explicit CLI bindings/,
      );
    }

    const alternateCandidate = validReceipt();
    alternateCandidate.candidate.sha = gitSha("9");
    alternateCandidate.image.labels[OCI_CANDIDATE_LABELS.candidateRevision] = alternateCandidate.candidate.sha;
    sign(alternateCandidate);
    const alternatePath = join(temporaryDirectory, "other-candidate.json");
    writeFileSync(alternatePath, `${JSON.stringify(alternateCandidate, null, 2)}\n`, "utf8");
    assert.throws(
      () => runOciBuilderCustodyCli(cliArguments(alternatePath, bindings), { repositoryRoot, stdout: { write() {} } }),
      /candidate\.sha does not match the independent expected binding/,
    );

    assert.throws(
      () => validateExternalOciBuilderCustodyReceipt("receipt.json", { repositoryRoot }),
      /absolute path/,
    );
    assert.throws(
      () => validateExternalOciBuilderCustodyReceipt(join(repositoryRoot, "package.json"), { repositoryRoot }),
      /outside the repository/,
    );
    symlinkSync(externalReceiptPath, symlinkPath);
    assert.throws(
      () => validateExternalOciBuilderCustodyReceipt(symlinkPath, { repositoryRoot }),
      /must not be a symbolic link/,
    );
    assert.throws(
      () => {
        mkdirSync(nonRegularPath);
        return validateExternalOciBuilderCustodyReceipt(nonRegularPath, { repositoryRoot });
      },
      /must be a regular file/,
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("validator remains pure static code with no process, network, or Docker executor import", () => {
  const source = readFileSync(new URL("./oci-builder-custody-contract.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /node:(?:child_process|http|https|net|tls|dgram)/);
  assert.doesNotMatch(source, /\b(?:spawn|execFile|execSync|fetch)\b/);
  assert.doesNotMatch(source, /\bdocker\s+(?:build|run|login|push)\b/i);
});

test("every OCI execution reference includes all independently supplied passed-receipt bindings", () => {
  for (const referencePath of [
    candidateEvidenceTemplatePath,
    g2ExecutionPackagePath,
    externalControlPlaneOciContractPath,
  ]) {
    const command = readFileSync(referencePath, "utf8")
      .split(/\r?\n/)
      .find((line) => line.includes("node scripts/oci-builder-custody-contract.mjs --receipt"));
    assert.ok(command, `${referencePath} must include an OCI receipt validation command`);
    for (const flag of REQUIRED_PASSED_CLI_FLAGS) {
      assert.ok(command.includes(flag), `${referencePath} OCI command must include ${flag}`);
    }
  }
});
