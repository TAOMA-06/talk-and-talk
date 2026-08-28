#!/usr/bin/env node
/**
 * Deterministic, lockfile-only CycloneDX generator for a frozen Talk&Talk
 * candidate. It intentionally never reads node_modules, invokes npm, or uses
 * the network. Candidate-evidence.mjs supplies the clean-candidate binding;
 * this module turns those immutable inputs and the three tracked npm v3 locks
 * into a byte-stable SBOM.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const SBOM_GENERATOR_NAME = "talk-and-talk-lockfile-sbom";
export const SBOM_GENERATOR_VERSION = "1.0.0";
export const SBOM_SPEC_VERSION = "1.6";

export const LOCKFILE_INPUTS = Object.freeze([
  Object.freeze({ id: "api", path: "backend/api/package-lock.json" }),
  Object.freeze({ id: "miniprogram", path: "frontend/miniprogram/package-lock.json" }),
  Object.freeze({ id: "web", path: "frontend/web/package-lock.json" }),
]);

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SRI_ALGORITHMS = Object.freeze({
  sha256: "SHA-256",
  sha384: "SHA-384",
  sha512: "SHA-512",
});
const SRI_BYTE_LENGTHS = Object.freeze({ sha256: 32, sha384: 48, sha512: 64 });
const REGISTRY_HOST = "registry.npmjs.org";

function fail(message) {
  const error = new Error(message);
  error.code = "CANDIDATE_SBOM_ERROR";
  throw error;
}

function assertSafeInvokerEnvironment(environment = process.env) {
  if (String(environment.NODE_OPTIONS ?? "").trim()) {
    fail("NODE_OPTIONS must be empty before candidate SBOM generation can start");
  }
  if (String(environment.NODE_PATH ?? "").trim()) {
    fail("NODE_PATH must be empty before candidate SBOM generation can start");
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function pathInside(root, target) {
  const value = relative(root, target);
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
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

function canonicalDirectory(path, label) {
  if (!isAbsolute(path)) fail(`${label} must be an absolute path`);
  try {
    const canonical = realpathSync(path);
    if (!statSync(canonical).isDirectory()) fail(`${label} must be a directory`);
    return canonical;
  } catch (error) {
    fail(`${label} must be an existing real directory: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function regularFileInside(root, path, label) {
  const candidate = resolve(root, path);
  if (!pathInside(root, candidate)) fail(`${label} must remain inside the candidate root`);
  try {
    const metadata = lstatSync(candidate);
    if (metadata.isSymbolicLink() || !metadata.isFile()) fail(`${label} must be a regular non-symlink file`);
    const canonical = realpathSync(candidate);
    if (!pathInside(root, canonical)) fail(`${label} resolves outside the candidate root`);
    return canonical;
  } catch (error) {
    if (error?.code === "CANDIDATE_SBOM_ERROR") throw error;
    fail(`${label} is missing or invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function asciiCaseFold(value) {
  return String(value).replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function assertNoNpmShrinkwrap(root, descriptor) {
  const packageRoot = resolve(root, dirname(descriptor.path));
  if (!pathInside(root, packageRoot)) fail(`${descriptor.id} package root must remain inside the candidate root`);
  let entries;
  try {
    entries = readdirSync(packageRoot, { withFileTypes: true });
  } catch (error) {
    fail(`${descriptor.id} package root is missing or invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (entries.some((entry) => asciiCaseFold(entry.name) === "npm-shrinkwrap.json")) {
    fail(`${descriptor.id} package root must not contain npm-shrinkwrap.json; only package-lock.json may define candidate lockfile provenance`);
  }
}

function parseLockfile(root, descriptor) {
  assertNoNpmShrinkwrap(root, descriptor);
  const absolute = regularFileInside(root, descriptor.path, `${descriptor.id} package lock`);
  const bytes = readFileSync(absolute);
  let lock;
  try {
    lock = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(`${descriptor.id} package lock must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (lock?.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== "object" || Array.isArray(lock.packages)) {
    fail(`${descriptor.id} package lock must be npm lockfileVersion 3 with a packages map`);
  }
  const rootPackage = lock.packages[""];
  if (!rootPackage || typeof rootPackage.name !== "string" || !rootPackage.name || typeof rootPackage.version !== "string" || !rootPackage.version) {
    fail(`${descriptor.id} package lock must define a named, versioned application root`);
  }
  return Object.freeze({
    ...descriptor,
    absolute,
    bytes,
    sha256: sha256(bytes),
    lock,
  });
}

export function loadCandidateLocks(root = process.cwd()) {
  const candidateRoot = canonicalDirectory(root, "candidate root");
  return Object.freeze(LOCKFILE_INPUTS.map((descriptor) => parseLockfile(candidateRoot, descriptor)));
}

export function candidateLockHashes(root = process.cwd()) {
  return Object.freeze(Object.fromEntries(loadCandidateLocks(root).map((lock) => [lock.id, lock.sha256])));
}

function packageNameFromPath(packagePath) {
  const pieces = packagePath.split("/");
  const marker = pieces.lastIndexOf("node_modules");
  if (marker < 0 || !pieces[marker + 1]) fail(`Unsupported npm package path: ${packagePath}`);
  if (pieces[marker + 1].startsWith("@")) {
    if (!pieces[marker + 2]) fail(`Scoped npm package path is incomplete: ${packagePath}`);
    return `${pieces[marker + 1]}/${pieces[marker + 2]}`;
  }
  return pieces[marker + 1];
}

function npmPurl(name, version) {
  const encodedName = encodeURIComponent(name).replace(/%2F/gi, "/");
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

function packageBomRef(lock, packagePath) {
  return `urn:talkandtalk:npm:${lock.id}:${lock.sha256}:${encodeURIComponent(packagePath)}`;
}

function applicationBomRef(lock) {
  return `urn:talkandtalk:application:${lock.id}:${lock.sha256}`;
}

function sortedProperties(values) {
  return values
    .filter((entry) => entry.value !== undefined && entry.value !== null && entry.value !== "")
    .map((entry) => ({ name: entry.name, value: String(entry.value) }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.value.localeCompare(right.value));
}

function sriHashes(integrity, label) {
  if (typeof integrity !== "string" || !integrity.trim()) fail(`${label} must include npm SRI integrity`);
  const hashes = [];
  for (const token of integrity.trim().split(/\s+/)) {
    const separator = token.indexOf("-");
    const algorithm = token.slice(0, separator).toLowerCase();
    const encoded = token.slice(separator + 1);
    if (separator <= 0 || !SRI_ALGORITHMS[algorithm]) fail(`${label} uses unsupported SRI integrity algorithm`);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) fail(`${label} has malformed SRI integrity`);
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length !== SRI_BYTE_LENGTHS[algorithm] || bytes.toString("base64") !== encoded) {
      fail(`${label} has malformed SRI integrity`);
    }
    hashes.push({ alg: SRI_ALGORITHMS[algorithm], content: bytes.toString("hex") });
  }
  const unique = new Map(hashes.map((hash) => [`${hash.alg}:${hash.content}`, hash]));
  return [...unique.values()].sort((left, right) => left.alg.localeCompare(right.alg) || left.content.localeCompare(right.content));
}

function resolveBundledIntegrity(lock, packagePath, packages) {
  let current = packagePath;
  while (current) {
    const marker = current.lastIndexOf("/node_modules/");
    if (marker < 0) break;
    current = current.slice(0, marker);
    const parent = packages[current];
    if (parent?.integrity) {
      return { sourcePath: current, hashes: sriHashes(parent.integrity, `${lock.id} bundled parent ${current}`) };
    }
  }
  fail(`${lock.id} bundled package ${packagePath} has no ancestor archive integrity`);
}

function validateResolvedUrl(value, label) {
  if (typeof value !== "string" || !value) fail(`${label} must include a registry resolved URL`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${label} has an invalid resolved URL`);
  }
  if (
    parsed.protocol !== "https:"
    || parsed.hostname !== REGISTRY_HOST
    || parsed.port
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    fail(`${label} must resolve only to ${REGISTRY_HOST} over HTTPS`);
  }
  return parsed.toString();
}

function componentScope(rawEntry) {
  // npm's devOptional entries are not production requirements. Preserve the
  // conservative dev/excluded precedence before optional for standard SBOM
  // consumers, while keeping the source classification in properties below.
  if (rawEntry.dev || rawEntry.devOptional) return "excluded";
  if (rawEntry.optional) return "optional";
  return "required";
}

function packageEntry(lock, packagePath, rawEntry) {
  if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
    fail(`${lock.id} package ${packagePath} is invalid`);
  }
  if (rawEntry.link) fail(`${lock.id} package ${packagePath} must not use a linked/file dependency`);
  const name = rawEntry.name ?? packageNameFromPath(packagePath);
  if (typeof name !== "string" || !name || typeof rawEntry.version !== "string" || !rawEntry.version) {
    fail(`${lock.id} package ${packagePath} must have a name and version`);
  }
  if (rawEntry.name && rawEntry.name !== packageNameFromPath(packagePath)) {
    fail(`${lock.id} package ${packagePath} has a name that disagrees with its npm path`);
  }

  const scope = componentScope(rawEntry);
  const properties = [
    { name: "talkandtalk:lock.id", value: lock.id },
    { name: "talkandtalk:lock.path", value: lock.path },
    { name: "talkandtalk:lock.sha256", value: lock.sha256 },
    { name: "talkandtalk:package.path", value: packagePath },
    { name: "talkandtalk:scope", value: scope },
    ...(rawEntry.optional ? [{ name: "talkandtalk:optional", value: "true" }] : []),
    ...(rawEntry.devOptional ? [{ name: "talkandtalk:dev-optional", value: "true" }] : []),
    ...(rawEntry.inBundle ? [{ name: "talkandtalk:bundled", value: "true" }] : []),
  ];
  let hashes;
  if (rawEntry.inBundle && !rawEntry.integrity) {
    const inherited = resolveBundledIntegrity(lock, packagePath, lock.lock.packages);
    // An npm bundled child does not have a separately downloaded archive here.
    // Its parent tarball SRI is useful custody context but is not a hash of the
    // child component itself, so it must never occupy CycloneDX `hashes`.
    properties.push(
      { name: "talkandtalk:integrity.provenance", value: "inherited-bundled-parent" },
      { name: "talkandtalk:integrity.source.path", value: inherited.sourcePath },
      { name: "talkandtalk:bundled.parent.archive.hashes", value: inherited.hashes.map((hash) => `${hash.alg}:${hash.content}`).join(",") },
    );
  } else {
    hashes = sriHashes(rawEntry.integrity, `${lock.id} package ${packagePath}`);
    properties.push({ name: "talkandtalk:integrity.provenance", value: "package-lock" });
    properties.push({ name: "talkandtalk:resolved", value: validateResolvedUrl(rawEntry.resolved, `${lock.id} package ${packagePath}`) });
  }

  const component = {
    type: "library",
    "bom-ref": packageBomRef(lock, packagePath),
    name,
    version: rawEntry.version,
    purl: npmPurl(name, rawEntry.version),
    scope,
    ...(hashes ? { hashes } : {}),
    properties: sortedProperties(properties),
  };
  if (typeof rawEntry.license === "string" && rawEntry.license) {
    component.licenses = [{ license: { name: rawEntry.license } }];
  }
  return Object.freeze({ component, rawEntry, packagePath });
}

function declaredDependencies(entry) {
  const names = new Map();
  const add = (name, optional) => {
    if (typeof name !== "string" || !name) fail(`Package ${entry?.name || "unknown"} has an invalid dependency name`);
    const current = names.get(name);
    // A required declaration always wins over an optional duplicate.
    names.set(name, { name, optional: current ? Boolean(current.optional && optional) : Boolean(optional) });
  };
  for (const field of ["dependencies", "optionalDependencies", "devDependencies", "bundleDependencies", "bundledDependencies"]) {
    const values = entry?.[field];
    if (Array.isArray(values)) {
      for (const name of values) {
        add(name, false);
      }
      continue;
    }
    if (!values || typeof values !== "object" || Array.isArray(values)) continue;
    for (const name of Object.keys(values)) add(name, field === "optionalDependencies");
  }
  const peerMeta = entry?.peerDependenciesMeta;
  const peers = entry?.peerDependencies;
  if (peers && typeof peers === "object" && !Array.isArray(peers)) {
    for (const name of Object.keys(peers)) {
      const optional = peerMeta?.[name]?.optional === true;
      add(name, optional);
    }
  }
  return [...names.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function resolveDependencyPath(packagePath, dependencyName, packages) {
  let current = packagePath;
  while (current) {
    const nested = `${current}/node_modules/${dependencyName}`;
    if (packages[nested]) return nested;
    const marker = current.lastIndexOf("/node_modules/");
    if (marker < 0) break;
    current = current.slice(0, marker);
  }
  const rootDependency = `node_modules/${dependencyName}`;
  if (packages[rootDependency]) return rootDependency;
  return null;
}

function lockModel(lock) {
  const packages = lock.lock.packages;
  const entries = new Map();
  for (const packagePath of Object.keys(packages).filter(Boolean).sort((left, right) => left.localeCompare(right))) {
    entries.set(packagePath, packageEntry(lock, packagePath, packages[packagePath]));
  }
  const root = packages[""];
  const rootRef = applicationBomRef(lock);
  const rootProperties = sortedProperties([
    { name: "talkandtalk:lock.id", value: lock.id },
    { name: "talkandtalk:lock.path", value: lock.path },
    { name: "talkandtalk:lock.sha256", value: lock.sha256 },
  ]);
  const rootComponent = {
    type: "application",
    "bom-ref": rootRef,
    name: root.name,
    version: root.version,
    properties: rootProperties,
  };
  const rootDependencies = declaredDependencies(root).flatMap(({ name, optional }) => {
    const path = resolveDependencyPath("", name, packages);
    if (!path || !entries.has(path)) {
      if (optional) return [];
      fail(`${lock.id} root dependency ${name} has no locked package entry`);
    }
    return entries.get(path).component["bom-ref"];
  });
  const edges = [{ ref: rootRef, dependsOn: [...new Set(rootDependencies)].sort((left, right) => left.localeCompare(right)) }];
  for (const entry of entries.values()) {
    const dependencies = declaredDependencies(entry.rawEntry).flatMap(({ name, optional }) => {
      const path = resolveDependencyPath(entry.packagePath, name, packages);
      if (!path || !entries.has(path)) {
        if (optional) return [];
        fail(`${lock.id} package ${entry.packagePath} dependency ${name} has no locked package entry`);
      }
      return entries.get(path).component["bom-ref"];
    });
    edges.push({
      ref: entry.component["bom-ref"],
      dependsOn: [...new Set(dependencies)].sort((left, right) => left.localeCompare(right)),
    });
  }
  return Object.freeze({
    components: [rootComponent, ...[...entries.values()].map((entry) => entry.component)],
    edges,
  });
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function candidateMetadataComponent(candidateSha, sourceTreeSha256, locks) {
  const properties = [
    { name: "talkandtalk:candidate.sha", value: candidateSha },
    { name: "talkandtalk:source.tree.sha256", value: sourceTreeSha256 },
    ...locks.flatMap((lock) => [
      { name: `talkandtalk:lock.${lock.id}.path`, value: lock.path },
      { name: `talkandtalk:lock.${lock.id}.sha256`, value: lock.sha256 },
    ]),
  ];
  return {
    type: "application",
    "bom-ref": `urn:talkandtalk:candidate:${candidateSha}`,
    name: "talk-and-talk-candidate",
    version: candidateSha,
    properties: sortedProperties(properties),
  };
}

export function buildCandidateSbom({ root = process.cwd(), candidateSha, sourceTreeSha256 } = {}) {
  const normalizedCandidateSha = requireSha(candidateSha, "candidate SHA");
  const normalizedSourceTreeSha256 = requireSha256(sourceTreeSha256, "source tree SHA-256");
  const locks = loadCandidateLocks(root);
  const models = locks.map(lockModel);
  const components = models.flatMap((model) => model.components)
    .sort((left, right) => left["bom-ref"].localeCompare(right["bom-ref"]));
  const dependencies = models.flatMap((model) => model.edges)
    .sort((left, right) => left.ref.localeCompare(right.ref));
  const references = new Set();
  for (const component of components) {
    if (references.has(component["bom-ref"])) fail(`Duplicate SBOM component reference: ${component["bom-ref"]}`);
    references.add(component["bom-ref"]);
  }
  for (const edge of dependencies) {
    if (!references.has(edge.ref)) fail(`SBOM dependency graph has an unknown source reference: ${edge.ref}`);
    for (const target of edge.dependsOn) {
      if (!references.has(target)) fail(`SBOM dependency graph has an unresolved target reference: ${target}`);
    }
  }
  return {
    bomFormat: "CycloneDX",
    specVersion: SBOM_SPEC_VERSION,
    version: 1,
    metadata: {
      tools: {
        components: [{
          type: "application",
          name: SBOM_GENERATOR_NAME,
          version: SBOM_GENERATOR_VERSION,
        }],
      },
      component: candidateMetadataComponent(normalizedCandidateSha, normalizedSourceTreeSha256, locks),
    },
    components,
    dependencies,
  };
}

function prepareOutput(root, outputPath) {
  if (!isAbsolute(outputPath)) fail("SBOM output must be an absolute path outside the candidate repository");
  if (!outputPath.endsWith(".json")) fail("SBOM output must use a .json filename");
  const requested = resolve(outputPath);
  if (pathInside(root, requested)) fail("SBOM output must be outside the candidate repository");
  if (existsSync(requested)) fail("SBOM output must not overwrite an existing file");

  let existingParent = dirname(requested);
  while (!existsSync(existingParent)) {
    const next = dirname(existingParent);
    if (next === existingParent) fail("SBOM output must have a resolvable parent directory");
    existingParent = next;
  }
  if (!statSync(existingParent).isDirectory()) fail("SBOM output parent must resolve to a directory");
  const suffix = relative(existingParent, requested);
  if (!suffix || isAbsolute(suffix) || suffix === ".." || suffix.startsWith(`..${sep}`)) {
    fail("SBOM output must be a descendant of its parent directory");
  }
  const canonicalParent = realpathSync(existingParent);
  const target = resolve(canonicalParent, suffix);
  if (pathInside(root, target)) fail("SBOM output must be outside the candidate repository");
  if (existsSync(target)) fail("SBOM output must not overwrite an existing file");
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  return target;
}

export function generateCandidateSbom({ root = process.cwd(), candidateSha, sourceTreeSha256, outputPath } = {}) {
  assertSafeInvokerEnvironment();
  const candidateRoot = canonicalDirectory(root, "candidate root");
  const document = buildCandidateSbom({ root: candidateRoot, candidateSha, sourceTreeSha256 });
  const output = prepareOutput(candidateRoot, outputPath);
  const content = stableJson(document);
  writeFileSync(output, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return Object.freeze({
    path: output,
    sha256: sha256(content),
    bytes: Buffer.byteLength(content),
    document,
  });
}

function propertyMap(component) {
  const values = new Map();
  for (const property of component?.properties ?? []) {
    if (!property || typeof property.name !== "string" || typeof property.value !== "string") fail("Candidate SBOM metadata properties are invalid");
    if (values.has(property.name)) fail(`Candidate SBOM duplicates metadata property ${property.name}`);
    values.set(property.name, property.value);
  }
  return values;
}

export function validateGeneratedCandidateSbom(document, { root = process.cwd(), candidateSha, sourceTreeSha256 } = {}) {
  if (!document || typeof document !== "object" || Array.isArray(document)) fail("Candidate SBOM is invalid");
  const expected = buildCandidateSbom({ root, candidateSha, sourceTreeSha256 });
  if (stableJson(document) !== stableJson(expected)) {
    fail("Candidate SBOM does not exactly match the frozen candidate lockfile provenance");
  }
  const metadata = document.metadata;
  const generator = metadata?.tools?.components?.find((tool) => tool?.name === SBOM_GENERATOR_NAME);
  if (!generator || generator.version !== SBOM_GENERATOR_VERSION) fail("Candidate SBOM has an unsupported generator");
  const properties = propertyMap(metadata.component);
  if (properties.get("talkandtalk:candidate.sha") !== candidateSha || properties.get("talkandtalk:source.tree.sha256") !== sourceTreeSha256) {
    fail("Candidate SBOM provenance does not match the frozen candidate");
  }
  return Object.freeze({
    format: "CycloneDX",
    specificationVersion: SBOM_SPEC_VERSION,
    generator: [{ name: SBOM_GENERATOR_NAME, version: SBOM_GENERATOR_VERSION }],
    lockHashes: candidateLockHashes(root),
  });
}

function usage(exitCode = 0) {
  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write(
    "Usage: node scripts/generate-candidate-sbom.mjs --root <absolute-candidate-root> --candidate-sha <40-hex-sha> --source-tree-sha256 <64-hex-sha> --out <absolute-external-sbom.json>\n",
  );
  process.exit(exitCode);
}

function parseOptions(argv) {
  const options = {};
  const allowed = new Set(["--root", "--candidate-sha", "--source-tree-sha256", "--out"]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!allowed.has(argument)) usage(2);
    const value = argv[++index];
    if (!value || value.startsWith("--")) fail(`${argument} requires a value`);
    const key = argument.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    if (Object.hasOwn(options, key)) fail(`${argument} may be supplied only once`);
    options[key] = value;
  }
  for (const key of ["root", "candidateSha", "sourceTreeSha256", "out"]) {
    if (!options[key]) fail(`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
  }
  return options;
}

export function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) usage(argv.length ? 0 : 2);
  const options = parseOptions(argv);
  const result = generateCandidateSbom({
    root: options.root,
    candidateSha: options.candidateSha,
    sourceTreeSha256: options.sourceTreeSha256,
    outputPath: options.out,
  });
  process.stdout.write(`Candidate SBOM generated: ${result.path} ${result.sha256}\n`);
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
