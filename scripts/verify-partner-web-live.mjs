import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const origin = process.env.PARTNER_WEB_TEST_ORIGIN || "http://localhost:3025";
if (!["http://localhost:3025", "https://talk-and-talk-web-2026.mellow-brook-0610.chatgpt.site"].includes(origin)) throw new Error("Unexpected test website target");
const settings = JSON.parse(await readFile(resolve(repo, "frontend/web/.env.partner-site-payload.json"), "utf8"));
const accessCode = (await readFile(resolve(repo, "backend/api/.env.partner-access"), "utf8")).split("PARTNER_ACCESS_CODE=")[1]?.trim();
if (!accessCode) throw new Error("No partner access code configured");
const assertions = [];
const consent = () => ({
  version: settings.NEXT_PUBLIC_LEGAL_CONSENT_VERSION,
  acceptedAt: new Date().toISOString(), privacyAccepted: true, termsAccepted: true, adultConfirmed: true,
  privacyUrl: settings.NEXT_PUBLIC_LEGAL_PRIVACY_URL, termsUrl: settings.NEXT_PUBLIC_LEGAL_TERMS_URL, source: "web",
});

async function request(path, { method = "GET", data, cookie, headers = {} } = {}) {
  const response = await fetch(origin + path, {
    method, headers: { origin, ...(cookie ? { cookie } : {}), ...(data ? { "content-type": "application/json" } : {}), ...headers },
    body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(25_000),
  });
  const body = await response.json().catch(() => ({}));
  return { response, body, data: body.data ?? body };
}
function ok(name, condition) {
  assert.ok(condition, name);
  assertions.push({ name, outcome: "pass" });
}
async function login(persona) {
  const result = await request("/api/session/login", { method: "POST", data: { persona, accessCode, consent: consent() } });
  assert.equal(result.response.status, 200, `${persona} login failed: ${JSON.stringify(result.body)}`);
  const setCookies = result.response.headers.getSetCookie();
  const cookie = setCookies.map((value) => value.split(";")[0]).join("; ");
  ok(`${persona}-http-only-session`, setCookies.length >= 2 && setCookies.every((value) => /HttpOnly/i.test(value)));
  ok(`${persona}-no-token-in-browser-json`, !JSON.stringify(result.body).includes("accessToken"));
  return { cookie, user: result.data.user };
}
async function api(path, session, options = {}) {
  const result = await request("/api/backend" + path, { ...options, cookie: session?.cookie });
  assert.ok(result.response.ok, `${path}: HTTP ${result.response.status} ${JSON.stringify(result.body)}`);
  return result.data;
}

try {
  const direct = await fetch(settings.TALKTALK_API_BASE_URL + "/companions", { signal: AbortSignal.timeout(25_000) });
  ok("direct-backend-access-denied", direct.status === 403);
  const guest = await request("/api/session");
  ok("anonymous-session-denied", guest.response.status === 401);
  const wrong = await request("/api/session/login", { method: "POST", data: { persona: "customer-a", accessCode: "invalid-".repeat(5), consent: consent() } });
  ok("wrong-invitation-denied", wrong.response.status === 401);
  const crossSite = await request("/api/session/login", { method: "POST", headers: { origin: "https://outside.example" }, data: {} });
  ok("cross-site-login-denied", crossSite.response.status === 403);
  const a = await login("customer-a");
  const b = await login("customer-b");
  const companion = await login("companion");
  ok("test-personas-distinct", a.user.id !== b.user.id && companion.user.role === "companion");
  const catalog = await api("/companions?page=1&pageSize=24", a);
  ok("cloud-catalog-loaded", catalog.items?.length >= 4 && catalog.items.some((item) => item.id === "c1"));
  const post = await api("/community/posts", a, { method: "POST", data: {
    kind: "femaleRequest", topic: "网页使用反馈", content: "合伙人网页测试：今天想轻松聊聊日常。"
  } });
  ok("community-post-persisted", Boolean(post.id));
  const postList = await api("/community/posts", b);
  ok("community-post-visible-to-second-account", postList.items?.some((item) => item.id === post.id));
  const liked = await api(`/community/posts/${post.id}/like`, b, { method: "POST", data: { liked: true } });
  ok("community-like-persisted", liked.isLiked === true && liked.likeCount >= 1);
  await api("/favorites/companions/c1", a, { method: "PUT" });
  const favorites = await api("/favorites/companions", a);
  ok("favorite-persisted", JSON.stringify(favorites).includes("c1"));
  const offerings = await api("/companions/c1/service-offerings", a);
  const offering = offerings.items.find((item) => item.deliveryMode === "text");
  assert.ok(offering, "text offering exists");
  const slots = await api(`/companions/c1/availability?serviceOfferingId=${encodeURIComponent(offering.id)}&durationMinutes=${offering.durationMinutes}&days=7`, a);
  const slot = slots.items.find((item) => item.availableCapacity > 0);
  assert.ok(slot, "at least one future booking slot exists");
  const order = await api("/orders", a, { method: "POST", data: {
    companionId: "c1", serviceOfferingId: offering.id, availabilityWindowId: slot.availabilityWindowId,
    themeId: offering.topicIds[0] || "general", durationMinutes: offering.durationMinutes,
    scheduledAt: slot.startsAt, clientRequestId: `partner_${randomUUID().replaceAll("-", "")}`, serviceIntent: "listen",
  } });
  ok("booking-persisted", Boolean(order.id) && order.status === "pending");
  const othersOrders = await api("/orders", b);
  ok("other-user-cannot-see-booking", !JSON.stringify(othersOrders).includes(order.id));
  await api(`/orders/service/${order.id}/confirm`, companion, { method: "POST" });
  ok("companion-confirmed-booking", true);
  await api(`/orders/${order.id}/cancel`, a, { method: "POST" });
  ok("test-booking-cancelled", true);
  const aConversations = await api("/conversations", a);
  const aChat = aConversations.conversations?.find((item) => item.id === "c1" || item.id === "partner-chat-customer-a");
  assert.ok(aChat, "customer trial chat exists");
  const text = "网页联调测试：这条消息从用户端发送。";
  await api(`/conversations/${aChat.id}/messages`, a, { method: "POST", data: { content: text } });
  const received = await api("/conversations/partner-chat-customer-a/messages", companion);
  ok("customer-message-delivered-to-companion", received.messages?.some((item) => item.content === text));
  const reply = "网页联调测试：陪伴者已收到并回复。";
  await api("/conversations/partner-chat-customer-a/messages", companion, { method: "POST", data: { content: reply } });
  const returned = await api(`/conversations/${aChat.id}/messages`, a);
  ok("companion-reply-delivered-to-customer", returned.messages?.some((item) => item.content === reply));
  const forbidden = await request("/api/backend/conversations/partner-chat-customer-a/messages", { cookie: b.cookie });
  ok("other-user-chat-isolation", [403, 404].includes(forbidden.response.status));
  for (const path of ["/community/posts", "/orders", "/conversations", "/me"]) await api(path, a);
  ok("core-user-pages-have-live-data", true);
  for (const path of ["/companions/me/profile", "/companions/me/service-offerings", "/companions/me/availability-windows", "/orders/service", "/orders/service/today"]) await api(path, companion);
  ok("companion-workbench-has-live-data", true);
  const logout = await request("/api/session/logout", { method: "POST", cookie: a.cookie });
  ok("logout-succeeded", logout.response.ok);
  const revoked = await request("/api/session", { cookie: a.cookie });
  ok("logged-out-session-revoked", revoked.response.status === 401);
  const report = { generatedAt: new Date().toISOString(), origin, backend: settings.TALKTALK_API_BASE_URL, assertions, payment: "not configured; no charges made", outcome: "pass" };
  await mkdir(resolve(repo, "artifacts/delivery"), { recursive: true });
  await writeFile(resolve(repo, "artifacts/delivery/partner-web-verification.json"), JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ outcome: "pass", assertions: assertions.length, origin }) + "\n");
} catch (error) {
  const message = String(error?.message || error).replaceAll(accessCode, "[REDACTED]").replaceAll(settings.WEB_GATEWAY_SECRET, "[REDACTED]");
  process.stdout.write(JSON.stringify({ outcome: "fail", passed: assertions.length, error: message }) + "\n");
  process.exitCode = 1;
}
