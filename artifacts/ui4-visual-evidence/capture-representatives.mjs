import { createRequire } from "node:module";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const automatorBase = process.env.MINIPROGRAM_AUTOMATOR_ROOT?.trim();
const port = Number(process.env.MINIPROGRAM_AUTOMATION_PORT || 9426);
const waitMs = Math.max(500, Number(process.env.UI4_WAIT_MS || 2_200));
const outputRoot = resolve(import.meta.dirname, "representative");
const fixture = JSON.parse(await readFile(resolve(import.meta.dirname, "fixture-legal-only.json"), "utf8"));
if (!automatorBase) throw new Error("MINIPROGRAM_AUTOMATOR_ROOT is required");

const automatorRoot = `${automatorBase}/node_modules/miniprogram-automator`;
const MiniProgram = require(`${automatorRoot}/out/MiniProgram.js`).default;
MiniProgram.prototype.checkVersion = async function checkVersionCompatibilityBridge() {};
const automator = require(automatorRoot);

const routes = [
  ["01-consent-empty", "/pages/consent/index"],
  ["02-home-listening-lounge", "/pages/home/index"],
  ["03-discover-garden", "/pages/discover/index"],
  ["10-messages-post-office", "/pages/messages/index"],
  ["20-companion-detail", "/pages/companion/detail?id=c1"],
  ["07-payment-fail-closed", "/pages/order/payment?orderId=ui4-no-real-order"],
  ["16-safety", "/pages/safety/index"],
  ["17-crisis", "/pages/crisis/index"],
  ["21-workbench-fail-closed", "/pages/companion/workbench/index"],
  ["30-voice-text-only", "/pages/voice/index?orderId=ui4-no-real-order"]
];

function delay(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

async function bounded(promise, label, timeoutMs = 15_000) {
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

async function resetToFixture(miniProgram) {
  await bounded(miniProgram.callWxMethod("clearStorage", {}), "clear-storage");
  for (const [key, data] of Object.entries(fixture.storage)) {
    await bounded(miniProgram.callWxMethod("setStorage", { key, data }), `set-storage:${key}`);
  }
}

await mkdir(outputRoot, { recursive: true });
const miniProgram = await bounded(automator.connect({
  wsEndpoint: `ws://127.0.0.1:${port}`
}), "connect");
const results = [];

try {
  const systemInfo = await bounded(miniProgram.systemInfo(), "system-info");
  for (const [name, route] of routes) {
    const startedAt = Date.now();
    let outcome = "captured";
    let actualPath = "";
    let error = "";
    try {
      if (name === "01-consent-empty") {
        await bounded(miniProgram.callWxMethod("clearStorage", {}), `${name}:clear-storage`);
      } else {
        await resetToFixture(miniProgram);
      }
      const page = await bounded(miniProgram.reLaunch(route), `${name}:reLaunch`, 20_000);
      await delay(waitMs);
      const current = await bounded(miniProgram.currentPage(), `${name}:current-page`);
      actualPath = page?.path || current?.path || "";
      await bounded(miniProgram.pageScrollTo(0), `${name}:scroll-top`);
      const screenshot = resolve(outputRoot, `${name}-light-390.png`);
      await unlink(screenshot).catch(() => undefined);
      await bounded(miniProgram.screenshot({ path: screenshot }), `${name}:screenshot`, 25_000);
      const expectedPath = route.split("?", 1)[0].replace(/^\//, "");
      if (actualPath !== expectedPath) outcome = "redirected";
    } catch (captureError) {
      outcome = "failed";
      error = String(captureError?.message || captureError);
    }
    const result = {
      name,
      route,
      expectedPath: route.split("?", 1)[0].replace(/^\//, ""),
      actualPath,
      outcome,
      error,
      durationMs: Date.now() - startedAt
    };
    results.push(result);
    process.stdout.write(`${JSON.stringify(result)}\n`);
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
      fixture: "fixture-legal-only.json",
      realIdentityToken: false,
      realRoleSession: false,
      apiStarted: false,
      interpretation: "local route and fail-closed visual evidence only; not real login, payment, role or business-flow success"
    },
    routes: results
  };
  await writeFile(resolve(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
} finally {
  miniProgram.disconnect();
}

const summary = {
  captured: results.filter((item) => item.outcome === "captured").length,
  redirected: results.filter((item) => item.outcome === "redirected").length,
  failed: results.filter((item) => item.outcome === "failed").length
};
process.stdout.write(`${JSON.stringify(summary)}\n`);
if (summary.failed) process.exitCode = 1;
