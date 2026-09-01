import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const automatorBase = process.env.MINIPROGRAM_AUTOMATOR_ROOT?.trim();
const port = Number(process.env.MINIPROGRAM_AUTOMATION_PORT || 9423);
if (!automatorBase) throw new Error("MINIPROGRAM_AUTOMATOR_ROOT is required");

const automatorRoot = `${automatorBase}/node_modules/miniprogram-automator`;
const MiniProgram = require(`${automatorRoot}/out/MiniProgram.js`).default;
MiniProgram.prototype.checkVersion = async function checkVersionCompatibilityBridge() {};
const automator = require(automatorRoot);

function bounded(promise, label, timeoutMs = 10_000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

const miniProgram = await bounded(automator.connect({
  wsEndpoint: `ws://127.0.0.1:${port}`
}), "connect");

try {
  const state = await bounded(miniProgram.evaluate(() => {
    const info = wx.getStorageInfoSync();
    const legal = wx.getStorageSync("talkandtalk.legalConsent");
    return {
      keys: info.keys,
      hasAccessToken: info.keys.includes("talkandtalk.accessToken"),
      hasRefreshToken: info.keys.includes("talkandtalk.refreshToken"),
      hasUser: info.keys.includes("talkandtalk.user"),
      legalConsent: legal ? {
        version: legal.version,
        source: legal.source,
        adultConfirmed: legal.adultConfirmed === true,
        privacyAccepted: legal.privacyAccepted === true,
        termsAccepted: legal.termsAccepted === true
      } : null
    };
  }), "inspect-storage");
  process.stdout.write(`${JSON.stringify({ port, state }, null, 2)}\n`);
} finally {
  miniProgram.disconnect();
}
