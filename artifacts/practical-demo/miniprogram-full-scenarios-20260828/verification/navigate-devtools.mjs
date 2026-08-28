import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const route = required("MINIPROGRAM_ROUTE");
if (!route.startsWith("/pages/")) throw new Error("MINIPROGRAM_ROUTE must start with /pages/");

const automatorRoot = `${required("MINIPROGRAM_AUTOMATOR_ROOT")}/node_modules/miniprogram-automator`;
const MiniProgram = require(`${automatorRoot}/out/MiniProgram.js`).default;
MiniProgram.prototype.checkVersion = async function checkVersionCompatibilityBridge() {};
const automator = require(automatorRoot);
const port = Number(required("MINIPROGRAM_AUTOMATION_PORT"));
const miniProgram = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${port}` });

try {
  await miniProgram.reLaunch(route);
  process.stdout.write(JSON.stringify({ route, relaunched: true }) + "\n");
} finally {
  miniProgram.disconnect();
}
