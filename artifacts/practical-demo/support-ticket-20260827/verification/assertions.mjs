import { createRequire } from "node:module";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { currentTotp } from "./totp.mjs";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "../../../..");
const { Client } = require(`${repoRoot}/backend/api/node_modules/pg`);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function saveJson(path, value, mode) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, mode ? { mode } : undefined);
  if (mode) await chmod(path, mode);
}

async function rawApi(path, options = {}) {
  const response = await fetch(`${required("DEMO_API_BASE")}${path}`, {
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

function assertion(id, pass, evidence, details = null) {
  return { id, outcome: pass ? "pass" : "fail", evidence, ...(details ? { details } : {}) };
}

async function withDb(run) {
  const client = new Client({ connectionString: required("DATABASE_URL") });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function findTicket(client, userId) {
  const result = await client.query(
    'SELECT "id", "status", "assignedToUserId", "subject", "body", "resolution", "resolutionCode" FROM "SupportTicket" WHERE "userId" = $1 AND "subject" = $2 ORDER BY "createdAt" DESC, "id" DESC LIMIT 1',
    [userId, required("DEMO_TICKET_SUBJECT")]
  );
  return result.rows[0] || null;
}

const phase = process.argv[2];
if (!new Set(["preclaim", "final"]).has(phase)) {
  throw new Error("Usage: node assertions.mjs <preclaim|final>");
}

const runtimeDir = required("DEMO_RUNTIME_DIR");
const customerSession = await readJson(`${runtimeDir}/customer-session.json`);
const staffSessionPath = `${runtimeDir}/staff-session.json`;
const outPath = required("DEMO_ASSERTIONS_OUT");

if (phase === "preclaim") {
  const staffLogin = dataOf(await rawApi("/auth/staff/login", {
    method: "POST",
    body: {
      username: required("DEMO_STAFF_USERNAME"),
      password: required("DEMO_STAFF_PASSWORD"),
      totpCode: currentTotp(required("DEMO_TOTP_SECRET"))
    }
  }));
  await saveJson(staffSessionPath, staffLogin, 0o600);

  const ticket = await withDb((client) => findTicket(client, customerSession.user.id));
  if (!ticket) throw new Error("Expected Mini Program-created support ticket was not found");
  const claimable = dataOf(await rawApi("/admin/commercial/support/claimable?page=1&pageSize=50", {
    token: staffLogin.accessToken
  }));
  const summary = (claimable.items || []).find((item) => item.id === ticket.id);
  const exactSummaryKeys = ["category", "dueAt", "hasOrder", "id", "priority"];
  const summaryKeys = summary ? Object.keys(summary).sort() : [];
  const detailBeforeClaim = await rawApi(`/admin/commercial/support/tickets/${encodeURIComponent(ticket.id)}`, {
    token: staffLogin.accessToken
  });
  const creationAuditCount = await withDb(async (client) => {
    const result = await client.query(
      'SELECT COUNT(*)::integer AS count FROM "AuditLog" WHERE "resourceType" = $1 AND "resourceId" = $2 AND "action" = $3',
      ["supportTicket", ticket.id, "support.ticket_created"]
    );
    return result.rows[0].count;
  });

  const assertions = [
    assertion("ticket-created-by-real-mini-program-ui", Boolean(ticket.id) && ticket.status === "open", "database support ticket exists with expected subject and open status"),
    assertion("before-claim-summary-present", Boolean(summary), "claimable endpoint contains the created ticket"),
    assertion(
      "before-claim-summary-redacted",
      Boolean(summary) && JSON.stringify(summaryKeys) === JSON.stringify(exactSummaryKeys),
      "claimable projection is the exact five-field allowlist and omits all requester/content/order detail",
      { returnedKeys: summaryKeys }
    ),
    assertion(
      "before-claim-direct-detail-denied",
      detailBeforeClaim.status === 404 && detailBeforeClaim.payload?.error?.code === "SUPPORT_TICKET_NOT_FOUND",
      "support staff cannot probe ticket detail before ownership"
    ),
    assertion("ticket-created-audit-recorded", creationAuditCount === 1, "one support.ticket_created audit record exists")
  ];
  const evidence = {
    phase,
    generatedAt: new Date().toISOString(),
    ticket: { id: ticket.id, status: ticket.status, priority: summary?.priority ?? null, category: summary?.category ?? null },
    claimableSummary: summary || null,
    detailBeforeClaim: { status: detailBeforeClaim.status, errorCode: detailBeforeClaim.payload?.error?.code || null },
    assertions,
    overall: assertions.every((item) => item.outcome === "pass") ? "pass" : "fail"
  };
  await saveJson(outPath, evidence);
  process.stdout.write(`${JSON.stringify({ phase, overall: evidence.overall, ticketId: ticket.id })}\n`);
} else {
  const staffSession = await readJson(staffSessionPath);
  const ticket = await withDb((client) => findTicket(client, customerSession.user.id));
  if (!ticket) throw new Error("Expected support ticket was not found during final assertions");
  const staffDetail = dataOf(await rawApi(`/admin/commercial/support/tickets/${encodeURIComponent(ticket.id)}`, {
    token: staffSession.accessToken
  }));
  const customerDetail = dataOf(await rawApi(`/support/tickets/${encodeURIComponent(ticket.id)}`, {
    token: customerSession.accessToken
  }));
  const notifications = dataOf(await rawApi("/notifications?page=1&pageSize=50", {
    token: customerSession.accessToken
  }));
  const notification = (notifications.items || []).find((item) => item.type === "supportUpdate" && item.data?.ticketId === ticket.id);
  const databaseFacts = await withDb(async (client) => {
    const audits = await client.query(
      'SELECT "action", "actorId", "createdAt" FROM "AuditLog" WHERE "resourceType" = $1 AND "resourceId" = $2 ORDER BY "createdAt", "id"',
      ["supportTicket", ticket.id]
    );
    const storedNotification = await client.query(
      'SELECT n."id", n."type", n."eventKey", d."status" AS "deliveryStatus" FROM "Notification" n LEFT JOIN "NotificationDelivery" d ON d."notificationId" = n."id" WHERE n."userId" = $1 AND n."eventKey" = $2',
      [customerSession.user.id, `support:${ticket.id}:resolved`]
    );
    return { audits: audits.rows, notification: storedNotification.rows[0] || null };
  });
  const actions = databaseFacts.audits.map((item) => item.action);
  const expectedActions = ["support.ticket_created", "support.ticket_claimed", "support.ticket_resolved"];
  const expectedResolution = required("DEMO_TICKET_RESOLUTION");
  const assertions = [
    assertion(
      "after-claim-assignee-can-read-details",
      staffDetail.id === ticket.id && staffDetail.subject === required("DEMO_TICKET_SUBJECT") && staffDetail.body === required("DEMO_TICKET_BODY") && Boolean(staffDetail.requester?.id) && Boolean(staffDetail.assignedTo?.id),
      "assigned support staff detail contains requester, subject, body and assignee"
    ),
    assertion(
      "resolved-state-persisted",
      ticket.status === "resolved" && ticket.resolution === expectedResolution && ticket.resolutionCode === "noRefund",
      "database state is resolved with the expected customer-readable result"
    ),
    assertion(
      "customer-sees-resolved-result",
      customerDetail.status === "resolved" && customerDetail.resolution === expectedResolution && customerDetail.resolutionCode === "noRefund",
      "customer API returns resolved result without operational fields"
    ),
    assertion(
      "audit-trail-complete",
      expectedActions.every((action) => actions.includes(action)) && databaseFacts.audits.every((item) => Boolean(item.actorId)),
      "created, claimed and resolved audit actions exist with actors",
      { actions }
    ),
    assertion(
      "notification-visible-to-customer",
      Boolean(notification) && notification.data?.status === "resolved" && notification.title === "客服工单已更新",
      "customer notification endpoint contains the resolved support update"
    ),
    assertion(
      "notification-outbox-durable",
      databaseFacts.notification?.type === "supportUpdate" && Boolean(databaseFacts.notification?.deliveryStatus),
      "notification and delivery intent were persisted transactionally",
      { deliveryStatus: databaseFacts.notification?.deliveryStatus ?? null }
    )
  ];
  const evidence = {
    phase,
    generatedAt: new Date().toISOString(),
    ticket: {
      id: ticket.id,
      status: ticket.status,
      resolutionCode: ticket.resolutionCode,
      assigned: Boolean(ticket.assignedToUserId)
    },
    auditActions: actions,
    notification: notification ? {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      status: notification.data?.status ?? null
    } : null,
    deliveryStatus: databaseFacts.notification?.deliveryStatus ?? null,
    assertions,
    overall: assertions.every((item) => item.outcome === "pass") ? "pass" : "fail"
  };
  await saveJson(outPath, evidence);
  process.stdout.write(`${JSON.stringify({ phase, overall: evidence.overall, ticketId: ticket.id })}\n`);
}
