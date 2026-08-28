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

try {
  const page = await miniProgram.currentPage();
  if (!page) throw new Error("no current Mini Program page");
  const buttons = await page.$$("button");
  const buttonTexts = [];
  for (const button of buttons.slice(0, 20)) buttonTexts.push(await button.text());
  process.stdout.write(JSON.stringify({ path: page.path, query: page.query, buttonTexts }) + "\n");
} finally {
  miniProgram.disconnect();
}
