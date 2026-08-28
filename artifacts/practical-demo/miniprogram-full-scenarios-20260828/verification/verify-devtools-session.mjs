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
  const results = {};
  for (const [key, expected] of Object.entries(payload.storage)) {
    const actual = await miniProgram.callWxMethod("getStorageSync", key);
    results[key] = JSON.stringify(actual) === JSON.stringify(expected);
  }
  process.stdout.write(JSON.stringify({ matches: results, allMatch: Object.values(results).every(Boolean), secretsPrinted: false }) + "\n");
} finally {
  miniProgram.disconnect();
}
