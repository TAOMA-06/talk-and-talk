import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const artifactRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiBase = process.env.DEMO_API_BASE?.trim();
const runtimeRoot = process.env.DEMO_RUNTIME_ROOT?.trim();
if (!apiBase || !runtimeRoot) throw new Error("DEMO_API_BASE and DEMO_RUNTIME_ROOT are required");

async function session(profile) {
  const path = profile === "u0" ? `${runtimeRoot}/customer-session.json` : `${runtimeRoot}/${profile}/customer-session.json`;
  return JSON.parse(await readFile(path, "utf8"));
}

async function raw(path, token, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method: options.method || "GET",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload, data: payload.data ?? payload };
}

function check(id, pass, evidence, details) {
  return { id, outcome: pass ? "pass" : "fail", evidence, ...(details ? { details } : {}) };
}

const [u0, u1, p1, r1] = await Promise.all([session("u0"), session("u1"), session("p1"), session("r1")]);
const [u0Orders, u0Conversations, u0Support, u0Notifications] = await Promise.all([
  raw("/orders?page=1&pageSize=20", u0.accessToken),
  raw("/conversations?page=1&pageSize=20", u0.accessToken),
  raw("/support/tickets/me?page=1&pageSize=20", u0.accessToken),
  raw("/notifications?page=1&pageSize=20", u0.accessToken)
]);
const [u1Orders, u1Conversations, u1Support, u1Notifications] = await Promise.all([
  raw("/orders?page=1&pageSize=20", u1.accessToken),
  raw("/conversations?page=1&pageSize=20", u1.accessToken),
  raw("/support/tickets/me?page=1&pageSize=20", u1.accessToken),
  raw("/notifications?page=1&pageSize=20", u1.accessToken)
]);
const [p1Profile, p1Orders, p1Overview] = await Promise.all([
  raw("/companions/me/profile", p1.accessToken),
  raw("/orders/service?page=1&pageSize=20", p1.accessToken),
  raw("/commercial/companion/overview", p1.accessToken)
]);
const r1Actions = await raw("/me/account-actions?page=1&pageSize=20", r1.accessToken);
const r1Write = await raw("/support/tickets", r1.accessToken, {
  method: "POST",
  body: { category: "general", subject: "不应创建", body: "受限账号写操作应被拒绝。" }
});

const u1Statuses = (u1Orders.data.items || []).map((item) => item.status).sort();
const p1Statuses = (p1Orders.data.items || []).map((item) => item.status).sort();
const assertions = [
  check("U0-empty-orders", u0Orders.status === 200 && u0Orders.data.items.length === 0, "U0 order list is empty"),
  check("U0-empty-conversations", u0Conversations.status === 200 && u0Conversations.data.conversations.length === 0, "U0 conversation list is empty"),
  check("U0-empty-support", u0Support.status === 200 && u0Support.data.items.length === 0, "U0 support list is empty"),
  check("U0-empty-notifications", u0Notifications.status === 200 && u0Notifications.data.items.length === 0, "U0 notification list is empty"),
  check("U1-order-breadth", u1Orders.status === 200 && ["pending", "paid", "refunded"].every((status) => u1Statuses.includes(status)), "U1 exposes pending, paid and refunded orders", { statuses: u1Statuses }),
  check("U1-conversation", u1Conversations.status === 200 && u1Conversations.data.conversations.some((item) => item.companionId === "c1" && item.lastMessage), "U1 has a c1 conversation with a visible last message"),
  check("U1-support", u1Support.status === 200 && u1Support.data.items.some((item) => item.id === "demo-20260828-u1-support-resolved" && item.status === "open"), "U1 has an open historical order support record"),
  check("U1-notifications", u1Notifications.status === 200 && ["paymentSuccess", "orderStatus", "supportUpdate"].every((type) => u1Notifications.data.items.some((item) => item.type === type)), "U1 has payment, refund-status and support notifications"),
  check("P1-profile", p1Profile.status === 200 && p1Profile.data.id === "c1", "P1 is the seeded c1 owner"),
  check("P1-service-orders", p1Orders.status === 200 && ["pending", "paid", "refunded"].every((status) => p1Statuses.includes(status)), "P1 workbench sees the U1 order breadth", { statuses: p1Statuses }),
  check("P1-overview", p1Overview.status === 200 && p1Overview.data.companion?.id === "c1", "P1 commercial overview is readable"),
  check("R1-restricted-record", r1Actions.status === 200 && r1Actions.data.accountStatus === "restricted" && r1Actions.data.items.some((item) => item.id === "demo-20260828-r1-restriction"), "R1 can read the active restriction and account-rights record"),
  check("R1-write-denied", r1Write.status === 403 && r1Write.payload?.error?.code === "ACCOUNT_RESTRICTED", "R1 write attempt is denied before ticket creation")
];
const evidence = {
  generatedAt: new Date().toISOString(),
  mapping: {
    U0: "fresh normal customer empty states",
    U1: "normal customer with order/conversation/refund/support/notification history",
    P1: "seed c1 companion owner workbench",
    R1: "restricted user minimal account-rights mode"
  },
  visibleFacts: { U1: { orderStatuses: u1Statuses }, P1: { orderStatuses: p1Statuses }, R1: { accountStatus: r1Actions.data.accountStatus } },
  assertions,
  secretsIncluded: false,
  overall: assertions.every((item) => item.outcome === "pass") ? "pass" : "fail"
};
await writeFile(resolve(artifactRoot, "verification/snapshot-runtime-verification.json"), `${JSON.stringify(evidence, null, 2)}\n`);
if (evidence.overall !== "pass") throw new Error("Scenario snapshot verification failed");
process.stdout.write(JSON.stringify({ overall: evidence.overall, assertions: assertions.length }) + "\n");
