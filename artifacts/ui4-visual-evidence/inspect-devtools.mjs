import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const automatorBase = process.env.MINIPROGRAM_AUTOMATOR_ROOT?.trim();
const port = Number(process.env.MINIPROGRAM_AUTOMATION_PORT || 9421);

if (!automatorBase) throw new Error("MINIPROGRAM_AUTOMATOR_ROOT is required");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("MINIPROGRAM_AUTOMATION_PORT must be a valid TCP port");
}

const automatorRoot = `${automatorBase}/node_modules/miniprogram-automator`;
const MiniProgram = require(`${automatorRoot}/out/MiniProgram.js`).default;
MiniProgram.prototype.checkVersion = async function checkVersionCompatibilityBridge() {};
const automator = require(automatorRoot);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attempt(label, operation, count = 4) {
  let lastError;
  for (let index = 1; index <= count; index += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      process.stdout.write(`${JSON.stringify({ label, attempt: index, error: String(error?.message || error) })}\n`);
      await delay(1_500);
    }
  }
  throw lastError;
}

const miniProgram = await attempt("connect", () => automator.connect({
  wsEndpoint: `ws://127.0.0.1:${port}`
}));

try {
  const systemInfo = await attempt("getSystemInfoSync", () => miniProgram.callWxMethod("getSystemInfoSync"));
  const currentPage = await attempt("currentPage", () => miniProgram.currentPage());
  process.stdout.write(`${JSON.stringify({
    connected: true,
    port,
    currentPath: currentPage?.path || null,
    systemInfo: {
      model: systemInfo?.model || null,
      system: systemInfo?.system || null,
      platform: systemInfo?.platform || null,
      SDKVersion: systemInfo?.SDKVersion || null,
      theme: systemInfo?.theme || null,
      windowWidth: systemInfo?.windowWidth || null,
      windowHeight: systemInfo?.windowHeight || null,
      pixelRatio: systemInfo?.pixelRatio || null
    }
  }, null, 2)}\n`);
} finally {
  miniProgram.disconnect();
}
