import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  SBOM_GENERATOR_NAME,
  SBOM_GENERATOR_VERSION,
  SBOM_SPEC_VERSION,
  buildCandidateSbom,
  candidateLockHashes,
  generateCandidateSbom,
  loadCandidateLocks,
  stableJson,
  validateGeneratedCandidateSbom,
} from "./generate-candidate-sbom.mjs";

const CANDIDATE_SHA = "a".repeat(40);
const TREE_SHA256 = "b".repeat(64);

function integrity(value) {
  return `sha512-${createHash("sha512").update(value).digest("base64")}`;
}

function registryUrl(name, version) {
  return `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`;
}

function fixtureLock(name, { bundled = false } = {}) {
  const version = "1.0.0";
  const packages = {
    "": {
      name,
      version,
      dependencies: { parent: version },
      devDependencies: { "dev-only": version },
      optionalDependencies: { "optional-runtime": version, "absent-optional": version },
      peerDependencies: { "peer-only": version },
    },
    "node_modules/parent": {
      version,
      resolved: registryUrl("parent", version),
      integrity: integrity(`${name}:parent`),
      dependencies: bundled ? { child: version } : {},
    },
    "node_modules/dev-only": {
      version,
      resolved: registryUrl("dev-only", version),
      integrity: integrity(`${name}:dev-only`),
      dev: true,
    },
    "node_modules/optional-runtime": {
      version,
      resolved: registryUrl("optional-runtime", version),
      integrity: integrity(`${name}:optional-runtime`),
      optional: true,
    },
    "node_modules/peer-only": {
      version,
      resolved: registryUrl("peer-only", version),
      integrity: integrity(`${name}:peer-only`),
      peer: true,
    },
  };
  if (bundled) {
    packages["node_modules/parent/node_modules/child"] = {
      version,
      inBundle: true,
    };
  }
  return { name, lockfileVersion: 3, requires: true, packages };
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createFixture() {
  const temp = mkdtempSync(join(tmpdir(), "talkandtalk-sbom-"));
  const root = join(temp, "candidate");
  const outputs = join(temp, "evidence");
  mkdirSync(root, { recursive: true });
  mkdirSync(outputs, { recursive: true });
  writeJson(join(root, "backend/api/package-lock.json"), fixtureLock("api-app", { bundled: true }));
  writeJson(join(root, "frontend/miniprogram/package-lock.json"), fixtureLock("mini-app"));
  writeJson(join(root, "frontend/web/package-lock.json"), fixtureLock("web-app"));
  return { temp, root, outputs };
}

function cleanup(path) {
  rmSync(path, { recursive: true, force: true });
}

test("lockfile-only generator is deterministic and binds every lock hash to the frozen candidate", () => {
  const fixture = createFixture();
  try {
    const firstPath = join(fixture.outputs, "first.json");
    const secondPath = join(fixture.outputs, "second.json");
    const first = generateCandidateSbom({
      root: fixture.root,
      candidateSha: CANDIDATE_SHA,
      sourceTreeSha256: TREE_SHA256,
      outputPath: firstPath,
    });
    generateCandidateSbom({
      root: fixture.root,
      candidateSha: CANDIDATE_SHA,
      sourceTreeSha256: TREE_SHA256,
      outputPath: secondPath,
    });
    assert.equal(readFileSync(firstPath, "utf8"), readFileSync(secondPath, "utf8"));
    assert.equal(first.document.bomFormat, "CycloneDX");
    assert.equal(first.document.specVersion, SBOM_SPEC_VERSION);
    assert.equal(first.document.serialNumber, undefined, "the deterministic SBOM avoids a non-standard serial number");
    assert.equal(first.document.metadata.tools.components[0].name, SBOM_GENERATOR_NAME);
    assert.equal(first.document.metadata.tools.components[0].version, SBOM_GENERATOR_VERSION);
    const properties = Object.fromEntries(first.document.metadata.component.properties.map((entry) => [entry.name, entry.value]));
    assert.equal(properties["talkandtalk:candidate.sha"], CANDIDATE_SHA);
    assert.equal(properties["talkandtalk:source.tree.sha256"], TREE_SHA256);
    for (const [id, hash] of Object.entries(candidateLockHashes(fixture.root))) {
      assert.equal(properties[`talkandtalk:lock.${id}.sha256`], hash);
    }
    const bundled = first.document.components.find((component) => component.name === "child");
    assert.ok(bundled);
    const bundledProperties = Object.fromEntries(bundled.properties.map((entry) => [entry.name, entry.value]));
    assert.equal(bundledProperties["talkandtalk:integrity.provenance"], "inherited-bundled-parent");
    assert.equal(bundledProperties["talkandtalk:integrity.source.path"], "node_modules/parent");
    assert.match(bundledProperties["talkandtalk:bundled.parent.archive.hashes"], /^SHA-512:/);
    assert.equal(bundled.hashes, undefined, "a parent archive digest must never be represented as a bundled child's component hash");
    assert.equal(first.document.components.find((component) => component.name === "dev-only")?.scope, "excluded");
    assert.equal(first.document.components.find((component) => component.name === "optional-runtime")?.scope, "optional");
    const apiRoot = first.document.dependencies.find((edge) => edge.ref.includes("application:api:"));
    assert.ok(apiRoot?.dependsOn.some((reference) => reference.includes("node_modules%2Fpeer-only")), "peer dependencies must remain explicit SBOM graph edges");
    assert.deepEqual(
      validateGeneratedCandidateSbom(first.document, {
        root: fixture.root,
        candidateSha: CANDIDATE_SHA,
        sourceTreeSha256: TREE_SHA256,
      }),
      {
        format: "CycloneDX",
        specificationVersion: SBOM_SPEC_VERSION,
        generator: [{ name: SBOM_GENERATOR_NAME, version: SBOM_GENERATOR_VERSION }],
        lockHashes: candidateLockHashes(fixture.root),
      },
    );
  } finally {
    cleanup(fixture.temp);
  }
});

test("generator refuses candidate-local, non-new, linked, and unsupported lockfile inputs", () => {
  const fixture = createFixture();
  try {
    assert.throws(
      () => generateCandidateSbom({
        root: fixture.root,
        candidateSha: CANDIDATE_SHA,
        sourceTreeSha256: TREE_SHA256,
        outputPath: join(fixture.root, "candidate-output", "candidate-sbom.json"),
      }),
      /outside the candidate repository/,
    );
    assert.equal(existsSync(join(fixture.root, "candidate-output")), false, "a rejected in-repository output must not create an untracked directory");
    const outputPath = join(fixture.outputs, "existing.json");
    writeFileSync(outputPath, "already here\n", "utf8");
    assert.throws(
      () => generateCandidateSbom({
        root: fixture.root,
        candidateSha: CANDIDATE_SHA,
        sourceTreeSha256: TREE_SHA256,
        outputPath,
      }),
      /must not overwrite/,
    );

    const apiLockPath = join(fixture.root, "backend/api/package-lock.json");
    const query = JSON.parse(readFileSync(apiLockPath, "utf8"));
    query.packages["node_modules/parent"].resolved = `${registryUrl("parent", "1.0.0")}?token=must-not-archive`;
    writeJson(apiLockPath, query);
    assert.throws(
      () => buildCandidateSbom({ root: fixture.root, candidateSha: CANDIDATE_SHA, sourceTreeSha256: TREE_SHA256 }),
      /must resolve only/,
    );
    writeJson(apiLockPath, fixtureLock("api-app", { bundled: true }));
    const malformed = JSON.parse(readFileSync(apiLockPath, "utf8"));
    malformed.packages["node_modules/parent"].integrity = "sha512-AAAA";
    writeJson(apiLockPath, malformed);
    assert.throws(
      () => buildCandidateSbom({ root: fixture.root, candidateSha: CANDIDATE_SHA, sourceTreeSha256: TREE_SHA256 }),
      /malformed SRI integrity/,
    );
    writeJson(apiLockPath, fixtureLock("api-app", { bundled: true }));
    const outsideLock = join(fixture.temp, "outside-lock.json");
    writeJson(outsideLock, fixtureLock("outside"));
    rmSync(apiLockPath);
    symlinkSync(outsideLock, apiLockPath);
    assert.throws(() => loadCandidateLocks(fixture.root), /regular non-symlink/);
  } finally {
    cleanup(fixture.temp);
  }
});

test("direct generator rejects npm-shrinkwrap.json in every controlled package root", () => {
  const fixture = createFixture();
  const packageRoots = [
    ["api", "backend/api", "NpM-Shrinkwrap.JsOn"],
    ["miniprogram", "frontend/miniprogram", "npm-SHRINKWRAP.json"],
    ["web", "frontend/web", "NPM-shrinkwrap.JSON"],
  ];
  try {
    for (const [id, packageRoot, shrinkwrapName] of packageRoots) {
      const shrinkwrapPath = join(fixture.root, packageRoot, shrinkwrapName);
      const outputPath = join(fixture.outputs, `${id}-shrinkwrap`, "candidate-sbom.json");
      writeJson(shrinkwrapPath, fixtureLock(`${id}-shrinkwrap`));
      assert.throws(
        () => generateCandidateSbom({
          root: fixture.root,
          candidateSha: CANDIDATE_SHA,
          sourceTreeSha256: TREE_SHA256,
          outputPath,
        }),
        new RegExp(`${id} package root must not contain npm-shrinkwrap\\.json`),
      );
      assert.equal(existsSync(outputPath), false, `${id} shrinkwrap rejection must not write an SBOM`);
      assert.equal(existsSync(dirname(outputPath)), false, `${id} shrinkwrap rejection must not create an output directory`);
      rmSync(shrinkwrapPath);
    }
  } finally {
    cleanup(fixture.temp);
  }
});

test("generator refuses preloaded Node settings before it can create an output", () => {
  const fixture = createFixture();
  const outputPath = join(fixture.outputs, "sealed.json");
  const previousNodeOptions = process.env.NODE_OPTIONS;
  const previousNodePath = process.env.NODE_PATH;
  try {
    process.env.NODE_OPTIONS = "--require /unsafe-preload.cjs";
    assert.throws(
      () => generateCandidateSbom({ root: fixture.root, candidateSha: CANDIDATE_SHA, sourceTreeSha256: TREE_SHA256, outputPath }),
      /NODE_OPTIONS must be empty/,
    );
    assert.equal(existsSync(outputPath), false);
    delete process.env.NODE_OPTIONS;
    process.env.NODE_PATH = "/unsafe-node-path";
    assert.throws(
      () => generateCandidateSbom({ root: fixture.root, candidateSha: CANDIDATE_SHA, sourceTreeSha256: TREE_SHA256, outputPath }),
      /NODE_PATH must be empty/,
    );
    assert.equal(existsSync(outputPath), false);
  } finally {
    if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previousNodeOptions;
    if (previousNodePath === undefined) delete process.env.NODE_PATH;
    else process.env.NODE_PATH = previousNodePath;
    cleanup(fixture.temp);
  }
});

test("validation rejects a generated document after any frozen lockfile provenance changes", () => {
  const fixture = createFixture();
  try {
    const document = buildCandidateSbom({
      root: fixture.root,
      candidateSha: CANDIDATE_SHA,
      sourceTreeSha256: TREE_SHA256,
    });
    const apiPath = join(fixture.root, "backend/api/package-lock.json");
    const changed = JSON.parse(readFileSync(apiPath, "utf8"));
    changed.packages["node_modules/parent"].version = "1.0.1";
    changed.packages["node_modules/parent"].resolved = registryUrl("parent", "1.0.1");
    changed.packages["node_modules/parent"].integrity = integrity("api-app:parent:changed");
    writeJson(apiPath, changed);
    assert.throws(
      () => validateGeneratedCandidateSbom(document, {
        root: fixture.root,
        candidateSha: CANDIDATE_SHA,
        sourceTreeSha256: TREE_SHA256,
      }),
      /does not exactly match/,
    );
  } finally {
    cleanup(fixture.temp);
  }
});

test("current repository locks produce a deterministic complete CycloneDX graph without node_modules", () => {
  const root = process.cwd();
  const locks = loadCandidateLocks(root);
  const document = buildCandidateSbom({ root, candidateSha: CANDIDATE_SHA, sourceTreeSha256: TREE_SHA256 });
  const expectedComponents = locks.reduce((count, lock) => count + Object.keys(lock.lock.packages).length, 0);
  assert.equal(document.components.length, expectedComponents);
  assert.equal(document.dependencies.length, expectedComponents);
  assert.equal(stableJson(document), stableJson(buildCandidateSbom({ root, candidateSha: CANDIDATE_SHA, sourceTreeSha256: TREE_SHA256 })));
  assert.equal(document.components.filter((component) => component.properties?.some((property) => property.name === "talkandtalk:integrity.provenance" && property.value === "inherited-bundled-parent")).length, 6);
  for (const lock of locks) {
    for (const [packagePath, entry] of Object.entries(lock.lock.packages)) {
      if (!packagePath) continue;
      const component = document.components.find((candidate) => {
        const properties = Object.fromEntries(candidate.properties?.map((property) => [property.name, property.value]) ?? []);
        return properties["talkandtalk:lock.id"] === lock.id && properties["talkandtalk:package.path"] === packagePath;
      });
      assert.ok(component, `missing component for ${lock.id}:${packagePath}`);
      const expectedScope = entry.dev || entry.devOptional ? "excluded" : entry.optional ? "optional" : "required";
      assert.equal(component.scope, expectedScope, `${lock.id}:${packagePath} must use a CycloneDX-standard scope`);
    }
  }
  assert.deepEqual(
    validateGeneratedCandidateSbom(document, { root, candidateSha: CANDIDATE_SHA, sourceTreeSha256: TREE_SHA256 }),
    {
      format: "CycloneDX",
      specificationVersion: SBOM_SPEC_VERSION,
      generator: [{ name: SBOM_GENERATOR_NAME, version: SBOM_GENERATOR_VERSION }],
      lockHashes: candidateLockHashes(root),
    },
  );
});
