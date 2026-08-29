import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const automatorRoot = `${required("MINIPROGRAM_AUTOMATOR_ROOT")}/node_modules/miniprogram-automator`;
const MiniProgram = require(`${automatorRoot}/out/MiniProgram.js`).default;
MiniProgram.prototype.checkVersion = async function checkVersionCompatibilityBridge() {};
const automator = require(automatorRoot);
const route = required("UI2_ROUTE");
const expectedPath = required("UI2_EXPECTED_PATH").replace(/^\//, "");
const output = resolve(required("UI2_SCREENSHOT_PATH"));
const payloadPath = process.env.UI2_SESSION_PAYLOAD?.trim() || "";
const localLegalOriginValue = process.env.UI2_LOCAL_LEGAL_ORIGIN?.trim() || "";
const setDataValue = process.env.UI2_SET_DATA?.trim() || "";
const callBeforeCapture = process.env.UI2_CALL_BEFORE_CAPTURE?.trim() || "";
const callAfterCapture = process.env.UI2_CALL_AFTER_CAPTURE?.trim() || "";
const waitMs = Math.max(500, Number(process.env.UI2_WAIT_MS || 1800));
if (!route.startsWith("/pages/")) throw new Error("UI2_ROUTE must start with /pages/");
const progress = (stage) => process.stdout.write(`${JSON.stringify({ stage })}\n`);
const bounded = async (promise, label, timeoutMs = 15_000) => {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

await mkdir(dirname(output), { recursive: true });
const miniProgram = await bounded(automator.connect({
  wsEndpoint: `ws://127.0.0.1:${Number(required("MINIPROGRAM_AUTOMATION_PORT"))}`
}), "connect");
progress("connected");
try {
  if (payloadPath) {
    const payload = JSON.parse(await readFile(payloadPath, "utf8"));
    if (!localLegalOriginValue) throw new Error("UI2_LOCAL_LEGAL_ORIGIN is required with a session payload");
    const localLegalOrigin = new URL(localLegalOriginValue);
    if (
      localLegalOrigin.protocol !== "http:"
      || !["127.0.0.1", "localhost", "::1"].includes(localLegalOrigin.hostname)
    ) throw new Error("UI2_LOCAL_LEGAL_ORIGIN must be an HTTP loopback origin");
    const consent = payload.storage?.["talkandtalk.legalConsent"];
    if (!consent) throw new Error("session payload is missing legal consent");
    payload.storage["talkandtalk.legalConsent"] = {
      ...consent,
      privacyUrl: new URL("/legal/privacy.html", localLegalOrigin).toString(),
      termsUrl: new URL("/legal/terms.html", localLegalOrigin).toString()
    };
    await miniProgram.callWxMethod("clearStorageSync");
    for (const [key, value] of Object.entries(payload.storage)) {
      await miniProgram.callWxMethod("setStorageSync", key, value);
    }
    progress("session-injected");
  }
  const page = await bounded(miniProgram.reLaunch(route), "reLaunch");
  progress("route-loaded");
  await new Promise((resolveWait) => setTimeout(resolveWait, waitMs));
  if (setDataValue) await page.setData(JSON.parse(setDataValue));
  if (callBeforeCapture) await page.callMethod(callBeforeCapture);
  if (setDataValue || callBeforeCapture) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 700));
    progress("state-prepared");
  }
  const actualPath = page?.path || (await miniProgram.currentPage())?.path || "";
  await miniProgram.pageScrollTo(0);
  await bounded(miniProgram.screenshot({ path: output }), "screenshot");
  progress("screenshot-written");
  if (actualPath !== expectedPath) throw new Error(`expected ${expectedPath}, got ${actualPath || "no page"}`);
  if (callAfterCapture) {
    await page.callMethod(callAfterCapture);
    await new Promise((resolveWait) => setTimeout(resolveWait, 700));
  }
  process.stdout.write(`${JSON.stringify({
    route,
    actualPath,
    output,
    statePrepared: Boolean(setDataValue || callBeforeCapture),
    callAfterCapture: callAfterCapture || null
  })}\n`);
} finally {
  miniProgram.disconnect();
}
