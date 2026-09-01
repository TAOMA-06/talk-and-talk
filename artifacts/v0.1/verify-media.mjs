import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repo = resolve(here, "../..");
const root = resolve(repo, "artifacts/v0.1");
const manifestPath = resolve(root, "manifest.json");
const manifestText = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(manifestText);
const app = JSON.parse(await readFile(resolve(repo, "frontend/miniprogram/app.json"), "utf8"));
const { default: sharp } = await import(resolve(repo, "frontend/web/node_modules/sharp/dist/index.mjs"));

const forbidden = [/\/Users\/taoma/i, /\/var\/folders/i, /\/private\/tmp/i, /ERR_CONNECTION_REFUSED/i];
for (const pattern of forbidden) {
  if (pattern.test(manifestText)) throw new Error(`public manifest contains forbidden value: ${pattern}`);
}
if (manifest.routes.length !== 31 || manifest.routes.length !== app.pages.length) throw new Error("route count mismatch");
const routes = new Set();
const files = new Set();
const hashes = new Map();
for (const [index, entry] of manifest.routes.entries()) {
  if (entry.actualPath !== app.pages[index] || entry.route.split("?", 1)[0].replace(/^\//, "") !== app.pages[index]) {
    throw new Error(`route mismatch at ${entry.name}`);
  }
  if (routes.has(entry.actualPath) || files.has(entry.file)) throw new Error(`duplicate mapping at ${entry.name}`);
  routes.add(entry.actualPath);
  files.add(entry.file);
  const path = resolve(repo, entry.file);
  const buffer = await readFile(path);
  const hash = createHash("sha256").update(buffer).digest("hex");
  const metadata = await sharp(buffer).metadata();
  if (hash !== entry.sha256) throw new Error(`sha mismatch: ${entry.file}`);
  if (metadata.width !== entry.dimensions.width || metadata.height !== entry.dimensions.height) throw new Error(`dimensions mismatch: ${entry.file}`);
  const group = hashes.get(hash) || [];
  group.push(entry.name);
  hashes.set(hash, group);
}
const duplicates = [...hashes.values()].filter((group) => group.length > 1);
if (JSON.stringify(duplicates) !== JSON.stringify([["27-companion-services", "28-companion-availability"]])) {
  throw new Error(`unexpected duplicate groups: ${JSON.stringify(duplicates)}`);
}
const galleryText = await readFile(resolve(root, "screens/README.md"), "utf8");
for (const entry of manifest.routes) {
  if (!galleryText.includes(`./${entry.file.split("/").at(-1)}`)) throw new Error(`gallery missing ${entry.name}`);
}
for (const pattern of forbidden) {
  if (pattern.test(galleryText)) throw new Error(`gallery contains forbidden value: ${pattern}`);
}

const overviewPath = resolve(repo, manifest.media.overview.file);
const overview = await sharp(overviewPath).metadata();
if (overview.width !== 1720 || overview.height !== 960) throw new Error("overview dimensions mismatch");
const gifPath = resolve(repo, manifest.media.gif.file);
const gif = await sharp(gifPath, { animated: true }).metadata();
if (gif.format !== "gif" || gif.width !== 390 || gif.pageHeight !== 671 || gif.pages !== 6) throw new Error(`GIF metadata mismatch: ${JSON.stringify(gif)}`);
if ((await stat(gifPath)).size > 15 * 1024 * 1024) throw new Error("GIF exceeds 15 MiB");
const videoPath = resolve(repo, manifest.media.video.file);
const videoBuffer = await readFile(videoPath);
const videoHash = createHash("sha256").update(videoBuffer).digest("hex");
if (videoHash !== manifest.media.video.sha256 || videoBuffer.length !== manifest.media.video.bytes) throw new Error("MP4 integrity mismatch");
for (const box of ["ftyp", "moov", "mdat", "avc1"]) {
  if (!videoBuffer.includes(Buffer.from(box))) throw new Error(`MP4 missing ${box} box or codec marker`);
}
if (manifest.media.video.codec !== "H.264" || manifest.media.video.width !== 540 || manifest.media.video.height !== 928 || manifest.media.video.frames !== 38 || manifest.media.video.hasAudio !== false) {
  throw new Error("MP4 metadata contract mismatch");
}
if (!manifest.media.postFixDevTools) throw new Error("post-fix DevTools evidence is missing");
{
  const postFix = await sharp(resolve(repo, manifest.media.postFixDevTools.file)).metadata();
  const postFixVerification = JSON.parse(await readFile(resolve(repo, manifest.media.postFixDevTools.verification), "utf8"));
  const localCopy = JSON.parse(await readFile(resolve(repo, "artifacts/ui4-visual-evidence/local-copy-verification.json"), "utf8"));
  if (!postFix.width || !postFix.height) throw new Error("post-fix DevTools screenshot cannot be decoded");
  if (!postFixVerification.passed || postFixVerification.sourceSelectorWarningCount !== 0) throw new Error("post-fix DevTools warning check failed");
  if (postFixVerification.sourceDigest !== localCopy.sourceDigest || postFixVerification.localCopyDigest !== localCopy.localDigest) throw new Error("post-fix DevTools digest binding mismatch");
}

console.log(JSON.stringify({
  passed: true,
  routes: manifest.routes.length,
  galleryScreens: manifest.routes.length,
  uniqueImages: hashes.size,
  duplicateGroups: duplicates,
  overview: { width: overview.width, height: overview.height, bytes: (await stat(overviewPath)).size },
  gif: { width: gif.width, height: gif.pageHeight, frames: gif.pages, loop: gif.loop, delayMs: gif.delay, durationMs: manifest.media.gif.durationMs, bytes: (await stat(gifPath)).size },
  video: { width: manifest.media.video.width, height: manifest.media.video.height, frames: manifest.media.video.frames, fps: manifest.media.video.fps, durationMs: manifest.media.video.durationMs, bytes: manifest.media.video.bytes, sha256: manifest.media.video.sha256 },
  postFixDevTools: { present: true, sourceSelectorWarningCount: manifest.media.postFixDevTools.sourceSelectorWarningCount, sourceDigest: manifest.media.postFixDevTools.sourceDigest },
  sanitizedManifest: true
}));
