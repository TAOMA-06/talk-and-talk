import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.env.MINIPROGRAM_AUTOMATOR_ROOT;
const port = Number(process.env.MINIPROGRAM_AUTOMATION_PORT || 0);
if (!root || !port) throw new Error("automator root and port are required");

const automatorRoot = `${root}/node_modules/miniprogram-automator`;
const MiniProgram = require(`${automatorRoot}/out/MiniProgram.js`).default;
MiniProgram.prototype.checkVersion = async function checkVersionCompatibilityBridge() {};
const automator = require(automatorRoot);
const miniProgram = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${port}` });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const steps = [
  ["switchTab", "/pages/orders/index", 5000],
  ["switchTab", "/pages/messages/index", 5000],
  ["navigateTo", "/pages/notifications/index", 5000],
  ["navigateTo", "/pages/support/index", 6500],
  ["navigateTo", "/pages/crisis/index", 6500],
];

try {
  for (const [method, url, dwell] of steps) {
    await miniProgram.callWxMethod(method, { url });
    await wait(dwell);
  }
  process.stdout.write(JSON.stringify({ chapter: "U0-empty-and-support", completed: true, routes: steps.map(([, url]) => url) }) + "\n");
} finally {
  miniProgram.disconnect();
}
