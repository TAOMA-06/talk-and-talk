import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repo = resolve(here, "../..");
const configuredSourceManifest = process.env.UI_REVIEW_SOURCE_MANIFEST?.trim();
const configuredSourceRoot = process.env.UI_REVIEW_SOURCE_ROOT?.trim();
const sourceManifestPath = configuredSourceManifest
  ? resolve(configuredSourceManifest)
  : resolve(repo, "artifacts/v0.1/manifest.json");
const sourceRoot = configuredSourceRoot ? resolve(configuredSourceRoot) : repo;
const reviewRoot = resolve(repo, "artifacts/v0.1/direct-open-miniprogram");
const markerPath = resolve(reviewRoot, ".talkandtalk-ui-review");
const assetsRoot = resolve(reviewRoot, "assets/screens");
const dataRoot = resolve(reviewRoot, "data");
const sourceManifest = JSON.parse(await readFile(sourceManifestPath, "utf8"));
const { default: sharp } = await import(resolve(repo, "frontend/web/node_modules/sharp/dist/index.mjs"));

const display = [
  ["首次同意", "core"], ["首页", "core"], ["发现", "core"], ["广场", "core"],
  ["订单中心", "orders"], ["订单详情", "orders"], ["支付确认", "orders"], ["评价与售后", "orders"],
  ["订单争议", "orders"], ["消息", "core"], ["通知", "account"], ["我的", "core"],
  ["账户与隐私", "account"], ["成年资格", "account"], ["注销状态", "account"], ["安全中心", "safety"],
  ["紧急帮助", "safety"], ["客服中心", "safety"], ["客服详情", "safety"], ["陪伴者详情", "core"],
  ["陪伴者工作台", "companion"], ["陪伴者入驻", "companion"], ["排班管理", "companion"], ["成长与训练", "companion"],
  ["收益", "companion"], ["陪伴者安全", "companion"], ["服务管理", "companion"], ["可约时间", "companion"],
  ["聊天", "core"], ["语音状态", "core"], ["法律文档", "account"]
];
const tones = ["blue", "apricot", "mint", "lavender", "butter", "rose"];
const groups = [
  { key: "all", label: "全部" },
  { key: "core", label: "核心" },
  { key: "orders", label: "订单" },
  { key: "account", label: "账户" },
  { key: "companion", label: "陪伴者" },
  { key: "safety", label: "安全" }
];

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function pathInside(parent, child) {
  const relation = relative(parent, child);
  return relation === "" || (!relation.startsWith("..") && !relation.startsWith("/") && !relation.startsWith("\\"));
}

await readFile(markerPath, "utf8");
if (!Array.isArray(sourceManifest.routes) || sourceManifest.routes.length !== display.length) {
  throw new Error(`Expected ${display.length} verified source routes`);
}

await rm(assetsRoot, { recursive: true, force: true });
await mkdir(assetsRoot, { recursive: true });
await mkdir(dataRoot, { recursive: true });

const screens = [];
let assetBytes = 0;
for (const [offset, route] of sourceManifest.routes.entries()) {
  const [title, group] = display[offset];
  const sourceFile = route.file || route.screenshotFile;
  if (!sourceFile) throw new Error(`Source screenshot is missing: ${route.name}`);
  const sourcePath = route.file
    ? resolve(repo, route.file)
    : resolve(sourceRoot, basename(sourceFile));
  if (!pathInside(route.file ? repo : sourceRoot, sourcePath)) {
    throw new Error(`Source screenshot escapes its root: ${route.name}`);
  }
  const sourceBuffer = await readFile(sourcePath);
  if (sha256(sourceBuffer) !== route.sha256) throw new Error(`Source screenshot hash mismatch: ${route.file}`);

  const outputName = `${route.name}.jpg`;
  const outputPath = resolve(assetsRoot, outputName);
  await sharp(sourceBuffer)
    .flatten({ background: "#f8f6f1" })
    .resize({ width: 390, withoutEnlargement: true })
    .sharpen({ sigma: 0.45 })
    .jpeg({ quality: 82, mozjpeg: true, chromaSubsampling: "4:4:4" })
    .toFile(outputPath);
  const reviewBuffer = await readFile(outputPath);
  const metadata = await sharp(reviewBuffer).metadata();
  assetBytes += reviewBuffer.length;
  screens.push({
    index: offset + 1,
    number: String(offset + 1).padStart(2, "0"),
    name: route.name,
    title,
    group,
    tone: tones[offset % tones.length],
    route: route.route,
    shortRoute: route.actualPath.replace(/^pages\//, ""),
    image: `/assets/screens/${outputName}`,
    sourceSha256: route.sha256,
    reviewSha256: sha256(reviewBuffer),
    bytes: reviewBuffer.length,
    dimensions: { width: metadata.width, height: metadata.height }
  });
}

const catalog = { groups, screens: screens.map(({ sourceSha256, reviewSha256, bytes, dimensions, ...screen }) => screen) };
await writeFile(resolve(dataRoot, "screens.js"), `module.exports = ${JSON.stringify(catalog, null, 2)};\n`);

const sourceManifestBuffer = await readFile(sourceManifestPath);
if (configuredSourceManifest) {
  const sourceManifestText = `${JSON.stringify(sourceManifest, null, 2)}\n`;
  if (/\/Users\/|\/private\/tmp\//.test(sourceManifestText)) {
    throw new Error("Current-worktree capture manifest contains a private filesystem path");
  }
  await writeFile(resolve(reviewRoot, "SOURCE-CAPTURE-MANIFEST.json"), sourceManifestText);
} else {
  await rm(resolve(reviewRoot, "SOURCE-CAPTURE-MANIFEST.json"), { force: true });
}
const sourceCapture = typeof sourceManifest.capture === "string"
  ? {
      tool: sourceManifest.capture,
      devtools: sourceManifest.devtools,
      simulator: sourceManifest.simulator,
      stateBoundary: sourceManifest.stateBoundary
    }
  : sourceManifest.capture;
await writeFile(resolve(reviewRoot, "REVIEW-MANIFEST.json"), `${JSON.stringify({
  schemaVersion: 1,
  kind: "talk-and-talk-direct-open-ui-review",
  sourceManifest: configuredSourceManifest ? "SOURCE-CAPTURE-MANIFEST.json" : "../manifest.json",
  sourceManifestSha256: sha256(sourceManifestBuffer),
  sourceGeneratedAt: sourceManifest.generatedAt,
  sourceCapture,
  screenCount: screens.length,
  assetBytes,
  networkRequests: 0,
  businessRuntime: false,
  uploadAllowed: false,
  screens
}, null, 2)}\n`);

console.log(`Built direct-open UI review project: ${reviewRoot}`);
console.log(`Screens: ${screens.length}; compressed assets: ${assetBytes} bytes`);
