import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname);

function pngDimensions(buffer) {
  if (buffer.subarray(1, 4).toString("ascii") !== "PNG") throw new Error("invalid PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function evidence(path) {
  const absolute = resolve(root, path);
  const buffer = await readFile(absolute);
  const capture = JSON.parse(await readFile(`${absolute}.json`, "utf8"));
  return {
    ...capture,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    dimensions: pngDimensions(buffer)
  };
}

const matrixPath = resolve(root, "matrix/390/light/manifest.json");
const matrix = JSON.parse(await readFile(matrixPath, "utf8"));
const replacements = new Map([
  ["01-consent", await evidence("matrix/390/light/01-consent.png")],
  ["20-companion-detail", await evidence("matrix/390/light/20-companion-detail.png")]
]);
matrix.routes = matrix.routes.map((route) => {
  const replacement = replacements.get(route.name);
  if (!replacement) return route;
  return {
    ...route,
    actualPath: replacement.actualPath,
    outcome: replacement.routeMatched ? "captured" : "redirected",
    error: "",
    sha256: replacement.sha256,
    dimensions: replacement.dimensions,
    durationMs: replacement.durationMs,
    recapturedAt: new Date().toISOString(),
    fixture: replacement.fixture
  };
});
matrix.updatedAt = new Date().toISOString();
matrix.sourceVerification = JSON.parse(await readFile(resolve(root, "local-copy-verification.json"), "utf8"));
matrix.remediation = {
  compileBlocker: "replaced four unsupported universal-child WXSS selectors with explicit classes",
  companionDetailFailClosed: "replaced the blank error branch with a stable M0 recovery card",
  rerunAfterRemediation: true
};
await writeFile(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`);

const representativePath = resolve(root, "representative/manifest.json");
const representative = JSON.parse(await readFile(representativePath, "utf8"));
representative.updatedAt = new Date().toISOString();
representative.remediation = {
  companionDetail: {
    evidence: await evidence("representative/20-companion-detail-light-390.png"),
    result: "stable M0 error card with retry, back and safety recovery; no fake profile data"
  }
};
await writeFile(representativePath, `${JSON.stringify(representative, null, 2)}\n`);

process.stdout.write(`${JSON.stringify({ updated: [matrixPath, representativePath] })}\n`);
