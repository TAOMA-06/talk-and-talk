import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname);
const projectRoot = resolve(root, "../..");

function imageDimensions(buffer) {
  if (buffer.length >= 24 && buffer.subarray(1, 4).toString("ascii") === "PNG") {
    return { format: "png", width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { format: "jpeg", height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      if (!Number.isFinite(length) || length < 2) break;
      offset += length + 2;
    }
  }
  throw new Error("unsupported image signature");
}

async function imageEvidence(relativeToProject) {
  const path = resolve(projectRoot, relativeToProject);
  const buffer = await readFile(path);
  return {
    path: relativeToProject,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    dimensions: imageDimensions(buffer)
  };
}

const matrix = {};
for (const width of [320, 390, 430]) {
  for (const theme of ["light", "dark"]) {
    const key = `${width}/${theme}`;
    const manifest = JSON.parse(await readFile(resolve(root, "matrix", String(width), theme, "manifest.json"), "utf8"));
    const captured = manifest.routes.filter((route) => route.outcome === "captured" && route.actualPath === route.expectedPath);
    matrix[key] = {
      model: manifest.simulator.model,
      SDKVersion: manifest.simulator.SDKVersion,
      windowWidth: manifest.simulator.windowWidth,
      windowHeight: manifest.simulator.windowHeight,
      theme: manifest.simulator.theme,
      routeMatches: captured.length,
      failed: manifest.routes.filter((route) => route.outcome === "failed").length,
      uniqueImages: new Set(manifest.routes.map((route) => route.sha256)).size,
      manifest: `artifacts/ui4-visual-evidence/matrix/${key}/manifest.json`
    };
    if (captured.length !== 31 || matrix[key].failed !== 0) throw new Error(`${key} is not 31/31 captured`);
  }
}

const motionOff = JSON.parse(await readFile(resolve(root, "interaction/motion-off/manifest.json"), "utf8"));
if (motionOff.runtime?.motionOff !== true || !motionOff.byteIdenticalAfter1200Ms) {
  throw new Error("motion-off runtime evidence is incomplete");
}
const dynamic = JSON.parse(await readFile(resolve(root, "dynamic/manifest.json"), "utf8"));
const localCopy = JSON.parse(await readFile(resolve(root, "local-copy-verification.json"), "utf8"));
const postFixDevTools = JSON.parse(await readFile(resolve(projectRoot, "artifacts/v0.1/post-fix-devtools.json"), "utf8"));
const postCaptureRemediation = JSON.parse(await readFile(resolve(root, "post-capture-remediation.json"), "utf8"));
if (!localCopy.passed || localCopy.sourceDigest !== localCopy.localDigest) {
  throw new Error("generated local copy does not match the frozen Mini Program source");
}
if (
  !postFixDevTools.passed
  || postFixDevTools.sourceSelectorWarningCount !== 0
  || postFixDevTools.sourceDigest !== localCopy.sourceDigest
  || postFixDevTools.localCopyDigest !== localCopy.localDigest
  || postCaptureRemediation.finalSourceDigest !== localCopy.sourceDigest
) {
  throw new Error("post-capture selector remediation is not bound to the final isolated Mini Program source");
}
if (dynamic.sequences.some((sequence) => !sequence.settled?.identical || sequence.uniqueEntranceFrames < 2)) {
  throw new Error("dynamic sequence evidence is incomplete");
}

const interactions = {
  homeBackCard: {
    result: "pass",
    observation: "WeChat accessibility state changed the work-pressure scene card from Value 0 to Value 1 and exposed the selected label",
    evidence: await imageEvidence("artifacts/ui4-visual-evidence/interaction/home-back-card-selected-copy-min-light-390.png")
  },
  discoverFilter: {
    result: "pass",
    observation: "filter sheet opened, Chinese filter was activated, View Results closed the sheet and retained pages/discover/index",
    open: await imageEvidence("artifacts/ui4-visual-evidence/interaction/discover-filter-open-copy-min-light-390.png"),
    applied: await imageEvidence("artifacts/ui4-visual-evidence/interaction/discover-filter-applied-copy-min-light-390.png")
  },
  motionOff: {
    result: "pass",
    runtime: motionOff.runtime,
    byteIdenticalAfter1200Ms: motionOff.byteIdenticalAfter1200Ms,
    manifest: "artifacts/ui4-visual-evidence/interaction/motion-off/manifest.json"
  }
};

const web = {};
for (const name of ["home", "how", "safety", "about", "partners"]) {
  web[name] = {
    desktop: await imageEvidence(`artifacts/ui4-web-copy-${name}-1280.png`),
    mobile: await imageEvidence(`artifacts/ui4-web-copy-${name}-390.png`)
  };
}
const ops = {};
for (const name of ["admin", "review"]) {
  ops[name] = {
    desktop: await imageEvidence(`artifacts/ui4-ops-copy-${name}-1280.png`),
    mobile: await imageEvidence(`artifacts/ui4-ops-copy-${name}-390.png`)
  };
}

const summary = {
  generatedAt: new Date().toISOString(),
  conclusion: "UI4 local implementation and requested visual/runtime validation complete, including post-capture component-selector remediation; external release gates remain separate",
  miniProgram: {
    totalStaticScreenshots: Object.values(matrix).reduce((total, item) => total + item.routeMatches, 0),
    localCopy,
    matrix,
    dynamic: {
      manifest: "artifacts/ui4-visual-evidence/dynamic/manifest.json",
      sequences: dynamic.sequences.map((sequence) => ({
        name: sequence.name,
        route: sequence.actualPath,
        uniqueEntranceFrames: sequence.uniqueEntranceFrames,
        settledIdentical: sequence.settled.identical
      }))
    },
    interactions,
    postCaptureRemediation: {
      manifest: "artifacts/ui4-visual-evidence/post-capture-remediation.json",
      matrixBatchAssociatedSourceDigest: postCaptureRemediation.matrixBatchAssociatedSourceDigest,
      finalSourceDigest: postCaptureRemediation.finalSourceDigest,
      changedFiles: postCaptureRemediation.changedAfterMatrixCapture.map((item) => item.file),
      matrixReuseDecision: postCaptureRemediation.matrixReuseDecision,
      devtools: {
        verification: "artifacts/v0.1/post-fix-devtools.json",
        screenshot: postFixDevTools.screenshot,
        sourceSelectorWarningCount: postFixDevTools.sourceSelectorWarningCount
      },
      motionOffReverified: motionOff.byteIdenticalAfter1200Ms
    }
  },
  publicWeb: web,
  ops,
  evidenceBoundary: {
    realIdentityToken: false,
    realRoleSession: false,
    realOrderOrPaymentData: false,
    miniLocalApiStarted: false,
    adminReviewAuthenticatedFlowRun: false,
    previewUploadDeploy: false
  }
};

await writeFile(resolve(root, "evidence-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  written: "artifacts/ui4-visual-evidence/evidence-summary.json",
  miniStaticScreenshots: summary.miniProgram.totalStaticScreenshots,
  interactions: Object.keys(interactions),
  webRoutes: Object.keys(web),
  ops: Object.keys(ops)
})}\n`);
