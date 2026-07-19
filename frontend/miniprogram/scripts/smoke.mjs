import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(root, "../..");
const output = join(tmpdir(), "talkandtalk-miniprogram-smoke");
mkdirSync(output, { recursive: true });

const compiler = join(repo, "backend/api/node_modules/.bin/tsc");
const compilation = spawnSync(compiler, ["-p", join(root, "tsconfig.json"), "--outDir", output], {
  cwd: repo,
  encoding: "utf8"
});
if (compilation.status !== 0) {
  process.stderr.write(compilation.stdout || "");
  process.stderr.write(compilation.stderr || "");
  process.exit(compilation.status || 1);
}

const storage = new Map();
const calls = [];
let registeredPage = null;
let importSequence = 0;
let createdOrderPayload = null;
let updatedProfilePayload = null;
let paymentIsMock = true;
let privacyAuthorizationRequests = 0;
let modalConfirm = false;
let pullDownRefreshStops = 0;
const paymentInvocations = [];
const modalInvocations = [];
const navigations = [];
let cloudRunCall = null;
let environmentVersion = "release";

const companion = {
  id: "companion-1", name: "小安", role: "情绪倾听者", initials: "小安", bio: "安全、耐心地倾听",
  rating: 4.9, reviewCount: 12, pricePerHalfHour: 39, isOnline: true, isVerified: true,
  availability: "online", tags: ["情绪倾听"], availableTimes: ["今晚"]
};
const order = {
  id: "order-1", companionId: companion.id, themeId: "t1", durationMinutes: 30, amountCents: 3900,
  status: "pending", scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  companionSnapshot: { name: companion.name, role: companion.role, initials: companion.initials },
  createdAt: new Date().toISOString()
};
const chatMessageStartedAt = Date.now() - 2 * 60 * 60 * 1000;
const chatMessages = Array.from({ length: 55 }, (_, index) => ({
  id: `message-${String(index + 1).padStart(3, "0")}`,
  conversationId: companion.id,
  senderId: index % 2 ? companion.id : "user-1",
  senderName: index % 2 ? companion.name : "微信用户",
  content: index === 54 ? "订单已支付，平台担保沟通已开启。" : `历史消息 ${index + 1}`,
  type: index === 54 ? "system" : "text",
  timestamp: new Date(chatMessageStartedAt + index * 60_000).toISOString()
}));
const message = chatMessages.at(-1);
let sentMessageCount = 0;

function messagePage(cursor) {
  const sorted = [...chatMessages].sort((left, right) => {
    const timeDifference = Date.parse(left.timestamp) - Date.parse(right.timestamp);
    return timeDifference || left.id.localeCompare(right.id);
  });
  let available = sorted;
  if (cursor) {
    const cursorIndex = sorted.findIndex((item) => item.id === cursor);
    assert.notEqual(cursorIndex, -1, "message cursor must refer to an existing message");
    available = sorted.slice(0, cursorIndex);
  }
  const page = available.slice(Math.max(0, available.length - 50));
  return {
    messages: page,
    pagination: {
      nextCursor: available.length > 50 ? page[0]?.id ?? null : null,
      hasMore: available.length > 50
    }
  };
}

function responseFor(path, method, data, query = new URLSearchParams()) {
  calls.push({ path, method, data, query: Object.fromEntries(query.entries()) });
  if (path === "/auth/wechat/mini-program") {
    return { accessToken: "access", refreshToken: "refresh", expiresIn: 900, user: { id: "user-1", role: "user", profile: { displayName: "微信用户" } } };
  }
  if (path === "/users/me/legal-consents" && method === "POST") {
    assert.equal(data.version, "1.0-2026-07-19");
    assert.equal(data.privacyAccepted, true);
    assert.equal(data.termsAccepted, true);
    assert.equal(data.adultConfirmed, true);
    assert.equal(data.source, "wechatMiniProgram");
    return { receipt: { id: "consent-1", version: data.version } };
  }
  if (path === "/users/me/legal-consents" && method === "GET") {
    return { valid: true, receipt: { id: "consent-1", version: "1.0-2026-07-19" } };
  }
  if (path === "/companions" && method === "GET") return { items: [companion], pagination: { total: 1 } };
  if (path === `/companions/${companion.id}`) return companion;
  if (path === `/reviews/companion/${companion.id}`) return { items: [] };
  if (path === "/community/posts" && method === "GET") return { items: [{
    id: "post-1", authorId: "user-2", authorName: "小雨", authorInitials: "小雨", kind: "femaleRequest",
    topic: "睡前放松", content: "想找人聊聊", likeCount: 0, isLiked: false, moderationStatus: "approved", createdAt: new Date().toISOString()
  }] };
  if (path === "/orders" && method === "POST") {
    createdOrderPayload = data;
    assert.ok(Date.parse(data.scheduledAt) > Date.now(), "created order must include a future scheduledAt");
    return { ...order, scheduledAt: data.scheduledAt };
  }
  if (path === "/orders" && method === "GET") return { items: [order] };
  if (path === "/orders/service") return { items: [] };
  if (path === `/orders/${order.id}/prepay`) return {
    order: { ...order, status: "paying" },
    payment: {
      outTradeNo: "T100", mock: paymentIsMock, channel: "miniProgram",
      wechatMiniProgramParams: { timeStamp: "1", nonceStr: "nonce", package: "prepay_id=mock", signType: "RSA", paySign: "sign" }
    }
  };
  if (path === `/orders/${order.id}/payment/sync` && method === "POST") return {
    code: "SUCCESS", message: "支付已确认",
    data: { alreadyProcessed: false, orderId: order.id, orderStatus: "paid" }
  };
  if (path === "/payments/wechat/mock-notify") return { code: "SUCCESS" };
  if (path === "/conversations") return { conversations: [{
    id: companion.id, participant: { ...companion }, lastMessage: message, unreadCount: 1, updatedAt: new Date().toISOString()
  }] };
  if (path === `/conversations/${companion.id}/messages` && method === "GET") return messagePage(query.get("cursor"));
  if (path === `/conversations/${companion.id}/messages` && method === "POST") {
    const sentMessage = {
      ...message,
      id: `message-sent-${++sentMessageCount}`,
      senderId: "user-1",
      senderName: "微信用户",
      content: data.content,
      type: "text",
      timestamp: new Date().toISOString()
    };
    chatMessages.push(sentMessage);
    return { moderation: { decision: "allow", riskLevel: "low" }, message: sentMessage, safetyMessage: null };
  }
  if (path === "/me" && method === "PATCH") {
    updatedProfilePayload = data;
    assert.ok(["female", "male"].includes(data.gender), "profile update must use the shared gender contract");
    return { id: "user-1", role: "user", profile: { displayName: data.displayName, gender: data.gender } };
  }
  if (path === "/me/deletion-request" && method === "POST") return { id: "deletion-1", status: "pending", message: "注销申请已提交" };
  if (path === "/users/me/legal-consents/current" && method === "DELETE") return { withdrawn: true, withdrawnAt: new Date().toISOString() };
  if (path === "/me") return { id: "user-1", role: "user", profile: { displayName: "微信用户", gender: "female" } };
  if (path === "/auth/logout" && method === "POST") return { success: true };
  if (path === "/notifications") return { items: [] };
  if (path === "/health") return { status: "ok", service: "talk-and-talk-api" };
  throw new Error(`Unhandled smoke route: ${method} ${path}`);
}

globalThis.Page = (options) => { registeredPage = options; };
globalThis.App = () => undefined;
globalThis.wx = {
  getStorageSync: (key) => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: (key) => storage.delete(key),
  getAccountInfoSync: () => ({ miniProgram: { envVersion: environmentVersion } }),
  cloud: {
    init: () => undefined,
    callContainer: ({ path, method = "GET", data = {}, header, config, success, fail }) => {
      cloudRunCall = { path, method, data, header, config };
      try {
        const apiPath = path.replace(/^\/api\/v1/, "");
        const payload = responseFor(apiPath, method, data);
        queueMicrotask(() => success({ statusCode: 200, data: { data: payload, meta: {} } }));
      } catch (error) { queueMicrotask(() => fail(error)); }
    }
  },
  login: ({ success }) => queueMicrotask(() => success({ code: "smoke-code" })),
  request: ({ url, method = "GET", data = {}, success, fail }) => {
    try {
      const requestUrl = new URL(url);
      const path = requestUrl.pathname.replace(/^\/api\/v1/, "");
      const payload = responseFor(path, method, data, requestUrl.searchParams);
      queueMicrotask(() => success({ statusCode: 200, data: { data: payload, meta: {} } }));
    } catch (error) { queueMicrotask(() => fail(error)); }
  },
  getPrivacySetting: ({ success }) => queueMicrotask(() => success({ needAuthorization: true })),
  requirePrivacyAuthorize: ({ success }) => { privacyAuthorizationRequests += 1; queueMicrotask(success); },
  requestPayment: (options) => { paymentInvocations.push(options); queueMicrotask(options.success); },
  showToast: () => undefined,
  stopPullDownRefresh: () => { pullDownRefreshStops += 1; },
  navigateTo: (options) => { navigations.push(options.url); },
  switchTab: (options) => { navigations.push(options.url); },
  reLaunch: (options) => { navigations.push(options.url); queueMicrotask(() => options.complete?.()); },
  setNavigationBarTitle: () => undefined,
  openPrivacyContract: ({ success }) => queueMicrotask(() => success?.()),
  showModal: (options) => { modalInvocations.push(options); queueMicrotask(() => options.success({ confirm: modalConfirm })); },
  showActionSheet: () => undefined
};

async function loadPage(name) {
  registeredPage = null;
  await import(`${pathToFileURL(join(output, `pages/${name}.js`)).href}?smoke=${++importSequence}-${name}`);
  assert.ok(registeredPage, `${name} page must register itself`);
  const page = {
    ...registeredPage,
    data: structuredClone(registeredPage.data),
    setData(patch) { Object.assign(this.data, patch); }
  };
  return page;
}

const blockedDiscover = await loadPage("discover/index");
await blockedDiscover.load();
assert.equal(calls.length, 0, "deep links must not bypass the first-use consent gate");
assert.ok(navigations.includes("/pages/consent/index"));

const consent = await loadPage("consent/index");
assert.equal(calls.length, 0, "first-use gate must not start login or API requests before consent");
consent.setAgreement({ detail: { value: ["accepted"] } });
consent.setAdultConfirmation({ detail: { value: ["adult"] } });
await consent.accept();
const consentRecord = storage.get("talkandtalk.legalConsent");
assert.equal(consentRecord.version, "1.0-2026-07-19");
assert.equal(consentRecord.privacyAccepted, true);
assert.equal(consentRecord.termsAccepted, true);
assert.equal(consentRecord.source, "wechatMiniProgram");
assert.ok(Date.parse(consentRecord.acceptedAt));
assert.equal(privacyAuthorizationRequests, 1);
assert.ok(navigations.includes("/pages/discover/index"));

const legal = await loadPage("legal/index");
legal.onLoad({ type: "terms" });
assert.equal(legal.data.src, "https://api.talkandtalk.app/legal/terms.html");
legal.onLoad({ type: "privacy" });
assert.equal(legal.data.src, "https://api.talkandtalk.app/legal/privacy.html");

const discover = blockedDiscover;
await discover.load();
assert.equal(discover.data.companions.length, 1);
assert.ok(calls.some((call) => call.path === "/users/me/legal-consents" && call.method === "POST"));

const runtimeApi = await import(pathToFileURL(join(output, "utils/api.js")).href);
const restoredAccessToken = storage.get("talkandtalk.accessToken");
const restoredRefreshToken = storage.get("talkandtalk.refreshToken");
const restoredUser = storage.get("talkandtalk.user");
runtimeApi.clearSession();
storage.set("talkandtalk.accessToken", restoredAccessToken);
storage.set("talkandtalk.refreshToken", restoredRefreshToken);
storage.set("talkandtalk.user", restoredUser);
await runtimeApi.ensureSession();
assert.ok(calls.some((call) => call.path === "/users/me/legal-consents" && call.method === "GET"));

const messages = await loadPage("messages/index");
await messages.load();
assert.equal(messages.data.conversations[0].name, companion.name);

const chat = await loadPage("chat/index");
chat.conversationId = companion.id;
await chat.load();
assert.equal(chat.data.messages.length, 50, "initial chat load must show the newest page");
assert.equal(chat.data.messages[0].id, "message-006");
assert.equal(chat.data.messages.at(-1).id, "message-055");
assert.equal(chat.data.hasMore, true, "initial chat page must expose older history");
await chat.onReachBottom();
assert.equal(chat.data.messages.length, 55, "reaching the bottom must prepend older history");
assert.equal(chat.data.messages[0].id, "message-001");
assert.equal(chat.data.hasMore, false, "history cursor must stop after the oldest page");
assert.equal(new Set(chat.data.messages.map((item) => item.id)).size, chat.data.messages.length, "history paging must not duplicate messages");
chat.data.draft = "你好，想聊聊今天的压力";
await chat.send();
assert.equal(chat.data.messages.length, 56);
assert.equal(chat.data.messages.at(-1).content, "你好，想聊聊今天的压力");
chat.onShow();
assert.ok(chat.syncTimer, "visible chat must start a periodic sync timer");
await chat.latestSyncInFlight;
chat.onHide();
assert.equal(chat.syncTimer, null, "hiding chat must clear the periodic sync timer");

const remoteMessages = Array.from({ length: 55 }, (_, index) => ({
  ...message,
  id: `message-remote-${String(index + 1).padStart(3, "0")}`,
  senderId: companion.id,
  senderName: companion.name,
  content: `新消息 ${index + 1}`,
  type: "text",
  timestamp: new Date(Date.now() + (index + 1) * 1_000).toISOString()
}));
chatMessages.push(...remoteMessages);
await chat.onPullDownRefresh();
assert.equal(pullDownRefreshStops, 1, "pull-to-refresh must always stop its loading indicator");
assert.equal(chat.data.messages.length, 111, "refresh must bridge every page of messages that arrived since the prior sync");
assert.equal(chat.data.messages.at(-1).id, "message-remote-055");
assert.equal(new Set(chat.data.messages.map((item) => item.id)).size, chat.data.messages.length, "refresh must preserve a duplicate-free timeline");
assert.ok(calls.some((call) => call.path === `/conversations/${companion.id}/messages` && call.query.cursor),
  "chat refresh must request a cursor page when the newest page has no overlap");
chat.onUnload();

const detail = await loadPage("companion/detail");
detail.companionId = companion.id;
await detail.load();
await detail.book();
assert.equal(createdOrderPayload.themeId, "t1");

const community = await loadPage("community/index");
await community.load();
assert.equal(community.data.posts.length, 1);

const orders = await loadPage("orders/index");
await orders.load();
assert.match(orders.data.orders[0].scheduledAtText, /\d{4}年\d{2}月\d{2}日/, "orders must display a localized appointment time");
modalConfirm = true;
await orders.pay({ currentTarget: { dataset: { id: order.id } } });
assert.match(modalInvocations.at(-1).content, /服务对象/);
assert.match(modalInvocations.at(-1).content, /预约前 5 分钟/);
assert.match(modalInvocations.at(-1).content, /全额原路退款/);
assert.ok(calls.some((call) => call.path === "/payments/wechat/mock-notify"));
paymentIsMock = false;
await orders.pay({ currentTarget: { dataset: { id: order.id } } });
assert.equal(paymentInvocations.length, 1, "real payment branch must invoke wx.requestPayment exactly once");
assert.equal(paymentInvocations[0].package, "prepay_id=mock");
assert.equal(paymentInvocations[0].signType, "RSA");
assert.ok(calls.some((call) => call.path === `/orders/${order.id}/payment/sync` && call.method === "POST"),
  "real payment branch must reconcile the payment with the backend");

const profile = await loadPage("profile/index");
await profile.load();
assert.equal(profile.data.user.id, "user-1");
profile.setGender({ detail: { value: "1" } });
profile.data.displayName = "微信用户";
await profile.saveProfile();
assert.equal(updatedProfilePayload.gender, "male");
assert.equal(storage.get("talkandtalk.legalConsent").userId, "user-1");
modalConfirm = true;
await profile.requestDeletion();
assert.ok(calls.some((call) => call.path === "/me/deletion-request"));
await profile.withdrawConsent();
assert.ok(calls.some((call) => call.path === "/users/me/legal-consents/current" && call.method === "DELETE"));
assert.equal(storage.has("talkandtalk.legalConsent"), false);
assert.equal(storage.has("talkandtalk.accessToken"), false);
assert.ok(navigations.includes("/pages/consent/index"));

const apiModule = await import(`${pathToFileURL(join(output, "utils/api.js")).href}`);
const configModule = await import(`${pathToFileURL(join(output, "utils/config.js")).href}`);
assert.equal(configModule.backendConfig().baseUrl, "https://api.talkandtalk.app/api/v1");
environmentVersion = "trial";
assert.equal(configModule.backendConfig().baseUrl, "https://api-staging.talkandtalk.app/api/v1");
const cloudResponse = await apiModule.dispatchBackendRequest(
  { transport: "cloudRun", envId: "smoke-env", service: "talk-and-talk-api", apiPrefix: "/api/v1" },
  "/health",
  { method: "GET", authenticated: false },
  { "content-type": "application/json" }
);
assert.equal(cloudResponse.data.data.status, "ok");
assert.equal(cloudRunCall.path, "/api/v1/health");
assert.equal(cloudRunCall.header["X-WX-SERVICE"], "talk-and-talk-api");
assert.equal(cloudRunCall.config.env, "smoke-env");

console.log(`Mini Program runtime smoke passed: consent/legal gates, ${calls.length} API calls, mock/real payment branches and HTTPS/Cloud Run transport coverage`);
