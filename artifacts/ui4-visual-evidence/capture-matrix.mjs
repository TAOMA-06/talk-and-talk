import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const automatorBase = process.env.MINIPROGRAM_AUTOMATOR_ROOT?.trim();
const port = Number(process.env.MINIPROGRAM_AUTOMATION_PORT || 9428);
const waitMs = Math.max(400, Number(process.env.UI4_WAIT_MS || 900));
const expectedTheme = process.env.UI4_THEME?.trim() || "light";
const expectedWidth = Number(process.env.UI4_DEVICE_WIDTH || 390);
const outputRoot = resolve(import.meta.dirname, "matrix", String(expectedWidth), expectedTheme);
const legalFixture = JSON.parse(await readFile(resolve(import.meta.dirname, "fixture-legal-only.json"), "utf8"));
const emptyFixture = JSON.parse(await readFile(resolve(import.meta.dirname, "fixture-empty-storage.json"), "utf8"));
const routes = JSON.parse(await readFile(resolve(import.meta.dirname, "../ui2-visual-evidence/routes.ui2.json"), "utf8"));
if (!automatorBase) throw new Error("MINIPROGRAM_AUTOMATOR_ROOT is required");

const automatorRoot = `${automatorBase}/node_modules/miniprogram-automator`;
const MiniProgram = require(`${automatorRoot}/out/MiniProgram.js`).default;
MiniProgram.prototype.checkVersion = async function checkVersionCompatibilityBridge() {};
const automator = require(automatorRoot);

function delay(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

async function bounded(promise, label, timeoutMs = 18_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function pngDimensions(buffer) {
  if (buffer.subarray(1, 4).toString("ascii") !== "PNG") throw new Error("invalid PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function resetToFixture(miniProgram, fixture) {
  await bounded(miniProgram.callWxMethod("clearStorage", {}), "clear-storage");
  for (const [key, data] of Object.entries(fixture.storage)) {
    await bounded(miniProgram.callWxMethod("setStorage", { key, data }), `set-storage:${key}`);
  }
}

await mkdir(outputRoot, { recursive: true });
const connect = () => bounded(automator.connect({
  wsEndpoint: `ws://127.0.0.1:${port}`
}), "connect");
let miniProgram = await connect();
const results = [];
let systemInfo;

try {
  systemInfo = await bounded(miniProgram.systemInfo(), "system-info");
  if (systemInfo?.theme !== expectedTheme || Number(systemInfo?.windowWidth) !== expectedWidth) {
    throw new Error(`simulator mismatch: expected ${expectedWidth}/${expectedTheme}, got ${systemInfo?.windowWidth}/${systemInfo?.theme}`);
  }

  for (const [routeIndex, [name, route, profileTarget]] of routes.entries()) {
    // Current DevTools builds gradually stop answering screenshot RPCs when a
    // single automation connection captures a long route list. Reconnect in
    // bounded batches without restarting the simulator or mutating its device.
    if (routeIndex > 0 && routeIndex % 6 === 0) {
      miniProgram.disconnect();
      await delay(350);
      miniProgram = await connect();
    }
    const startedAt = Date.now();
    const expectedPath = route.split("?", 1)[0].replace(/^\//, "");
    let actualPath = "";
    let outcome = "captured";
    let error = "";
    let screenshotFile = "";
    let sha256 = "";
    let dimensions = null;
    try {
      await resetToFixture(miniProgram, name === "01-consent" ? emptyFixture : legalFixture);
      const page = await bounded(miniProgram.reLaunch(route), `${name}:reLaunch`, 22_000);
      await delay(waitMs);
      const current = await bounded(miniProgram.currentPage(), `${name}:current-page`);
      actualPath = page?.path || current?.path || "";
      await bounded(miniProgram.pageScrollTo(0), `${name}:scroll-top`);
      screenshotFile = `${name}.png`;
      const screenshotPath = resolve(outputRoot, screenshotFile);
      await unlink(screenshotPath).catch(() => undefined);
      await bounded(miniProgram.screenshot({ path: screenshotPath }), `${name}:screenshot`, 25_000);
      const buffer = await readFile(screenshotPath);
      sha256 = createHash("sha256").update(buffer).digest("hex");
      dimensions = pngDimensions(buffer);
      if (actualPath !== expectedPath) outcome = "redirected";
    } catch (captureError) {
      outcome = "failed";
      error = String(captureError?.message || captureError);
    }
    const result = {
      name,
      route,
      profileTarget,
      expectedPath,
      actualPath,
      outcome,
      error,
      screenshotFile,
      sha256,
      dimensions,
      durationMs: Date.now() - startedAt
    };
    results.push(result);
    process.stdout.write(`${JSON.stringify({ name, outcome, actualPath, durationMs: result.durationMs })}\n`);
  }
} finally {
  miniProgram.disconnect();
}

const manifest = {
  generatedAt: new Date().toISOString(),
  capture: "WeChat DevTools App.captureScreenshot via miniprogram-automator",
  devtools: "Stable 2.01.2510290",
  simulator: {
    model: systemInfo?.model || null,
    SDKVersion: systemInfo?.SDKVersion || null,
    theme: systemInfo?.theme || null,
    windowWidth: systemInfo?.windowWidth || null,
    windowHeight: systemInfo?.windowHeight || null,
    pixelRatio: systemInfo?.pixelRatio || null
  },
  stateBoundary: {
    fixtures: {
      consent: "fixture-empty-storage.json",
      allOtherRoutes: "fixture-legal-only.json"
    },
    resetBeforeEveryRoute: true,
    realIdentityToken: false,
    realRoleSession: false,
    realOrderOrPaymentData: false,
    localApiStarted: false,
    interpretation: "actual local route and fail-closed rendering evidence; not real business-flow success"
  },
  routes: results
};
await writeFile(resolve(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const summary = {
  outputRoot,
  captured: results.filter((item) => item.outcome === "captured").length,
  redirected: results.filter((item) => item.outcome === "redirected").length,
  failed: results.filter((item) => item.outcome === "failed").length,
  uniqueImages: new Set(results.map((item) => item.sha256).filter(Boolean)).size
};
process.stdout.write(`${JSON.stringify(summary)}\n`);
if (summary.failed) process.exitCode = 1;
