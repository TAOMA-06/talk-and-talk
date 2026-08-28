import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function poll(label, callback, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await callback();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ""}`);
}

async function saveJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

const phase = process.argv[2];
if (!new Set(["create", "resolved"]).has(phase)) {
  throw new Error("Usage: node miniprogram-flow.mjs <create|resolved>");
}

const automatorRoot = `${required("MINIPROGRAM_AUTOMATOR_ROOT")}/node_modules/miniprogram-automator`;
// DevTools 1.06.2603281 does not return the optional SDK version string that
// miniprogram-automator 0.12.1 compares after connecting. Skip only that
// compatibility comparison; every navigation, element action, API request and
// screenshot below still runs through the official live automation channel.
const MiniProgram = require(`${automatorRoot}/out/MiniProgram.js`).default;
MiniProgram.prototype.checkVersion = async function checkVersionCompatibilityBridge() {};
const automator = require(automatorRoot);
const session = JSON.parse(await readFile(`${required("DEMO_RUNTIME_DIR")}/customer-session.json`, "utf8"));
const projectPath = required("MINIPROGRAM_PROJECT_PATH");
const cliPath = required("MINIPROGRAM_CLI_PATH");
const evidenceOut = required("MINIPROGRAM_EVIDENCE_OUT");
const screenshotDir = required("DEMO_SCREENSHOT_DIR");
const subject = required("DEMO_TICKET_SUBJECT");
const body = required("DEMO_TICKET_BODY");

await mkdir(screenshotDir, { recursive: true });
const automationPort = Number(process.env.MINIPROGRAM_AUTOMATION_PORT || 9420);
let miniProgram;
try {
  miniProgram = await automator.launch({
    cliPath,
    projectPath,
    trustProject: true,
    port: automationPort,
    timeout: 180_000
  });
} catch (error) {
  if (!/Port .* is in use/.test(error.message || "")) throw error;
  miniProgram = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${automationPort}` });
}

try {
  await miniProgram.callWxMethod("setStorageSync", "talkandtalk.accessToken", session.accessToken);
  await miniProgram.callWxMethod("setStorageSync", "talkandtalk.refreshToken", session.refreshToken);
  await miniProgram.callWxMethod("setStorageSync", "talkandtalk.user", session.user);
  await miniProgram.callWxMethod("setStorageSync", "talkandtalk.legalConsent", {
    version: "2.2-2026-08-01",
    acceptedAt: new Date().toISOString(),
    privacyAccepted: true,
    termsAccepted: true,
    adultConfirmed: true,
    privacyUrl: "http://127.0.0.1:3000/legal/privacy.html",
    termsUrl: "http://127.0.0.1:3000/legal/terms.html",
    source: "wechatMiniProgram",
    userId: session.user.id
  });

  if (phase === "create") {
    const page = await miniProgram.reLaunch("/pages/support/index");
    if (!page) throw new Error("Support center page did not open");
    await poll("support center load", async () => {
      const data = await page.data();
      if (data.error) throw new Error(data.error);
      return data.loading === false && data.publicInfoState !== "loading";
    });

    const openButton = await page.$(".hero-button");
    if (!openButton) throw new Error("Submit-new-case button not found");
    await openButton.tap();
    const subjectInput = await poll("subject input", () => page.$(".form-input"));
    const bodyInput = await poll("body textarea", () => page.$(".form-textarea"));
    await subjectInput.input(subject);
    await bodyInput.input(body);
    await poll("form data binding", async () => {
      const data = await page.data();
      return data.subject === subject && data.body === body;
    });
    const formScreenshot = `${screenshotDir}/01-miniprogram-submit-form.png`;
    await miniProgram.screenshot({ path: formScreenshot });

    const submitButton = await page.$(".submit-button");
    if (!submitButton) throw new Error("Create-support-case button not found");
    await submitButton.tap();
    const detailPage = await poll("support detail navigation", async () => {
      const current = await miniProgram.currentPage();
      return current?.path === "pages/support/detail" ? current : null;
    });
    const detailData = await poll("open ticket detail", async () => {
      const data = await detailPage.data();
      if (data.error) throw new Error(data.error);
      return data.loading === false && data.ticket?.status === "open" ? data : null;
    });
    const openScreenshot = `${screenshotDir}/02-miniprogram-open-ticket.png`;
    await miniProgram.screenshot({ path: openScreenshot });
    const evidence = {
      phase,
      generatedAt: new Date().toISOString(),
      driver: "official miniprogram-automator via installed WeChat Developer Tools CLI",
      toolCompatibilityNote: "Skipped automator version-string comparison because this DevTools build returned no optional version value",
      pagePath: detailPage.path,
      ticket: {
        id: detailData.ticket.id,
        status: detailData.ticket.status,
        subjectMatchesFixture: detailData.ticket.subject === subject,
        bodyMatchesFixture: detailData.ticket.body === body,
        statusText: detailData.statusText
      },
      screenshots: ["01-miniprogram-submit-form.png", "02-miniprogram-open-ticket.png"],
      realMiniProgramRuntime: true,
      realWechatLoginValidated: false,
      authBridge: "development phone session injected into DevTools storage"
    };
    await saveJson(evidenceOut, evidence);
    process.stdout.write(`${JSON.stringify({ phase, ticketId: detailData.ticket.id, status: detailData.ticket.status })}\n`);
  } else {
    const preclaim = JSON.parse(await readFile(required("DEMO_PRECLAIM_EVIDENCE"), "utf8"));
    const ticketId = preclaim.ticket.id;
    const detailPage = await miniProgram.reLaunch(`/pages/support/detail?kind=support&id=${encodeURIComponent(ticketId)}`);
    if (!detailPage) throw new Error("Resolved support detail page did not open");
    const detailData = await poll("resolved ticket detail", async () => {
      const data = await detailPage.data();
      if (data.error) throw new Error(data.error);
      return data.loading === false && data.ticket?.status === "resolved" ? data : null;
    });
    const resolvedScreenshot = `${screenshotDir}/07-miniprogram-resolved-ticket.png`;
    await miniProgram.screenshot({ path: resolvedScreenshot });

    const notificationsPage = await miniProgram.reLaunch("/pages/notifications/index");
    if (!notificationsPage) throw new Error("Notification center did not open");
    const notificationsData = await poll("support notification", async () => {
      const data = await notificationsPage.data();
      if (data.error) throw new Error(data.error);
      const item = (data.notifications || []).find((notification) =>
        notification.type === "supportUpdate" && notification.data?.ticketId === ticketId
      );
      return data.loading === false && item ? { data, item } : null;
    });
    const notificationScreenshot = `${screenshotDir}/08-miniprogram-support-notification.png`;
    await miniProgram.screenshot({ path: notificationScreenshot });
    const evidence = {
      phase,
      generatedAt: new Date().toISOString(),
      driver: "official miniprogram-automator via installed WeChat Developer Tools CLI",
      toolCompatibilityNote: "Skipped automator version-string comparison because this DevTools build returned no optional version value",
      ticket: {
        id: detailData.ticket.id,
        status: detailData.ticket.status,
        statusText: detailData.statusText,
        resolutionCode: detailData.ticket.resolutionCode,
        resolutionMatchesFixture: detailData.ticket.resolution === required("DEMO_TICKET_RESOLUTION")
      },
      notification: {
        id: notificationsData.item.id,
        type: notificationsData.item.type,
        title: notificationsData.item.title,
        unread: !notificationsData.item.readAt
      },
      screenshots: ["07-miniprogram-resolved-ticket.png", "08-miniprogram-support-notification.png"],
      realMiniProgramRuntime: true,
      realWechatDeliveryValidated: false
    };
    await saveJson(evidenceOut, evidence);
    process.stdout.write(`${JSON.stringify({ phase, ticketId, status: detailData.ticket.status, notification: true })}\n`);
  }
} finally {
  miniProgram.disconnect();
}
