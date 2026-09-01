import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repo = resolve(here, "../..");
const outputRoot = resolve(repo, "artifacts/v0.1");
const screensRoot = resolve(outputRoot, "screens");
const matrixRoot = resolve(repo, "artifacts/ui4-visual-evidence/matrix/390/light");
const dynamicRoot = resolve(repo, "artifacts/ui4-visual-evidence/dynamic/home-scene-deal");
const matrixManifest = JSON.parse(await readFile(resolve(matrixRoot, "manifest.json"), "utf8"));
const appManifest = JSON.parse(await readFile(resolve(repo, "frontend/miniprogram/app.json"), "utf8"));
const { default: sharp } = await import(resolve(repo, "frontend/web/node_modules/sharp/dist/index.mjs"));

function publicPath(path) {
  return relative(repo, path).split("\\").join("/");
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function fileRecord(path) {
  const metadata = await sharp(path, { animated: true }).metadata();
  return {
    file: publicPath(path),
    sha256: await sha256(path),
    bytes: (await stat(path)).size,
    width: metadata.width,
    height: metadata.pageHeight || metadata.height,
    frames: metadata.pages || 1,
    loop: metadata.loop ?? null,
    delayMs: metadata.delay || null
  };
}

await mkdir(screensRoot, { recursive: true });
const screenEntries = [];
const matrixRoutesByPath = new Map(matrixManifest.routes.map((route) => [route.expectedPath, route]));
for (const [pageIndex, pagePath] of appManifest.pages.entries()) {
  const route = matrixRoutesByPath.get(pagePath);
  if (!route) throw new Error(`missing captured route: ${pagePath}`);
  if (route.outcome !== "captured" || route.actualPath !== route.expectedPath) {
    throw new Error(`unverified route: ${route.name}`);
  }
  const source = resolve(matrixRoot, route.screenshotFile);
  const output = resolve(screensRoot, route.screenshotFile);
  await copyFile(source, output);
  const record = await fileRecord(output);
  screenEntries.push({
    index: pageIndex + 1,
    name: route.name,
    route: route.route,
    actualPath: route.actualPath,
    file: record.file,
    source: publicPath(source),
    sha256: record.sha256,
    bytes: record.bytes,
    dimensions: { width: record.width, height: record.height },
    captureState: route.name === "01-consent" ? "anonymous consent" : "legal-only fail-closed"
  });
}

for (const entry of screenEntries.filter((item) => [27, 28].includes(item.index))) {
  entry.visualStateGroup = "companion-ops-access-fail-closed";
  entry.visualEquivalence = "Expected identical rendering under the legal-only fixture; routes remain distinct.";
}

const overviewPath = resolve(outputRoot, "ui4-overview.png");
const overviewWidth = 1720;
const overviewHeight = 960;
const tileSources = [
  ["01-consent.png", "CONSENT", "#f4dfc8", null],
  ["02-home.png", "HOME", "#dcecf6", null],
  ["16-safety.png", "SAFETY", "#f1dfe7", 1100]
];
const composites = [];
for (const [index, [file, label, color, cropHeight]] of tileSources.entries()) {
  const left = 175 + index * 475;
  const top = 170;
  let screenshotPipeline = sharp(resolve(screensRoot, file));
  if (cropHeight) {
    screenshotPipeline = screenshotPipeline.extract({ left: 0, top: 0, width: 780, height: cropHeight });
  }
  const screenshot = await screenshotPipeline
    .resize(330, 610, { fit: "contain", position: "top", background: "#fbfaf7" })
    .composite([{
      input: Buffer.from('<svg width="330" height="610"><rect width="330" height="610" rx="28" fill="white"/></svg>'),
      blend: "dest-in"
    }])
    .png()
    .toBuffer();
  composites.push({
    input: Buffer.from(`<svg width="430" height="720"><rect x="4" y="4" width="422" height="712" rx="38" fill="${color}" stroke="#d4cec5" stroke-width="2"/><text x="50" y="52" font-family="-apple-system,Helvetica,sans-serif" font-size="22" font-weight="700" fill="#3c3935" letter-spacing="2">${label}</text></svg>`),
    left,
    top
  });
  composites.push({ input: screenshot, left: left + 50, top: top + 76 });
}
composites.unshift({
  input: Buffer.from('<svg width="1720" height="140"><text x="70" y="58" font-family="-apple-system,Helvetica,sans-serif" font-size="42" font-weight="750" fill="#292724">Talk&amp;Talk v0.1</text><text x="70" y="100" font-family="-apple-system,Helvetica,sans-serif" font-size="22" fill="#6a655f" letter-spacing="1">UI4 · PASTEL CARD THEATRE · 31 VERIFIED MINI PROGRAM ROUTES</text></svg>'),
  left: 0,
  top: 24
});
await sharp({ create: { width: overviewWidth, height: overviewHeight, channels: 4, background: "#f8f5ef" } })
  .composite(composites)
  .png({ compressionLevel: 9 })
  .toFile(overviewPath);

const gifPath = resolve(outputRoot, "ui4-motion-demo.gif");
const temporaryFrames = resolve(outputRoot, ".gif-frames");
await rm(temporaryFrames, { recursive: true, force: true });
await mkdir(temporaryFrames, { recursive: true });
const gifFrameSources = ["frame-01.png", "frame-02.png", "frame-03.png", "frame-04.png", "frame-05.png", "settled-a.png"];
const gifFrames = [];
for (const file of gifFrameSources) {
  const output = resolve(temporaryFrames, file);
  await sharp(resolve(dynamicRoot, file))
    .extract({ left: 0, top: 0, width: 762, height: 1312 })
    .resize(390, 671)
    .png()
    .toFile(output);
  gifFrames.push(output);
}
execFileSync("/usr/bin/swift", [
  "-module-cache-path", resolve(tmpdir(), "talktalk-v01-gif-cache"),
  resolve(outputRoot, "build-gif.swift"),
  gifPath,
  ...gifFrames
], { stdio: "inherit" });
await rm(temporaryFrames, { recursive: true, force: true });

const hashes = new Map();
for (const entry of screenEntries) {
  const group = hashes.get(entry.sha256) || [];
  group.push(entry.name);
  hashes.set(entry.sha256, group);
}
const duplicateGroups = [...hashes.values()].filter((group) => group.length > 1);
const overview = await fileRecord(overviewPath);
const gif = await fileRecord(gifPath);
const videoPath = resolve(outputRoot, "talktalk-v0.1-motion-demo.mp4");
const video = {
  file: publicPath(videoPath),
  sha256: await sha256(videoPath),
  bytes: (await stat(videoPath)).size,
  codec: "H.264",
  width: 540,
  height: 928,
  fps: 12,
  frames: 38,
  durationMs: 38 / 12 * 1000,
  hasAudio: false,
  role: "Finite editorial playback of deterministic UI4 entrance samples; not a continuous recording or FPS evidence.",
  sourceFrames: gifFrameSources.map((file) => `artifacts/ui4-visual-evidence/dynamic/home-scene-deal/${file}`)
};
const postFixPath = resolve(outputRoot, "devtools-post-fix-consent.png");
let postFixDevTools = null;
try {
  const verification = JSON.parse(await readFile(resolve(outputRoot, "post-fix-devtools.json"), "utf8"));
  postFixDevTools = await fileRecord(postFixPath);
  postFixDevTools.usage = "Official post-fix DevTools simulator evidence; not a README hero.";
  postFixDevTools.verification = "artifacts/v0.1/post-fix-devtools.json";
  postFixDevTools.sourceDigest = verification.sourceDigest;
  postFixDevTools.sourceSelectorWarningCount = verification.sourceSelectorWarningCount;
} catch {}

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  capture: {
    tool: "WeChat DevTools App.captureScreenshot via miniprogram-automator",
    devtools: matrixManifest.devtools,
    simulator: matrixManifest.simulator,
    fixture: "anonymous consent for route 01; legal-only fail-closed for routes 02-31",
    realIdentityToken: false,
    realRoleSession: false,
    realOrderOrPaymentData: false,
    localApiStarted: false,
    interpretation: "Real route rendering evidence, not business-flow success."
  },
  routes: screenEntries,
  integrity: {
    routeCount: screenEntries.length,
    uniqueImageCount: hashes.size,
    duplicateGroups
  },
  media: {
    overview: { ...overview, role: "Public overview/contact sheet", sources: tileSources.map(([file]) => `screens/${file}`) },
    gif: {
      ...gif,
      role: "Looping GitHub preview of a finite app entrance; not a continuous recording or FPS evidence.",
      sourceFrames: gifFrameSources.map((file) => `artifacts/ui4-visual-evidence/dynamic/home-scene-deal/${file}`),
      durationMs: 5 * 140 + 1100,
      repeats: "infinite GIF loop"
    },
    video,
    postFixDevTools
  }
};
const galleryColumns = 4;
const gallery = [
  "# Talk&Talk v0.1 · 小程序 31 页",
  "",
  "真实微信开发者工具 390 / light 截图。01 为匿名同意页，02–31 为 legal-only 失败关闭夹具；不是业务成功态。",
  ""
];
for (let offset = 0; offset < screenEntries.length; offset += galleryColumns) {
  const row = screenEntries.slice(offset, offset + galleryColumns);
  while (row.length < galleryColumns) row.push(null);
  gallery.push(`| ${row.map((entry) => entry ? String(entry.index).padStart(2, "0") : "").join(" | ")} |`);
  gallery.push(`| ${row.map(() => ":--:").join(" | ")} |`);
  gallery.push(`| ${row.map((entry) => entry
    ? `<img src="./${entry.file.split("/").at(-1)}" width="180" alt="${entry.name}"><br><sub>${entry.name.replace(/^\d+-/, "")}</sub>`
    : "").join(" | ")} |`);
  gallery.push("");
}
gallery.push("[返回 v0.1 媒体清单](../manifest.json)", "");
await writeFile(resolve(screensRoot, "README.md"), gallery.join("\n"));
await writeFile(resolve(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ routes: screenEntries.length, uniqueImages: hashes.size, duplicateGroups, overview, gif, postFixDevTools }));
