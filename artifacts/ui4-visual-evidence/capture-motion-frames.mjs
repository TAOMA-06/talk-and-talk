import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const automatorBase = process.env.MINIPROGRAM_AUTOMATOR_ROOT?.trim();
const port = Number(process.env.MINIPROGRAM_AUTOMATION_PORT || 9427);
const outputRoot = resolve(import.meta.dirname, "dynamic");
const fixture = JSON.parse(await readFile(resolve(import.meta.dirname, "fixture-legal-only.json"), "utf8"));
if (!automatorBase) throw new Error("MINIPROGRAM_AUTOMATOR_ROOT is required");

const automatorRoot = `${automatorBase}/node_modules/miniprogram-automator`;
const MiniProgram = require(`${automatorRoot}/out/MiniProgram.js`).default;
MiniProgram.prototype.checkVersion = async function checkVersionCompatibilityBridge() {};
const automator = require(automatorRoot);

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

function dimensions(buffer) {
  if (buffer.subarray(1, 4).toString("ascii") !== "PNG") throw new Error("invalid PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function screenshot(miniProgram, path, startedAt, label) {
  await unlink(path).catch(() => undefined);
  const beforeCaptureMs = Date.now() - startedAt;
  await bounded(miniProgram.screenshot({ path }), `${label}:screenshot`, 25_000);
  const buffer = await readFile(path);
  return {
    file: path.replace(`${resolve(import.meta.dirname)}/`, ""),
    beforeCaptureMs,
    completedAtMs: Date.now() - startedAt,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    dimensions: dimensions(buffer)
  };
}

async function resetToFixture(miniProgram) {
  await bounded(miniProgram.callWxMethod("clearStorage", {}), "clear-storage");
  for (const [key, data] of Object.entries(fixture.storage)) {
    await bounded(miniProgram.callWxMethod("setStorage", { key, data }), `set-storage:${key}`);
  }
}

async function captureSequence(miniProgram, name, route, leadRoute) {
  await resetToFixture(miniProgram);
  await bounded(miniProgram.reLaunch(leadRoute), `${name}:lead-route`, 20_000);
  await delay(600);

  const directory = resolve(outputRoot, name);
  await mkdir(directory, { recursive: true });
  const startedAt = Date.now();
  await bounded(miniProgram.callWxMethod("reLaunch", { url: route }), `${name}:navigate`);
  const frames = [];
  const waits = [0, 100, 180, 280, 500];
  for (let index = 0; index < waits.length; index += 1) {
    if (waits[index]) await delay(waits[index]);
    frames.push(await screenshot(
      miniProgram,
      resolve(directory, `frame-${String(index + 1).padStart(2, "0")}.png`),
      startedAt,
      `${name}:frame-${index + 1}`
    ));
  }
  await delay(1_200);
  const settledA = await screenshot(miniProgram, resolve(directory, "settled-a.png"), startedAt, `${name}:settled-a`);
  await delay(1_200);
  const settledB = await screenshot(miniProgram, resolve(directory, "settled-b.png"), startedAt, `${name}:settled-b`);
  const current = await bounded(miniProgram.currentPage(), `${name}:current-page`);
  return {
    name,
    route,
    actualPath: current?.path || "",
    frames,
    uniqueEntranceFrames: new Set(frames.map((frame) => frame.sha256)).size,
    settled: {
      first: settledA,
      second: settledB,
      identical: settledA.sha256 === settledB.sha256
    }
  };
}

await mkdir(outputRoot, { recursive: true });
const miniProgram = await bounded(automator.connect({
  wsEndpoint: `ws://127.0.0.1:${port}`
}), "connect");
let sequences;
try {
  const systemInfo = await bounded(miniProgram.systemInfo(), "system-info");
  sequences = [
    await captureSequence(miniProgram, "home-scene-deal", "/pages/home/index", "/pages/messages/index"),
    await captureSequence(miniProgram, "discover-stage", "/pages/discover/index", "/pages/home/index")
  ];
  const manifest = {
    generatedAt: new Date().toISOString(),
    capture: "deterministic WeChat DevTools screenshot frame sequence",
    systemInfo: {
      model: systemInfo?.model || null,
      SDKVersion: systemInfo?.SDKVersion || null,
      theme: systemInfo?.theme || null,
      windowWidth: systemInfo?.windowWidth || null,
      windowHeight: systemInfo?.windowHeight || null
    },
    fixture: "legal-only; no real identity/token/role/order/payment data",
    interactionBoundary: "route transition and finite stage entrance; separate interaction evidence covers back-card selection, filter apply and live AppService motionOff",
    sequences
  };
  await writeFile(resolve(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    sequences: sequences.map((sequence) => ({
      name: sequence.name,
      actualPath: sequence.actualPath,
      uniqueEntranceFrames: sequence.uniqueEntranceFrames,
      settledIdentical: sequence.settled.identical
    }))
  })}\n`);
} finally {
  miniProgram.disconnect();
}
