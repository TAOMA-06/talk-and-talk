import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";

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
const port = Number(required("MINIPROGRAM_AUTOMATION_PORT"));
const expectedTheme = required("UI2_THEME");
const localLegalOrigin = new URL(required("UI2_LOCAL_LEGAL_ORIGIN"));
if (
  localLegalOrigin.protocol !== "http:"
  || !["127.0.0.1", "localhost", "::1"].includes(localLegalOrigin.hostname)
) throw new Error("UI2_LOCAL_LEGAL_ORIGIN must be an HTTP loopback origin");

const localizeConsent = (payload) => {
  const consent = payload.storage?.["talkandtalk.legalConsent"];
  if (!consent) throw new Error("session payload is missing legal consent");
  payload.storage["talkandtalk.legalConsent"] = {
    ...consent,
    privacyUrl: new URL("/legal/privacy.html", localLegalOrigin).toString(),
    termsUrl: new URL("/legal/terms.html", localLegalOrigin).toString()
  };
  return payload;
};

const payloads = {
  customer: localizeConsent(JSON.parse(await readFile(required("UI2_CUSTOMER_SESSION_PAYLOAD"), "utf8"))),
  companion: localizeConsent(JSON.parse(await readFile(required("UI2_COMPANION_SESSION_PAYLOAD"), "utf8")))
};
const routes = JSON.parse(await readFile(required("UI2_ROUTE_MANIFEST_PATH"), "utf8"));
if (!Array.isArray(routes) || routes.length !== 31) throw new Error("UI2_ROUTE_MANIFEST must contain 31 routes");

const miniProgram = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${port}` });
const systemInfo = await miniProgram.systemInfo();
if (systemInfo.theme !== expectedTheme) {
  miniProgram.disconnect();
  throw new Error(`expected simulator theme ${expectedTheme}, got ${systemInfo.theme}`);
}
const input = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
let activeProfile = "";
try {
  for (const [name, route, profile] of routes) {
    if (profile !== activeProfile) {
      await miniProgram.callWxMethod("clearStorageSync");
      if (profile !== "anonymous") {
        for (const [key, value] of Object.entries(payloads[profile].storage)) {
          await miniProgram.callWxMethod("setStorageSync", key, value);
        }
      }
      activeProfile = profile;
    }
    const page = await miniProgram.reLaunch(route);
    await new Promise((resolveWait) => setTimeout(resolveWait, 1800));
    const actualPath = page?.path || (await miniProgram.currentPage())?.path || "";
    const expectedPath = route.split("?", 1)[0].replace(/^\//, "");
    process.stdout.write(`${JSON.stringify({ state: "READY", name, route, profile, actualPath, expectedPath, matches: actualPath === expectedPath })}\n`);
    const command = await input.question("");
    if (command.trim().toLowerCase() === "stop") break;
  }
  process.stdout.write(`${JSON.stringify({ state: "DONE" })}\n`);
} finally {
  input.close();
  miniProgram.disconnect();
}
