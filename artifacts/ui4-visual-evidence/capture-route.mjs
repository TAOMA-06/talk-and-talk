import { createRequire } from "node:module";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const automatorBase = required("MINIPROGRAM_AUTOMATOR_ROOT");
const port = Number(process.env.MINIPROGRAM_AUTOMATION_PORT || 9422);
const route = required("UI4_ROUTE");
const expectedPath = required("UI4_EXPECTED_PATH").replace(/^\//, "");
const output = resolve(required("UI4_SCREENSHOT_PATH"));
const fixturePath = process.env.UI4_FIXTURE_PATH?.trim() || "";
const waitMs = Math.max(300, Number(process.env.UI4_WAIT_MS || 1_800));
const timeoutMs = Math.max(3_000, Number(process.env.UI4_RPC_TIMEOUT_MS || 15_000));
const automatorRoot = `${automatorBase}/node_modules/miniprogram-automator`;
const MiniProgram = require(`${automatorRoot}/out/MiniProgram.js`).default;
MiniProgram.prototype.checkVersion = async function checkVersionCompatibilityBridge() {};
const automator = require(automatorRoot);

if (!route.startsWith("/pages/")) throw new Error("UI4_ROUTE must start with /pages/");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid automation port");

function delay(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

async function bounded(operation, label, duration = timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${duration}ms`)), duration);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function retry(label, operation, attempts = 3) {
  let lastError;
  for (let index = 1; index <= attempts; index += 1) {
    try {
      return await bounded(operation(), label);
    } catch (error) {
      lastError = error;
      process.stdout.write(`${JSON.stringify({ stage: label, attempt: index, error: String(error?.message || error) })}\n`);
      await delay(500);
    }
  }
  throw lastError;
}

await mkdir(dirname(output), { recursive: true });
const miniProgram = await retry("connect", () => automator.connect({
  wsEndpoint: `ws://127.0.0.1:${port}`
}));

const startedAt = Date.now();
let fixtureLabel = "current-storage";
let result;
try {
  if (fixturePath) {
    const fixture = JSON.parse(await readFile(resolve(fixturePath), "utf8"));
    fixtureLabel = fixture.kind || "local-fixture";
    await retry("clear-storage", () => miniProgram.callWxMethod("clearStorage", {}));
    for (const [key, value] of Object.entries(fixture.storage || {})) {
      await retry(`set-storage:${key}`, () => miniProgram.callWxMethod("setStorage", { key, data: value }));
    }
  }
  const page = await retry("reLaunch", () => miniProgram.reLaunch(route), 2);
  await delay(waitMs);
  const current = await retry("current-page", () => miniProgram.currentPage());
  const actualPath = page?.path || current?.path || "";
  const systemInfo = await retry("system-info", () => miniProgram.systemInfo());
  await retry("scroll-top", () => miniProgram.pageScrollTo(0));
  await unlink(output).catch(() => undefined);
  await retry("screenshot", () => miniProgram.screenshot({ path: output }), 1);
  result = {
    captured: true,
    route,
    expectedPath,
    actualPath,
    routeMatched: actualPath === expectedPath,
    screenshot: output,
    fixture: fixtureLabel,
    durationMs: Date.now() - startedAt,
    simulator: {
      model: systemInfo?.model || null,
      SDKVersion: systemInfo?.SDKVersion || null,
      theme: systemInfo?.theme || null,
      windowWidth: systemInfo?.windowWidth || null,
      windowHeight: systemInfo?.windowHeight || null,
      pixelRatio: systemInfo?.pixelRatio || null
    }
  };
  await writeFile(`${output}.json`, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  miniProgram.disconnect();
}
