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

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
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

function credential(username) {
  return {
    username,
    password: `D!${randomBytes(18).toString("base64url")}9a`,
    totpSecret: base32(randomBytes(20))
  };
}

function targetUrl(base, pathname) {
  const url = new URL(base);
  url.pathname = pathname;
  return url.toString();
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
    error.code = result.payload?.error?.code || "REQUEST_FAILED";
    error.status = result.status;
    throw error;
  }
  return result.payload.data ?? result.payload;
}

function check(id, condition, evidence, details) {
  return { id, outcome: condition ? "pass" : "fail", evidence, ...(details === undefined ? {} : { details }) };
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

function bootstrapStaff(environment, item, displayName) {
  const result = spawnSync(process.execPath, [resolve(apiRoot, "dist/src/database/bootstrap-staff.js")], {
    cwd: apiRoot,
    env: {
      ...environment,
      STAFF_BOOTSTRAP_USERNAME: item.username,
      STAFF_BOOTSTRAP_PASSWORD: item.password,
      STAFF_BOOTSTRAP_TOTP_SECRET: item.totpSecret,
      STAFF_BOOTSTRAP_ROLE: "support",
      STAFF_BOOTSTRAP_DISPLAY_NAME: displayName
    },
    encoding: "utf8"
  });
  if (result.status !== 0) throw new Error(`Staff bootstrap failed: ${result.stderr || result.stdout}`);
}

async function login(apiBase, item) {
  return dataOf(await rawApi(apiBase, "/auth/staff/login", {
    method: "POST",
    body: { username: item.username, password: item.password, totpCode: currentTotp(item.totpSecret) }
  }));
}

const apiBase = required("DEMO_API_BASE");
const runtimeDir = required("DEMO_RUNTIME_DIR");
const databaseName = required("DEMO_DB_NAME");
const redisDatabase = required("DEMO_REDIS_DB");
const subject = required("DEMO_TICKET_SUBJECT");
const body = required("DEMO_TICKET_BODY");
const resolution = required("DEMO_TICKET_RESOLUTION");
const outputPrefix = process.env.DEMO_OUTPUT_PREFIX?.trim() || "";
const envFile = dotenv.parse(await readFile(resolve(apiRoot, ".env")));
const dbUrl = targetUrl(envFile.DATABASE_URL, `/${databaseName}`);
const redisUrl = targetUrl(envFile.REDIS_URL, `/${redisDatabase}`);
const backendEnvironment = { ...process.env, ...envFile, DATABASE_URL: dbUrl, REDIS_URL: redisUrl };

const primaryCredential = credential("support.demo");
const observerCredential = credential("support.observer.demo");
bootstrapStaff(backendEnvironment, primaryCredential, "演示客服");
bootstrapStaff(backendEnvironment, observerCredential, "隔离校验客服");

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
  const next = dataOf(refreshed);
  customerSession = { ...customerSession, ...next, user: next.user || customerSession.user };
  await saveJson(customerSessionPath, customerSession, 0o600);
}

const ticket = await withDb(dbUrl, async (client) => {
  const result = await client.query(
    'SELECT * FROM "SupportTicket" WHERE "userId" = $1 AND "subject" = $2 ORDER BY "createdAt" DESC, "id" DESC LIMIT 1',
    [customerSession.user.id, subject]
  );
  return result.rows[0] || null;
});
if (!ticket) throw new Error("Real customer API ticket was not found after the Chrome attempt");
if (ticket.status !== "open" || ticket.assignedToUserId !== null) {
  throw new Error(`Refusing unexpected resume state: status=${ticket.status}, assigned=${Boolean(ticket.assignedToUserId)}`);
}

const primary = await login(apiBase, primaryCredential);
const observer = await login(apiBase, observerCredential);
await saveJson(resolve(runtimeDir, "staff-session.json"), primary, 0o600);

const claimable = dataOf(await rawApi(apiBase, "/admin/commercial/support/claimable?page=1&pageSize=50", {
  token: primary.accessToken
}));
const summary = claimable.items.find((item) => item.id === ticket.id);
const preclaimDetail = await rawApi(apiBase, `/admin/commercial/support/tickets/${encodeURIComponent(ticket.id)}`, {
  token: primary.accessToken
});
const customerOpenDetail = dataOf(await rawApi(apiBase, `/support/tickets/${encodeURIComponent(ticket.id)}`, {
  token: customerSession.accessToken
}));
const creationAudit = await withDb(dbUrl, async (client) => {
  const result = await client.query(
    'SELECT "actorId", "metadata" FROM "AuditLog" WHERE "resourceType" = $1 AND "resourceId" = $2 AND "action" = $3',
    ["supportTicket", ticket.id, "support.ticket_created"]
  );
  return result.rows[0] || null;
});
const expectedSummaryKeys = ["category", "dueAt", "hasOrder", "id", "priority"];
const returnedSummaryKeys = summary ? Object.keys(summary).sort() : [];
const forbiddenKeys = [
  "userId", "requester", "subject", "body", "orderId", "order", "orderFacts",
  "assignedTo", "assignedToUserId", "resolution", "resolutionCode", "resolvedAt"
];
const preclaimAssertions = [
  check("real-customer-api-ticket-open", ticket.status === "open" && ticket.subject === subject && ticket.body === body && ticket.assignedToUserId === null, "database contains the real API-created open and unassigned fixture"),
  check("customer-open-view-hides-operations-identities", customerOpenDetail.status === "open" && !("userId" in customerOpenDetail) && !("requester" in customerOpenDetail) && !("assignedTo" in customerOpenDetail), "requester view contains the ticket but no operations identities"),
  check("claimable-summary-present", Boolean(summary), "support claimable endpoint contains the fixture"),
  check("claimable-summary-exact-allowlist", Boolean(summary) && JSON.stringify(returnedSummaryKeys) === JSON.stringify(expectedSummaryKeys), "claimable summary uses exactly five fields", { returnedKeys: returnedSummaryKeys }),
  check("claimable-summary-private-fields-absent", Boolean(summary) && forbiddenKeys.every((key) => !(key in summary)), "claimable summary omits requester, content, order identity, facts, assignment and resolution fields"),
  check("preclaim-detail-non-probing-404", preclaimDetail.status === 404 && preclaimDetail.payload?.error?.code === "SUPPORT_TICKET_NOT_FOUND", "unassigned detail and missing detail share the same response"),
  check("creation-audit-bounded", creationAudit?.actorId === customerSession.user.id && metadataMatches(creationAudit?.metadata, { orderId: null, category: "general", priority: "normal" }) && !("subject" in (creationAudit?.metadata || {})) && !("body" in (creationAudit?.metadata || {})), "creation audit binds the requester without copying ticket text")
];
const preclaimEvidence = {
  generatedAt: new Date().toISOString(),
  phase: "preclaim",
  driver: "real local NestJS API plus isolated PostgreSQL",
  ticket: { id: ticket.id, status: ticket.status, category: ticket.category, priority: ticket.priority },
  claimableSummary: summary || null,
  directDetail: { status: preclaimDetail.status, errorCode: preclaimDetail.payload?.error?.code || null },
  uiCapture: { outcome: "blocked", reason: "Google Chrome returned ERR_TOO_MANY_REDIRECTS for /admin/ before any UI action" },
  assertions: preclaimAssertions,
  overall: preclaimAssertions.every((item) => item.outcome === "pass") ? "pass" : "fail"
};
await saveJson(resolve(artifactRoot, `verification/${outputPrefix}preclaim-assertions.json`), preclaimEvidence);
if (preclaimEvidence.overall !== "pass") throw new Error("Preclaim assertions failed");

const claimedResponse = await rawApi(apiBase, `/admin/commercial/support/tickets/${encodeURIComponent(ticket.id)}/claim`, {
  method: "POST",
  token: primary.accessToken
});
const claimed = dataOf(claimedResponse);
const primaryDetail = dataOf(await rawApi(apiBase, `/admin/commercial/support/tickets/${encodeURIComponent(ticket.id)}`, {
  token: primary.accessToken
}));
const observerDetail = await rawApi(apiBase, `/admin/commercial/support/tickets/${encodeURIComponent(ticket.id)}`, {
  token: observer.accessToken
});
const observerClaim = await rawApi(apiBase, `/admin/commercial/support/tickets/${encodeURIComponent(ticket.id)}/claim`, {
  method: "POST",
  token: observer.accessToken
});
const resolvedResponse = await rawApi(apiBase, `/admin/commercial/support/tickets/${encodeURIComponent(ticket.id)}/resolve`, {
  method: "POST",
  token: primary.accessToken,
  body: { status: "resolved", resolutionCode: "noRefund", resolution }
});
const resolved = dataOf(resolvedResponse);
const customerDetail = dataOf(await rawApi(apiBase, `/support/tickets/${encodeURIComponent(ticket.id)}`, {
  token: customerSession.accessToken
}));
const notifications = dataOf(await rawApi(apiBase, "/notifications?page=1&pageSize=50&unreadOnly=true", {
  token: customerSession.accessToken
}));
const publicNotification = notifications.items.find((item) =>
  item.type === "supportUpdate" && item.data?.ticketId === ticket.id
);

const facts = await withDb(dbUrl, async (client) => {
  const ticketResult = await client.query('SELECT * FROM "SupportTicket" WHERE "id" = $1', [ticket.id]);
  const audits = await client.query(
    'SELECT "id", "action", "actorId", "metadata" FROM "AuditLog" WHERE "resourceType" = $1 AND "resourceId" = $2 ORDER BY "createdAt", "id"',
    ["supportTicket", ticket.id]
  );
  const subjects = await client.query(
    'SELECT l."action", r."subjectUserId", r."relationKind" FROM "AuditLog" l JOIN "AuditSubjectReference" r ON r."auditLogId" = l."id" WHERE l."resourceType" = $1 AND l."resourceId" = $2 ORDER BY l."createdAt", l."id", r."subjectUserId"',
    ["supportTicket", ticket.id]
  );
  const outbox = await client.query(
    'SELECT n."id", n."userId", n."type", n."title", n."body", n."data", n."eventKey", n."readAt", d."userId" AS "deliveryUserId", d."templateKey", d."status" AS "deliveryStatus", d."attemptCount" FROM "Notification" n LEFT JOIN "NotificationDelivery" d ON d."notificationId" = n."id" WHERE n."eventKey" = $1',
    [`support:${ticket.id}:resolved`]
  );
  return { ticket: ticketResult.rows[0], audits: audits.rows, subjects: subjects.rows, notification: outbox.rows[0] || null };
});
const auditByAction = Object.fromEntries(facts.audits.map((item) => [item.action, item]));
const expectedActions = ["support.ticket_created", "support.ticket_claimed", "support.ticket_resolved"];
const actions = facts.audits.map((item) => item.action);
const finalAssertions = [
  check("claim-api-status", claimedResponse.status === 201 && claimed.status === "inProgress", "real claim endpoint returned 201 and moved the ticket to inProgress"),
  check("claim-returns-authorized-detail", claimed.id === ticket.id && claimed.subject === subject && claimed.body === body && claimed.requester?.id === customerSession.user.id && claimed.assignedTo?.id === primary.user.id, "successful claim is the first response containing requester, content and assignee"),
  check("assigned-operator-detail-access", primaryDetail.id === ticket.id && primaryDetail.requester?.id === customerSession.user.id && primaryDetail.assignedTo?.id === primary.user.id, "current assignee can read canonical detail"),
  check("other-support-detail-non-probing", observerDetail.status === 404 && observerDetail.payload?.error?.code === "SUPPORT_TICKET_NOT_FOUND", "another support operator receives the non-probing 404"),
  check("other-support-claim-conflict", observerClaim.status === 409 && observerClaim.payload?.error?.code === "SUPPORT_TICKET_ALREADY_ASSIGNED", "second compare-and-set claim cannot steal ownership"),
  check("resolve-api-status", resolvedResponse.status === 200 && resolved.status === "resolved" && resolved.resolution === resolution && resolved.resolutionCode === "noRefund", "real resolve endpoint returned the customer-readable result"),
  check("resolved-database-state", facts.ticket.status === "resolved" && facts.ticket.assignedToUserId === primary.user.id && facts.ticket.resolution === resolution && facts.ticket.resolutionCode === "noRefund" && Boolean(facts.ticket.resolvedAt), "database preserves assignment, result and completion time"),
  check("customer-sees-result-without-operations-identities", customerDetail.status === "resolved" && customerDetail.resolution === resolution && customerDetail.resolutionCode === "noRefund" && !("userId" in customerDetail) && !("requester" in customerDetail) && !("assignedTo" in customerDetail), "requester receives the outcome without staff identities"),
  check("audit-actions-complete", expectedActions.every((action) => actions.includes(action)), "created, claimed and resolved audit rows exist", { actions }),
  check("claim-audit-bounded", auditByAction["support.ticket_claimed"]?.actorId === primary.user.id && metadataMatches(auditByAction["support.ticket_claimed"]?.metadata, { orderLinked: false }), "claim audit binds actor and bounded order-link fact"),
  check("resolve-audit-bounded", auditByAction["support.ticket_resolved"]?.actorId === primary.user.id && metadataMatches(auditByAction["support.ticket_resolved"]?.metadata, { status: "resolved", orderId: null, resolutionCode: "noRefund" }) && !("resolution" in (auditByAction["support.ticket_resolved"]?.metadata || {})), "resolution audit omits customer-readable text"),
  check("audit-subject-edges-complete", expectedActions.every((action) => facts.subjects.some((item) => item.action === action && item.subjectUserId === customerSession.user.id)), "every controlled audit action has an explicit requester subject edge"),
  check("customer-unread-notification-visible", publicNotification?.title === "客服工单已更新" && publicNotification?.data?.status === "resolved" && publicNotification?.readAt === null, "requester notification API returns the unread support update"),
  check("transactional-outbox-durable", facts.notification?.userId === customerSession.user.id && facts.notification?.type === "supportUpdate" && facts.notification?.title === "客服工单已更新" && facts.notification?.body === "你的客服工单已有处理结果，请在订单或消息中心查看。" && facts.notification?.data?.ticketId === ticket.id && facts.notification?.data?.status === "resolved" && facts.notification?.eventKey === `support:${ticket.id}:resolved` && facts.notification?.deliveryUserId === customerSession.user.id && facts.notification?.templateKey === "supportUpdate" && Boolean(facts.notification?.deliveryStatus), "inbox row and delivery intent are transactionally durable", { deliveryStatus: facts.notification?.deliveryStatus || null, attemptCount: facts.notification?.attemptCount ?? null })
];
const finalEvidence = {
  generatedAt: new Date().toISOString(),
  phase: "final",
  driver: "real local NestJS API plus isolated PostgreSQL and Redis",
  ticket: { id: ticket.id, status: facts.ticket.status, category: facts.ticket.category, priority: facts.ticket.priority, assigned: Boolean(facts.ticket.assignedToUserId), resolutionCode: facts.ticket.resolutionCode },
  auditActions: actions,
  notification: publicNotification ? { id: publicNotification.id, type: publicNotification.type, title: publicNotification.title, status: publicNotification.data?.status || null, unread: publicNotification.readAt === null } : null,
  deliveryIntent: facts.notification ? { templateKey: facts.notification.templateKey, status: facts.notification.deliveryStatus, attemptCount: facts.notification.attemptCount } : null,
  uiEvidence: {
    miniProgram: { outcome: "blocked", reason: "No genuine Mini Program screenshot existed after one inspection; automation was not retried" },
    adminChrome: { outcome: "blocked", reason: "Installed Google Chrome returned ERR_TOO_MANY_REDIRECTS at /admin/ before interaction" }
  },
  externalWechatDeliveryValidated: false,
  assertions: finalAssertions,
  overall: finalAssertions.every((item) => item.outcome === "pass") ? "pass" : "fail"
};
await saveJson(resolve(artifactRoot, `verification/${outputPrefix}final-assertions.json`), finalEvidence);
await saveJson(resolve(artifactRoot, `verification/${outputPrefix}api-flow.json`), {
  generatedAt: new Date().toISOString(),
  ticketId: ticket.id,
  claimStatus: claimedResponse.status,
  resolveStatus: resolvedResponse.status,
  preclaimOverall: preclaimEvidence.overall,
  finalOverall: finalEvidence.overall,
  credentialsPersistedInArtifact: false,
  runtimeSessionPath: "outside artifact under /private/tmp"
});
await writeFile(resolve(artifactRoot, `logs/${outputPrefix}api-flow.log`), [
  `ticket=${ticket.id}`,
  `preclaim=${preclaimEvidence.overall}`,
  `claim_http=${claimedResponse.status}`,
  `resolve_http=${resolvedResponse.status}`,
  `final=${finalEvidence.overall}`,
  `delivery_intent=${facts.notification?.deliveryStatus || "missing"}`,
  "mini_ui=blocked:no-genuine-screenshot",
  "admin_ui=blocked:ERR_TOO_MANY_REDIRECTS",
  "external_wechat_delivery=not-run",
  "isolated_database=retained"
].join("\n") + "\n");
if (finalEvidence.overall !== "pass") throw new Error("Final API and database assertions failed");
process.stdout.write(`${JSON.stringify({ ticketId: ticket.id, preclaim: preclaimEvidence.overall, final: finalEvidence.overall, assertions: finalAssertions.length })}\n`);
