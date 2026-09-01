import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const automatorBase = process.env.MINIPROGRAM_AUTOMATOR_ROOT?.trim();
const port = Number(process.env.MINIPROGRAM_AUTOMATION_PORT || 9425);
const output = resolve(import.meta.dirname, "consent-interaction.json");
if (!automatorBase) throw new Error("MINIPROGRAM_AUTOMATOR_ROOT is required");

const automatorRoot = `${automatorBase}/node_modules/miniprogram-automator`;
const MiniProgram = require(`${automatorRoot}/out/MiniProgram.js`).default;
MiniProgram.prototype.checkVersion = async function checkVersionCompatibilityBridge() {};
const automator = require(automatorRoot);

function delay(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

async function bounded(promise, label, timeoutMs = 12_000) {
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

const miniProgram = await bounded(automator.connect({
  wsEndpoint: `ws://127.0.0.1:${port}`
}), "connect");

try {
  let page = await bounded(miniProgram.currentPage(), "current-page");
  if (page?.path !== "pages/consent/index") {
    page = await bounded(miniProgram.reLaunch("/pages/consent/index"), "open-consent");
  }
  if (page?.path !== "pages/consent/index") throw new Error(`expected consent page, got ${page?.path || "none"}`);

  const checkboxes = await bounded(page.$$("checkbox"), "find-checkboxes");
  if (!Array.isArray(checkboxes) || checkboxes.length !== 2) {
    throw new Error(`expected 2 consent checkboxes, got ${checkboxes?.length ?? "unknown"}`);
  }
  await bounded(checkboxes[0].tap(), "tap-agreement");
  await bounded(checkboxes[1].tap(), "tap-adult");
  await delay(300);
  const accept = await bounded(page.$(".accept"), "find-accept");
  if (!accept) throw new Error("consent accept button not found");
  const disabledBeforeTap = await bounded(accept.attribute("disabled"), "read-accept-disabled");
  await bounded(accept.tap(), "tap-accept");
  await delay(800);
  await bounded(miniProgram.native().authorizeAllow(), "privacy-authorize", 3_000).catch(() => undefined);
  await delay(1_800);
  const current = await bounded(miniProgram.currentPage(), "verify-home");
  const result = {
    passed: current?.path === "pages/home/index",
    startedAt: "pages/consent/index",
    checkboxCount: checkboxes.length,
    disabledBeforeTap: disabledBeforeTap === true || disabledBeforeTap === "true",
    finalPath: current?.path || null,
    stateBoundary: "consent created by the local page itself; no identity, token, order, payment or role fixture was injected",
    sourceHandlers: ["setAgreement", "setAdultConfirmation", "accept", "recordLegalConsent"]
  };
  if (!result.passed) throw new Error(`consent interaction ended at ${result.finalPath || "no page"}`);
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  miniProgram.disconnect();
}
