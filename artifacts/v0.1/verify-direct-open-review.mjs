import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repo = resolve(here, "../..");
const root = resolve(repo, "artifacts/v0.1/direct-open-miniprogram");
const manifest = JSON.parse(await readFile(resolve(root, "REVIEW-MANIFEST.json"), "utf8"));
const project = JSON.parse(await readFile(resolve(root, "project.config.json"), "utf8"));
const app = JSON.parse(await readFile(resolve(root, "app.json"), "utf8"));
const historicalSourceManifestPath = resolve(repo, "artifacts/v0.1/manifest.json");

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path));
    else output.push(path);
  }
  return output;
}

if (project.appid !== "touristappid") throw new Error("UI review project must use touristappid");
if (project.setting?.urlCheck !== false) throw new Error("UI review project must not require a network domain");
if (!/do-not-upload/.test(project.projectname || "")) throw new Error("UI review project name must block upload confusion");
if (JSON.stringify(app.pages) !== JSON.stringify(["pages/gallery/index", "pages/screen/index"])) {
  throw new Error("UI review project exposes an unexpected runtime surface");
}
if (manifest.screenCount !== 31 || manifest.screens?.length !== 31) throw new Error("UI review must contain 31 screens");
if (manifest.networkRequests !== 0 || manifest.businessRuntime !== false || manifest.uploadAllowed !== false) {
  throw new Error("UI review evidence boundary is missing");
}
if (manifest.sourceManifest === "../manifest.json") {
  const sourceManifestBuffer = await readFile(historicalSourceManifestPath);
  if (manifest.sourceManifestSha256 !== sha256(sourceManifestBuffer)) throw new Error("Source manifest binding mismatch");
} else if (manifest.sourceManifest === "SOURCE-CAPTURE-MANIFEST.json") {
  const sourceManifestBuffer = await readFile(resolve(root, manifest.sourceManifest));
  if (manifest.sourceManifestSha256 !== sha256(sourceManifestBuffer)) throw new Error("Current capture manifest binding mismatch");
} else {
  throw new Error("Unknown source-manifest boundary");
}
if (!Number.isFinite(Date.parse(manifest.sourceGeneratedAt))) throw new Error("Source capture timestamp is missing");

const imageFiles = (await readdir(resolve(root, "assets/screens"))).filter((file) => file.endsWith(".jpg")).sort();
if (imageFiles.length !== 31) throw new Error(`Expected 31 compressed images, found ${imageFiles.length}`);
for (const screen of manifest.screens) {
  const path = resolve(root, screen.image.replace(/^\//, ""));
  const buffer = await readFile(path);
  if (sha256(buffer) !== screen.reviewSha256 || buffer.length !== screen.bytes) {
    throw new Error(`Review image integrity mismatch: ${screen.name}`);
  }
}

const textFiles = (await walk(root)).filter((path) => /\.(?:js|json|wxml|wxss|md)$/.test(path));
const text = (await Promise.all(textFiles.map((path) => readFile(path, "utf8")))).join("\n");
for (const forbidden of [/wx\.request\s*\(/, /wx\.login\s*\(/, /wx\.requestPayment\s*\(/, /https?:\/\//i]) {
  if (forbidden.test(text)) throw new Error(`Review project contains forbidden network/business marker: ${forbidden}`);
}

const projectBytes = (await Promise.all((await walk(root)).map(async (path) => (await stat(path)).size)))
  .reduce((sum, value) => sum + value, 0);
if (projectBytes > 2 * 1024 * 1024) throw new Error(`Review project exceeds 2 MiB: ${projectBytes}`);

console.log(JSON.stringify({
  passed: true,
  screens: manifest.screenCount,
  projectBytes,
  networkRequests: 0,
  appid: project.appid,
  projectname: project.projectname
}));
