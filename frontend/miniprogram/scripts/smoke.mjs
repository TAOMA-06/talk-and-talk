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
let createdOrderPayload = null;
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
const message = {
  id: "message-1", conversationId: companion.id, senderId: "system", senderName: "系统",
  content: "订单已支付，平台担保沟通已开启。", type: "system", timestamp: new Date().toISOString()
};

function responseFor(path, method, data) {
  calls.push({ path, method, data });
  if (path === "/auth/wechat/mini-program") {
    return { accessToken: "access", refreshToken: "refresh", expiresIn: 900, user: { id: "user-1", role: "user", profile: { displayName: "微信用户" } } };
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
      outTradeNo: "T100", mock: true, channel: "miniProgram",
      wechatMiniProgramParams: { timeStamp: "1", nonceStr: "nonce", package: "prepay_id=mock", signType: "RSA", paySign: "sign" }
    }
  };
  if (path === "/payments/wechat/mock-notify") return { code: "SUCCESS" };
  if (path === "/conversations") return { conversations: [{
    id: companion.id, participant: { ...companion }, lastMessage: message, unreadCount: 1, updatedAt: new Date().toISOString()
  }] };
  if (path === `/conversations/${companion.id}/messages` && method === "GET") return {
    messages: [message], pagination: { nextCursor: null, hasMore: false }
  };
  if (path === `/conversations/${companion.id}/messages` && method === "POST") return {
    moderation: { decision: "allow", riskLevel: "low" },
    message: { ...message, id: "message-2", senderId: "user-1", senderName: "微信用户", content: data.content, type: "text" },
    safetyMessage: null
  };
  if (path === "/me") return { id: "user-1", role: "user", profile: { displayName: "微信用户", gender: "female" } };
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
      const path = new URL(url).pathname.replace(/^\/api\/v1/, "");
      const payload = responseFor(path, method, data);
      queueMicrotask(() => success({ statusCode: 200, data: { data: payload, meta: {} } }));
    } catch (error) { queueMicrotask(() => fail(error)); }
  },
  getPrivacySetting: ({ success }) => queueMicrotask(() => success({ needAuthorization: false })),
  requirePrivacyAuthorize: ({ success }) => queueMicrotask(success),
  requestPayment: ({ success }) => queueMicrotask(success),
  showToast: () => undefined,
  stopPullDownRefresh: () => undefined,
  navigateTo: () => undefined,
  switchTab: () => undefined,
  showModal: ({ success }) => queueMicrotask(() => success({ confirm: false })),
  showActionSheet: () => undefined
};

async function loadPage(name) {
  registeredPage = null;
  await import(`${pathToFileURL(join(output, `pages/${name}.js`)).href}?smoke=${Date.now()}-${name}`);
  assert.ok(registeredPage, `${name} page must register itself`);
  const page = {
    ...registeredPage,
    data: structuredClone(registeredPage.data),
    setData(patch) { Object.assign(this.data, patch); }
  };
  return page;
}

const discover = await loadPage("discover/index");
await discover.load();
assert.equal(discover.data.companions.length, 1);

const messages = await loadPage("messages/index");
await messages.load();
assert.equal(messages.data.conversations[0].name, companion.name);

const chat = await loadPage("chat/index");
chat.conversationId = companion.id;
await chat.load();
chat.data.draft = "你好，想聊聊今天的压力";
await chat.send();
assert.equal(chat.data.messages.length, 2);

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
await orders.pay({ currentTarget: { dataset: { id: order.id } } });
assert.ok(calls.some((call) => call.path === "/payments/wechat/mock-notify"));

const profile = await loadPage("profile/index");
await profile.load();
assert.equal(profile.data.user.id, "user-1");

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

console.log(`Mini Program runtime smoke passed: ${calls.length} API calls plus HTTPS/Cloud Run transport coverage`);
