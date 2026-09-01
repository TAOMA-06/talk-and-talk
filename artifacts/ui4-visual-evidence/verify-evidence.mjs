import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname);

function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.subarray(1, 4).toString("ascii") !== "PNG") {
    throw new Error("invalid PNG signature");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const representativeRoot = resolve(root, "representative");
const representativeFiles = (await readdir(representativeRoot))
  .filter((file) => /^\d{2}-.+-light-390\.png$/.test(file))
  .sort();
if (representativeFiles.length !== 10) throw new Error(`expected 10 representative screenshots, got ${representativeFiles.length}`);

const representative = [];
for (const file of representativeFiles) {
  const buffer = await readFile(resolve(representativeRoot, file));
  representative.push({
    file,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    dimensions: pngDimensions(buffer)
  });
}
if (new Set(representative.map((item) => item.sha256)).size !== representative.length) {
  throw new Error("representative screenshots are not unique");
}

const representativeManifest = JSON.parse(await readFile(resolve(representativeRoot, "manifest.json"), "utf8"));
if (
  representativeManifest.routes?.length !== 10
  || representativeManifest.routes.some((route) => route.outcome !== "captured" || route.actualPath !== route.expectedPath)
) throw new Error("representative manifest route matches are incomplete");

const dynamic = JSON.parse(await readFile(resolve(root, "dynamic/manifest.json"), "utf8"));
if (
  dynamic.sequences?.length !== 2
  || dynamic.sequences.some((sequence) => sequence.uniqueEntranceFrames < 2 || sequence.settled?.identical !== true)
) throw new Error("dynamic evidence lacks distinct entrance frames or a stable terminal state");

const matrix = JSON.parse(await readFile(resolve(root, "matrix/390/light/manifest.json"), "utf8"));
if (
  matrix.routes?.length !== 31
  || matrix.routes.some((route) => route.outcome !== "captured" || route.actualPath !== route.expectedPath)
) throw new Error("390/light matrix does not have 31/31 route matches");

const localCopy = JSON.parse(await readFile(resolve(root, "local-copy-verification.json"), "utf8"));
if (!localCopy.passed || localCopy.sourceDigest !== localCopy.localDigest) {
  throw new Error("final local copy is not byte-identical outside generated local-only files");
}

const summary = {
  passed: true,
  verifiedAt: new Date().toISOString(),
  representative: {
    screenshots: representative.length,
    uniqueImages: new Set(representative.map((item) => item.sha256)).size,
    routeMatches: "10/10",
    files: representative
  },
  matrix390Light: {
    screenshots: matrix.routes.length,
    routeMatches: "31/31",
    uniqueImages: new Set(matrix.routes.map((route) => route.sha256).filter(Boolean)).size
  },
  dynamic: dynamic.sequences.map((sequence) => ({
    name: sequence.name,
    actualPath: sequence.actualPath,
    uniqueEntranceFrames: sequence.uniqueEntranceFrames,
    settledIdentical: sequence.settled.identical
  })),
  localCopy: {
    comparedFiles: localCopy.comparedFiles,
    digest: localCopy.sourceDigest,
    noStoredAppId: localCopy.assertions.noStoredAppId,
    localOnlyMarker: localCopy.assertions.marker
  },
  validationScope: "Representative/390-light/dynamic/local-copy sample verifier. The canonical full matrix and interaction summary is generated only by build-final-summary.mjs.",
  externalGaps: [
    "no real identity, role, order, payment, API, preview, upload or device flow"
  ]
};
await writeFile(resolve(root, "evidence-verification.json"), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary)}\n`);
