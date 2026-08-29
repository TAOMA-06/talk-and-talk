import { createRequire } from "node:module";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

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
const theme = required("UI2_THEME");
if (!new Set(["light", "dark"]).has(theme)) throw new Error("UI2_THEME must be light or dark");
const output = resolve(required("UI2_SCREENSHOT_DIR"));
const customerPayloadPath = required("UI2_CUSTOMER_SESSION_PAYLOAD");
const companionPayloadPath = required("UI2_COMPANION_SESSION_PAYLOAD");
const localLegalOrigin = new URL(required("UI2_LOCAL_LEGAL_ORIGIN"));
if (
  localLegalOrigin.protocol !== "http:"
  || !["127.0.0.1", "localhost", "::1"].includes(localLegalOrigin.hostname)
) throw new Error("UI2_LOCAL_LEGAL_ORIGIN must be an HTTP loopback origin");
const legacyOrderId = process.env.UI2_ORDER_ID?.trim() || "";
const orderDetailId = process.env.UI2_ORDER_DETAIL_ID?.trim() || legacyOrderId;
const orderPaymentId = process.env.UI2_ORDER_PAYMENT_ID?.trim() || legacyOrderId;
const orderAftercareId = process.env.UI2_ORDER_AFTERCARE_ID?.trim() || legacyOrderId;
const orderDisputeId = process.env.UI2_ORDER_DISPUTE_ID?.trim() || legacyOrderId;
const conversationId = process.env.UI2_CONVERSATION_ID?.trim() || "";
const supportId = process.env.UI2_SUPPORT_ID?.trim() || "";
const withQuery = (path, key, value) => value ? `${path}?${key}=${encodeURIComponent(value)}` : path;

const routes = [
  ["01-consent", "/pages/consent/index", "anonymous"],
  ["02-home", "/pages/home/index", "customer"],
  ["03-discover", "/pages/discover/index", "customer"],
  ["04-community", "/pages/community/index", "customer"],
  ["05-orders", "/pages/orders/index", "customer"],
  ["06-order-detail", withQuery("/pages/order/detail", "id", orderDetailId), "customer"],
  ["07-order-payment", withQuery("/pages/order/payment", "orderId", orderPaymentId), "customer"],
  ["08-order-aftercare", withQuery("/pages/order/aftercare", "orderId", orderAftercareId), "customer"],
  ["09-order-dispute", withQuery("/pages/order/dispute", "orderId", orderDisputeId), "customer"],
  ["10-messages", "/pages/messages/index", "customer"],
  ["11-notifications", "/pages/notifications/index", "customer"],
  ["12-profile", "/pages/profile/index", "customer"],
  ["13-account", "/pages/account/index", "customer"],
  ["14-adult-eligibility", "/pages/account/adult-eligibility", "customer"],
  ["15-deletion-status", "/pages/account/deletion-status", "customer"],
  // Capture the gated catalog detail before the crisis page creates its
  // deliberate resources-pending test fact.
  ["20-companion-detail", "/pages/companion/detail?id=c1", "customer"],
  ["16-safety", "/pages/safety/index", "customer"],
  ["17-crisis", "/pages/crisis/index", "customer"],
  ["18-support", "/pages/support/index", "customer"],
  ["19-support-detail", withQuery("/pages/support/detail", "id", supportId), "customer"],
  ["21-companion-workbench", "/pages/companion/workbench/index", "companion"],
  ["22-companion-onboarding", "/pages/companion/onboarding/index", "companion"],
  ["23-companion-schedule", "/pages/companion/schedule/index", "companion"],
  ["24-companion-development", "/pages/companion/development/index", "companion"],
  ["25-companion-earnings", "/pages/companion/earnings/index", "companion"],
  ["26-companion-safety", "/pages/companion/safety/index", "companion"],
  ["27-companion-services", "/pages/companion/services/index", "companion"],
  ["28-companion-availability", "/pages/companion/availability/index", "companion"],
  ["29-chat", withQuery("/pages/chat/index", "id", conversationId), "customer"],
  ["30-voice", withQuery("/pages/voice/index", "orderId", orderDetailId), "customer"],
  ["31-legal", "/pages/legal/index?type=privacy", "customer"]
];

function localizeConsent(payload) {
  const consent = payload.storage?.["talkandtalk.legalConsent"];
  if (!consent) throw new Error("session payload is missing legal consent");
  payload.storage["talkandtalk.legalConsent"] = {
    ...consent,
    privacyUrl: new URL("/legal/privacy.html", localLegalOrigin).toString(),
    termsUrl: new URL("/legal/terms.html", localLegalOrigin).toString()
  };
  return payload;
}

const payloads = {
  customer: localizeConsent(JSON.parse(await readFile(customerPayloadPath, "utf8"))),
  companion: localizeConsent(JSON.parse(await readFile(companionPayloadPath, "utf8")))
};

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

await mkdir(output, { recursive: true });
const results = [];
let activeProfile = "";
for (const [name, route, profile] of routes) {
  const startedAt = Date.now();
  let outcome = "captured";
  let actualPath = "";
  let error = "";
  let miniProgram;
  try {
    process.stdout.write(`${JSON.stringify({ name, stage: "starting" })}\n`);
    miniProgram = await bounded(
      automator.connect({ wsEndpoint: `ws://127.0.0.1:${port}` }),
      `${name}:connect`
    );
    if (profile !== activeProfile) {
      await bounded(miniProgram.callWxMethod("clearStorageSync"), `${name}:clear-storage`);
      if (profile !== "anonymous") {
        for (const [key, value] of Object.entries(payloads[profile].storage)) {
          await bounded(miniProgram.callWxMethod("setStorageSync", key, value), `${name}:set-storage`);
        }
      }
      activeProfile = profile;
    }
    const page = await bounded(miniProgram.reLaunch(route), `${name}:reLaunch`, 20_000);
    await new Promise((resolveWait) => setTimeout(resolveWait, 1800));
    actualPath = page?.path || (await bounded(miniProgram.currentPage(), `${name}:current-page`))?.path || "";
    await bounded(miniProgram.pageScrollTo(0), `${name}:scroll-top`);
    const screenshotPath = resolve(output, `${name}.png`);
    await unlink(screenshotPath).catch(() => undefined);
    await bounded(miniProgram.screenshot({ path: screenshotPath }), `${name}:screenshot`);
    if (!actualPath || !route.startsWith(`/${actualPath}`)) outcome = "redirected";
  } catch (captureError) {
    outcome = "failed";
    error = captureError instanceof Error ? captureError.message : String(captureError);
  } finally {
    miniProgram?.disconnect();
  }
  const result = { name, route, profile, theme, outcome, actualPath, error, durationMs: Date.now() - startedAt };
  results.push(result);
  process.stdout.write(`${JSON.stringify({ name, outcome, actualPath, error })}\n`);
  await new Promise((resolveWait) => setTimeout(resolveWait, 150));
}
await writeFile(resolve(output, "manifest.json"), `${JSON.stringify({ theme, capturedAt: new Date().toISOString(), routes: results }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ theme, output, captured: results.filter((item) => item.outcome === "captured").length, redirected: results.filter((item) => item.outcome === "redirected").length, failed: results.filter((item) => item.outcome === "failed").length })}\n`);
