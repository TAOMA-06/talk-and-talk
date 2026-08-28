import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const automatorRoot = `${required("MINIPROGRAM_AUTOMATOR_ROOT")}/node_modules/miniprogram-automator`;
const MiniProgram = require(`${automatorRoot}/out/MiniProgram.js`).default;
MiniProgram.prototype.checkVersion = async function checkVersionCompatibilityBridge() {};
const automator = require(automatorRoot);
const payload = JSON.parse(await readFile(`${required("DEMO_RUNTIME_DIR")}/devtools-storage-payload.json`, "utf8"));
const port = Number(required("MINIPROGRAM_AUTOMATION_PORT"));
const miniProgram = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${port}` });
try {
  for (const [key, value] of Object.entries(payload.storage)) {
    await miniProgram.callWxMethod("setStorageSync", key, value);
  }
  process.stdout.write(JSON.stringify({ injected: Object.keys(payload.storage), secretsPrinted: false }) + "\n");
} finally {
  miniProgram.disconnect();
}
