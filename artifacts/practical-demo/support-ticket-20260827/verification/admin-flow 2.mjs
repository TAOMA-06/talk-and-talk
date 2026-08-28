import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { currentTotp } from "./totp.mjs";

const require = createRequire(import.meta.url);
const artifactRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(artifactRoot, "../../..");
const apiRoot = resolve(repoRoot, "backend/api");
const dotenv = require(`${apiRoot}/node_modules/dotenv`);
const { Client } = require(`${apiRoot}/node_modules/pg`);
const { chromium } = require(`${process.env.PLAYWRIGHT_NODE_MODULES}/playwright`);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function databaseUrl(base, databaseName) {
  const url = new URL(base);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function redisUrl(base, databaseNumber) {
  const url = new URL(base);
  url.pathname = `/${databaseNumber}`;
  return url.toString();
}

function base32(bytes) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  let output = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  for (let index = 0; index < bits.length; index += 5) {
    output += alphabet[Number.parseInt(bits.slice(index, index + 5).padEnd(5, "0"), 2)];
  }
  return output;
}

function newCredential(username) {
  return {
    username,
    password: `D!${randomBytes(18).toString("base64url")}9a`,
    totpSecret: base32(randomBytes(20))
  };
}

async function saveJson(path, value, mode) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, mode ? { mode } : undefined);
  if (mode) await chmod(path, mode);
}

async function rawApi(apiBase, path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {})
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, payload };
}

function dataOf(result) {
  if (!result.ok) {
    const error = new Error(result.payload?.error?.message || `HTTP ${result.status}`);
    error.status = result.status;
    error.code = result.payload?.error?.code || "REQUEST_FAILED";
    throw error;
  }
  return result.payload.data ?? result.payload;
}

function assertion(id, pass, evidence, details) {
  return {
    id,
    outcome: pass ? "pass" : "fail",
    evidence,
    ...(details === undefined ? {} : { details })
  };
}

function metadataMatches(value, expected) {
  return Object.entries(expected).every(([key, item]) => value?.[key] === item);
}

async function withDb(connectionString, run) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

function bootstrapStaff(environment, credential, displayName) {
  const result = spawnSync(
    process.execPath,
    [resolve(apiRoot, "dist/src/database/bootstrap-staff.js")],
    {
      cwd: apiRoot,
      env: {
        ...environment,
        STAFF_BOOTSTRAP_USERNAME: credential.username,
        STAFF_BOOTSTRAP_PASSWORD: credential.password,
        STAFF_BOOTSTRAP_TOTP_SECRET: credential.totpSecret,
        STAFF_BOOTSTRAP_ROLE: "support",
        STAFF_BOOTSTRAP_DISPLAY_NAME: displayName
      },
      encoding: "utf8"
    }
  );
  if (result.status !== 0) {
    throw new Error(`Staff bootstrap failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

async function loginStaff(apiBase, credential) {
  return dataOf(await rawApi(apiBase, "/auth/staff/login", {
    method: "POST",
    body: {
      username: credential.username,
      password: credential.password,
      totpCode: currentTotp(credential.totpSecret)
    }
  }));
}

async function fillConfirmation(page) {
  const help = await page.locator("#actionConfirmationHelp").textContent();
  const match = /([A-Z0-9]{1,16})\s*$/.exec(help || "");
  if (!match) throw new Error(`Could not read controlled-action confirmation code from: ${help}`);
  await page.locator("#actionConfirmation").fill(match[1]);
}

async function submitControlledAction(page, responsePath, expectedStatus) {
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().includes(responsePath)
  );
  await page.locator("#actionSubmitButton").click();
  const response = await responsePromise;
  if (response.status() !== expectedStatus) {
    throw new Error(`${responsePath} returned ${response.status()}, expected ${expectedStatus}`);
  }
  await page.locator("#actionDialog").waitFor({ state: "hidden" });
  return response.status();
}

const apiBase = required("DEMO_API_BASE");
const adminOrigin = required("DEMO_ADMIN_ORIGIN");
const databaseName = required("DEMO_DB_NAME");
const redisDatabase = required("DEMO_REDIS_DB");
const runtimeDir = required("DEMO_RUNTIME_DIR");
const screenshotDir = required("DEMO_SCREENSHOT_DIR");
const chromeExecutable = required("CHROME_EXECUTABLE");
const subject = required("DEMO_TICKET_SUBJECT");
const body = required("DEMO_TICKET_BODY");
const resolution = required("DEMO_TICKET_RESOLUTION");

const envFile = dotenv.parse(await readFile(resolve(apiRoot, ".env")));
const dbUrl = databaseUrl(envFile.DATABASE_URL, databaseName);
const demoRedisUrl = redisUrl(envFile.REDIS_URL, redisDatabase);
const backendEnvironment = {
  ...process.env,
  ...envFile,
  DATABASE_URL: dbUrl,
  REDIS_URL: demoRedisUrl,
  NOTIFICATION_DELIVERY_ENABLED: "false"
};

await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
await mkdir(screenshotDir, { recursive: true });

const primaryCredential = newCredential("support.demo");
const observerCredential = newCredential("support.observer.demo");
const bootstrapLog = [
  bootstrapStaff(backendEnvironment, primaryCredential, "演示客服"),
  bootstrapStaff(backendEnvironment, observerCredential, "隔离校验客服")
];

const customerSessionPath = resolve(runtimeDir, "customer-session.json");
let customerSession = JSON.parse(await readFile(customerSessionPath, "utf8"));
if (!customerSession.user?.id) {
  const bootstrap = JSON.parse(await readFile(resolve(artifactRoot, "verification/customer-bootstrap.json"), "utf8"));
  customerSession.user = bootstrap.user;
}
const refreshed = await rawApi(apiBase, "/auth/refresh", {
  method: "POST",
  body: { refreshToken: customerSession.refreshToken }
});
if (refreshed.ok) {
  const refreshedData = dataOf(refreshed);
  customerSession = {
    ...customerSession,
    ...refreshedData,
    user: refreshedData.user || customerSession.user
  };
  await saveJson(customerSessionPath, customerSession, 0o600);
}

let ticket = await withDb(dbUrl, async (client) => {
  const result = await client.query(
    'SELECT * FROM "SupportTicket" WHERE "userId" = $1 AND "subject" = $2 ORDER BY "createdAt" DESC, "id" DESC LIMIT 1',
    [customerSession.user.id, subject]
  );
  return result.rows[0] || null;
});

let createResponseStatus = null;
let createResponse = null;
if (!ticket) {
  const created = await rawApi(apiBase, "/support/tickets", {
    method: "POST",
    token: customerSession.accessToken,
    body: { category: "general", subject, body }
  });
  createResponseStatus = created.status;
  createResponse = dataOf(created);
  ticket = await withDb(dbUrl, async (client) => {
    const result = await client.query('SELECT * FROM "SupportTicket" WHERE "id" = $1', [createResponse.id]);
    return result.rows[0];
  });
}

const browser = await chromium.launch({
  executablePath: chromeExecutable,
  headless: true,
  args: ["--no-first-run", "--no-default-browser-check"]
});
const context = await browser.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const browserConsoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") browserConsoleErrors.push(message.text());
});

let staffSession;
let preclaimEvidence;
let flowEvidence;
try {
  await page.goto(`${adminOrigin}/admin/`, { waitUntil: "domcontentloaded" });
  await page.locator("#loginView").waitFor({ state: "visible" });
  await page.screenshot({ path: resolve(screenshotDir, "01-admin-login.png") });
  await page.locator("#loginUsername").fill(primaryCredential.username);
  await page.locator("#loginPassword").fill(primaryCredential.password);
  await page.locator("#loginTotp").fill(currentTotp(primaryCredential.totpSecret));
  const loginResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith("/api/v1/auth/staff/login")
  );
  await page.locator("#loginButton").click();
  const loginResponse = await loginResponsePromise;
  if (loginResponse.status() !== 201) throw new Error(`Staff UI login returned ${loginResponse.status()}`);
  await page.locator("#portalView").waitFor({ state: "visible" });
  staffSession = await page.evaluate(() => ({
    accessToken: sessionStorage.getItem("talk_and_talk_admin_access_token"),
    refreshToken: sessionStorage.getItem("talk_and_talk_admin_refresh_token"),
    user: JSON.parse(sessionStorage.getItem("talk_and_talk_admin_identity") || "null")
  }));
  await saveJson(resolve(runtimeDir, "staff-session.json"), staffSession, 0o600);

  await page.locator('[data-view-target="support"]').click();
  const claimSelector = `[data-admin-action="claimSupportSelf"][data-id="${ticket.id}"]`;
  await page.locator(claimSelector).waitFor({ state: "visible" });
  const anonymousRow = page.locator("#supportClaimableList article").filter({ has: page.locator(claimSelector) });
  const anonymousText = await anonymousRow.textContent();
  await page.screenshot({ path: resolve(screenshotDir, "02-admin-anonymous-queue.png") });

  const claimable = dataOf(await rawApi(apiBase, "/admin/commercial/support/claimable?page=1&pageSize=50", {
    token: staffSession.accessToken
  }));
  const summary = claimable.items.find((item) => item.id === ticket.id);
  const preclaimDetail = await rawApi(apiBase, `/admin/commercial/support/tickets/${encodeURIComponent(ticket.id)}`, {
    token: staffSession.accessToken
  });
  const creationAudit = await withDb(dbUrl, async (client) => {
    const result = await client.query(
      'SELECT "actorId", "metadata" FROM "AuditLog" WHERE "resourceType" = $1 AND "resourceId" = $2 AND "action" = $3',
      ["supportTicket", ticket.id, "support.ticket_created"]
    );
    return result.rows[0] || null;
  });
  const summaryKeys = summary ? Object.keys(summary).sort() : [];
  const expectedSummaryKeys = ["category", "dueAt", "hasOrder", "id", "priority"];
  const forbiddenSummaryKeys = [
    "userId", "requester", "subject", "body", "orderId", "order", "orderFacts",
    "assignedTo", "assignedToUserId", "resolution", "resolutionCode", "resolvedAt"
  ];
  const preclaimAssertions = [
    assertion("real-api-ticket-created", createResponseStatus === null || createResponseStatus === 201, "real customer API returned 201 or an existing matching fixture was resumed"),
    assertion("ticket-open-and-unassigned", ticket.status === "open" && ticket.assignedToUserId === null, "database ticket is open and unassigned"),
    assertion("requester-response-hides-operations-identities", !createResponse || (!("userId" in createResponse) && !("requester" in createResponse) && !("assignedTo" in createResponse)), "customer create response omits operational identities"),
    assertion("claimable-summary-exact-allowlist", Boolean(summary) && JSON.stringify(summaryKeys) === JSON.stringify(expectedSummaryKeys), "claimable item is the exact five-field summary", { returnedKeys: summaryKeys }),
    assertion("claimable-summary-hides-private-fields", Boolean(summary) && forbiddenSummaryKeys.every((key) => !(key in summary)), "claimable item omits requester, content, order identity, facts, assignment and resolution fields"),
    assertion("anonymous-ui-hides-ticket-content", !anonymousText.includes(subject) && !anonymousText.includes(body) && anonymousText.includes("认领后开放"), "real admin UI renders only anonymous claimable copy"),
    assertion("preclaim-detail-non-probing-404", preclaimDetail.status === 404 && preclaimDetail.payload?.error?.code === "SUPPORT_TICKET_NOT_FOUND", "support detail is unavailable before ownership"),
    assertion("creation-audit-bounded", creationAudit?.actorId === customerSession.user.id && metadataMatches(creationAudit?.metadata, { orderId: null, category: "general", priority: "normal" }) && !("subject" in (creationAudit?.metadata || {})) && !("body" in (creationAudit?.metadata || {})), "creation audit binds actor and bounded metadata without ticket text")
  ];
  preclaimEvidence = {
    generatedAt: new Date().toISOString(),
    phase: "preclaim",
    ticket: { id: ticket.id, status: ticket.status, category: summary?.category, priority: summary?.priority },
    claimableSummary: summary,
    directDetail: { status: preclaimDetail.status, errorCode: preclaimDetail.payload?.error?.code || null },
    screenshot: "screenshots/02-admin-anonymous-queue.png",
    assertions: preclaimAssertions,
    overall: preclaimAssertions.every((item) => item.outcome === "pass") ? "pass" : "fail"
  };
  await saveJson(resolve(artifactRoot, "verification/media-preclaim-assertions.json"), preclaimEvidence);
  if (preclaimEvidence.overall !== "pass") throw new Error("Preclaim acceptance assertions failed");

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#controlledModeButton").click();
  await page.locator("#controlledModeButton").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector("#controlledModeButton")?.getAttribute("aria-pressed") === "true");
  await page.locator(claimSelector).click();
  await page.locator("#actionDialog").waitFor({ state: "visible" });
  await page.screenshot({ path: resolve(screenshotDir, "03-admin-claim-dialog.png") });
  await page.locator("#actionReason").fill("认领演示工单并核对处理边界");
  await fillConfirmation(page);
  const claimStatus = await submitControlledAction(page, `/support/tickets/${ticket.id}/claim`, 201);
  await page.locator(`#supportList [data-admin-detail="support"][data-id="${ticket.id}"]`).waitFor({ state: "visible" });
  await page.screenshot({ path: resolve(screenshotDir, "04-admin-claimed-ticket.png") });

  const observerSession = await loginStaff(apiBase, observerCredential);
  const observerDetail = await rawApi(apiBase, `/admin/commercial/support/tickets/${encodeURIComponent(ticket.id)}`, {
    token: observerSession.accessToken
  });
  const observerClaim = await rawApi(apiBase, `/admin/commercial/support/tickets/${encodeURIComponent(ticket.id)}/claim`, {
    method: "POST",
    token: observerSession.accessToken
  });

  await page.locator(`#supportList [data-admin-detail="support"][data-id="${ticket.id}"]`).click();
  await page.locator("[data-canonical-detail]").waitFor({ state: "visible" });
  const canonicalDetailText = await page.locator("[data-canonical-detail]").textContent();
  await page.screenshot({ path: resolve(screenshotDir, "05-admin-claimed-detail.png") });
  await page.locator("[data-close-admin-detail]").click();
  await page.locator(`[data-admin-action="resolveSupport"][data-id="${ticket.id}"]`).waitFor({ state: "visible" });
  await page.locator(`[data-admin-action="resolveSupport"][data-id="${ticket.id}"]`).click();
  await page.locator("#actionDialog").waitFor({ state: "visible" });
  await page.locator('#actionFields [name="status"]').selectOption("resolved");
  await page.locator('#actionFields [name="resolutionCode"]').selectOption("noRefund");
  await page.locator('#actionFields [name="resolution"]').fill(resolution);
  await page.screenshot({ path: resolve(screenshotDir, "06-admin-resolve-dialog.png") });
  await page.locator("#actionReason").fill("已核对演示工单并提交用户可读结论");
  await fillConfirmation(page);
  const resolveStatus = await submitControlledAction(page, `/support/tickets/${ticket.id}/resolve`, 200);
  await page.locator("#supportList").getByText(subject, { exact: true }).waitFor({ state: "visible" });
  await page.screenshot({ path: resolve(screenshotDir, "07-admin-resolved-ticket.png") });

  const customerDetail = dataOf(await rawApi(apiBase, `/support/tickets/${encodeURIComponent(ticket.id)}`, {
    token: customerSession.accessToken
  }));
  const customerNotifications = dataOf(await rawApi(apiBase, "/notifications?page=1&pageSize=50&unreadOnly=true", {
    token: customerSession.accessToken
  }));
  const publicNotification = customerNotifications.items.find((item) =>
    item.type === "supportUpdate" && item.data?.ticketId === ticket.id
  );
  const finalFacts = await withDb(dbUrl, async (client) => {
    const ticketResult = await client.query('SELECT * FROM "SupportTicket" WHERE "id" = $1', [ticket.id]);
    const auditResult = await client.query(
      'SELECT "id", "action", "actorId", "metadata" FROM "AuditLog" WHERE "resourceType" = $1 AND "resourceId" = $2 ORDER BY "createdAt", "id"',
      ["supportTicket", ticket.id]
    );
    const subjectResult = await client.query(
      'SELECT l."action", r."subjectUserId", r."relationKind" FROM "AuditLog" l JOIN "AuditSubjectReference" r ON r."auditLogId" = l."id" WHERE l."resourceType" = $1 AND l."resourceId" = $2 ORDER BY l."createdAt", l."id", r."subjectUserId"',
      ["supportTicket", ticket.id]
    );
    const notificationResult = await client.query(
      'SELECT n."id", n."userId", n."type", n."title", n."body", n."data", n."eventKey", n."readAt", d."userId" AS "deliveryUserId", d."templateKey", d."status" AS "deliveryStatus", d."attemptCount" FROM "Notification" n LEFT JOIN "NotificationDelivery" d ON d."notificationId" = n."id" WHERE n."eventKey" = $1',
      [`support:${ticket.id}:resolved`]
    );
    return {
      ticket: ticketResult.rows[0],
      audits: auditResult.rows,
      subjects: subjectResult.rows,
      notification: notificationResult.rows[0] || null
    };
  });
  const auditByAction = Object.fromEntries(finalFacts.audits.map((item) => [item.action, item]));
  const expectedAuditActions = ["support.ticket_created", "support.ticket_claimed", "support.ticket_resolved"];
  const auditActions = finalFacts.audits.map((item) => item.action);
  const finalAssertions = [
    assertion("claim-performed-through-real-controlled-ui", claimStatus === 201, "real Chrome submitted the controlled claim action"),
    assertion("postclaim-ui-shows-authorized-detail", canonicalDetailText.includes(subject) && canonicalDetailText.includes(body), "real Chrome canonical detail shows content only after ownership"),
    assertion("other-support-detail-remains-non-probing", observerDetail.status === 404 && observerDetail.payload?.error?.code === "SUPPORT_TICKET_NOT_FOUND", "another support operator receives the same 404 as a missing record"),
    assertion("other-support-cannot-steal-claim", observerClaim.status === 409 && observerClaim.payload?.error?.code === "SUPPORT_TICKET_ALREADY_ASSIGNED", "second compare-and-set claim is rejected"),
    assertion("resolve-performed-through-real-controlled-ui", resolveStatus === 200, "real Chrome submitted the controlled resolution action"),
    assertion("resolved-state-persisted", finalFacts.ticket.status === "resolved" && finalFacts.ticket.assignedToUserId === staffSession.user.id && finalFacts.ticket.resolution === resolution && finalFacts.ticket.resolutionCode === "noRefund" && Boolean(finalFacts.ticket.resolvedAt), "database preserves owner, status, customer-readable result and completion time"),
    assertion("customer-detail-is-resolved-and-operations-private", customerDetail.status === "resolved" && customerDetail.resolution === resolution && customerDetail.resolutionCode === "noRefund" && !("requester" in customerDetail) && !("assignedTo" in customerDetail) && !("userId" in customerDetail), "requester sees result without operations identities"),
    assertion("audit-actions-complete", expectedAuditActions.every((action) => auditActions.includes(action)), "creation, claim and resolution audit rows exist", { actions: auditActions }),
    assertion("claim-audit-bounded", auditByAction["support.ticket_claimed"]?.actorId === staffSession.user.id && metadataMatches(auditByAction["support.ticket_claimed"]?.metadata, { orderLinked: false }), "claim audit binds actor and order-link fact"),
    assertion("resolve-audit-bounded", auditByAction["support.ticket_resolved"]?.actorId === staffSession.user.id && metadataMatches(auditByAction["support.ticket_resolved"]?.metadata, { status: "resolved", orderId: null, resolutionCode: "noRefund" }) && !("resolution" in (auditByAction["support.ticket_resolved"]?.metadata || {})), "resolution audit is bounded and omits customer text"),
    assertion("audit-subject-edges-present", expectedAuditActions.every((action) => finalFacts.subjects.some((item) => item.action === action && item.subjectUserId === customerSession.user.id)), "each controlled audit action has an explicit requester subject edge"),
    assertion("customer-notification-visible", publicNotification?.title === "客服工单已更新" && publicNotification?.data?.status === "resolved" && publicNotification?.readAt === null, "requester notification endpoint returns the unread support update"),
    assertion("notification-and-delivery-intent-durable", finalFacts.notification?.userId === customerSession.user.id && finalFacts.notification?.type === "supportUpdate" && finalFacts.notification?.title === "客服工单已更新" && finalFacts.notification?.body === "你的客服工单已有处理结果，请在订单或消息中心查看。" && finalFacts.notification?.data?.ticketId === ticket.id && finalFacts.notification?.data?.status === "resolved" && finalFacts.notification?.eventKey === `support:${ticket.id}:resolved` && finalFacts.notification?.deliveryUserId === customerSession.user.id && finalFacts.notification?.templateKey === "supportUpdate" && Boolean(finalFacts.notification?.deliveryStatus), "transaction persisted both the inbox row and delivery intent", { deliveryStatus: finalFacts.notification?.deliveryStatus || null, attemptCount: finalFacts.notification?.attemptCount ?? null }),
    assertion("browser-console-clean", browserConsoleErrors.length === 0, "real Chrome emitted no console errors", { errors: browserConsoleErrors })
  ];
  const finalEvidence = {
    generatedAt: new Date().toISOString(),
    phase: "final",
    driver: "Playwright with installed Google Chrome; exact admin static assets served by the artifact-local same-origin proxy; API requests reverse proxied to the real local NestJS API",
    proxyBoundary: {
      origin: adminOrigin,
      staticAssets: "exact backend/api/public/admin files",
      apiUpstream: new URL(apiBase).origin,
      productionSourceModified: false
    },
    ticket: {
      id: ticket.id,
      status: finalFacts.ticket.status,
      category: finalFacts.ticket.category,
      priority: finalFacts.ticket.priority,
      resolutionCode: finalFacts.ticket.resolutionCode,
      assigned: Boolean(finalFacts.ticket.assignedToUserId)
    },
    auditActions,
    notification: publicNotification ? {
      id: publicNotification.id,
      type: publicNotification.type,
      title: publicNotification.title,
      status: publicNotification.data?.status || null,
      unread: publicNotification.readAt === null
    } : null,
    deliveryIntent: finalFacts.notification ? {
      templateKey: finalFacts.notification.templateKey,
      status: finalFacts.notification.deliveryStatus,
      attemptCount: finalFacts.notification.attemptCount
    } : null,
    screenshots: [
      "screenshots/01-admin-login.png",
      "screenshots/02-admin-anonymous-queue.png",
      "screenshots/03-admin-claim-dialog.png",
      "screenshots/04-admin-claimed-ticket.png",
      "screenshots/05-admin-claimed-detail.png",
      "screenshots/06-admin-resolve-dialog.png",
      "screenshots/07-admin-resolved-ticket.png"
    ],
    externalWechatDeliveryValidated: false,
    assertions: finalAssertions,
    overall: finalAssertions.every((item) => item.outcome === "pass") ? "pass" : "fail"
  };
  await saveJson(resolve(artifactRoot, "verification/media-final-assertions.json"), finalEvidence);
  flowEvidence = {
    generatedAt: new Date().toISOString(),
    ticketId: ticket.id,
    createResponseStatus,
    loginStatus: loginResponse.status(),
    claimStatus,
    resolveStatus,
    preclaimOverall: preclaimEvidence.overall,
    finalOverall: finalEvidence.overall,
    bootstrapAccounts: bootstrapLog.map((line) => line.replace(/\s+/g, " ")),
    credentialsPersistedInArtifact: false,
    runtimeSessionPath: "outside artifact under /private/tmp",
    screenshots: finalEvidence.screenshots
  };
  await saveJson(resolve(artifactRoot, "verification/media-admin-flow.json"), flowEvidence);
  if (finalEvidence.overall !== "pass") throw new Error("Final acceptance assertions failed");
} finally {
  await context.close();
  await browser.close();
}

process.stdout.write(`${JSON.stringify({
  ticketId: ticket.id,
  preclaim: preclaimEvidence?.overall || "not-run",
  final: flowEvidence?.finalOverall || "not-run",
  screenshots: flowEvidence?.screenshots?.length || 0
})}\n`);
