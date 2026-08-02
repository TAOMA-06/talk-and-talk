import assert from "node:assert/strict";

const WEB_BASE_URL = (process.env.WEB_BASE_URL || "http://127.0.0.1:3010").replace(/\/+$/, "");
const API_BASE_URL = (process.env.API_BASE_URL || "http://127.0.0.1:3101/api/v1").replace(/\/+$/, "");
const COMPANION_ID = process.env.COMPANION_ID || "c2";
const COMPANION_OWNER_PHONE = process.env.COMPANION_OWNER_PHONE || "13800000102";
// Public Web values must match the backend LEGAL_* release configuration.
// Allow the integration environment to exercise a planned document update.
const CONSENT_VERSION = process.env.NEXT_PUBLIC_LEGAL_CONSENT_VERSION || "2.2-2026-08-01";
const PRIVACY_URL = process.env.NEXT_PUBLIC_LEGAL_PRIVACY_URL || "https://api.talkandtalk.app/legal/privacy.html";
const TERMS_URL = process.env.NEXT_PUBLIC_LEGAL_TERMS_URL || "https://api.talkandtalk.app/legal/terms.html";

class BrowserSession {
  cookies = new Map();

  cookieHeader() {
    return [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; ");
  }

  captureCookies(response) {
    const values = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
    for (const value of values) {
      const pair = value.split(";", 1)[0];
      const index = pair.indexOf("=");
      if (index < 1) continue;
      const key = pair.slice(0, index);
      const cookieValue = pair.slice(index + 1);
      if (cookieValue) this.cookies.set(key, cookieValue);
      else this.cookies.delete(key);
    }
  }
}

async function webRequest(session, path, { method = "GET", data, expected = [200] } = {}) {
  const headers = new Headers({
    accept: "application/json",
    origin: WEB_BASE_URL,
    "sec-fetch-site": "same-origin",
  });
  if (data !== undefined) headers.set("content-type", "application/json");
  const cookie = session.cookieHeader();
  if (cookie) headers.set("cookie", cookie);

  const response = await fetch(`${WEB_BASE_URL}${path}`, {
    method,
    headers,
    body: data === undefined ? undefined : JSON.stringify(data),
    redirect: "manual",
  });
  session.captureCookies(response);
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!expected.includes(response.status)) {
    const error = payload?.error;
    throw new Error(
      `${method} ${path} returned ${response.status}: ${error?.code || "REQUEST_ERROR"} ${error?.message || ""}`,
    );
  }
  return { response, payload, data: payload?.data ?? payload };
}

function consentReceipt() {
  return {
    version: CONSENT_VERSION,
    acceptedAt: new Date(Date.now() - 1_000).toISOString(),
    privacyAccepted: true,
    termsAccepted: true,
    adultConfirmed: true,
    privacyUrl: PRIVACY_URL,
    termsUrl: TERMS_URL,
    source: "web",
  };
}

async function login(session, phone) {
  const sms = await webRequest(session, "/api/session/send-code", {
    method: "POST",
    data: { phone },
    expected: [200, 201],
  });
  const code = sms.data?.devCode;
  assert.match(code || "", /^\d{4,8}$/, "mock SMS must return a development code");

  const loginResult = await webRequest(session, "/api/session/login", {
    method: "POST",
    data: { phone, code, consent: consentReceipt() },
    expected: [200],
  });
  assert.ok(loginResult.data?.user?.id, "web login must return a user");
  assert.ok(session.cookies.has("tt_access"), "access token must be stored in an HttpOnly cookie");
  assert.ok(session.cookies.has("tt_refresh"), "refresh token must be stored in an HttpOnly cookie");
  return loginResult.data.user;
}

function nearFutureSchedule() {
  return new Date(Date.now() + 15 * 60_000 + 5_000).toISOString();
}

function randomCustomerPhone() {
  const suffix = `${Date.now()}`.slice(-8);
  return `137${suffix}`;
}

async function run() {
  const customer = new BrowserSession();
  const companion = new BrowserSession();

  console.log("1/9 Web BFF health and public marketplace");
  const health = await webRequest(customer, "/api/backend/health");
  assert.equal(health.data.status, "ok");
  assert.equal(health.data.appEnv, "development", "refusing to run mutations outside development");
  assert.equal(health.data.dependencies?.database?.status, "ok");
  assert.equal(health.data.dependencies?.redis?.status, "ok");
  const publicProfile = await webRequest(customer, `/api/backend/companions/${COMPANION_ID}`);
  assert.equal(publicProfile.data.id, COMPANION_ID);
  assert.equal(publicProfile.data.isPublished, true);

  console.log("2/9 Customer web login and server-recorded consent");
  const customerUser = await login(customer, randomCustomerPhone());
  const customerSession = await webRequest(customer, "/api/session");
  assert.equal(customerSession.data.user.id, customerUser.id);
  const legal = await webRequest(customer, "/api/backend/users/me/legal-consents");
  assert.match(JSON.stringify(legal.data), /"source":"web"/);

  console.log("3/9 Companion web login and integrated workbench");
  const companionUser = await login(companion, COMPANION_OWNER_PHONE);
  assert.equal(companionUser.role, "companion");
  const workbenchResponses = await Promise.all([
    webRequest(companion, "/api/backend/companions/me/profile"),
    webRequest(companion, "/api/backend/companions/me/service-offerings"),
    webRequest(companion, "/api/backend/companions/me/availability-windows"),
    webRequest(companion, "/api/backend/orders/service"),
    webRequest(companion, "/api/backend/orders/service/today"),
  ]);
  assert.equal(workbenchResponses[0].data.id, COMPANION_ID);

  console.log("4/9 Customer creates an order through the web proxy");
  const created = await webRequest(customer, "/api/backend/orders", {
    method: "POST",
    data: {
      companionId: COMPANION_ID,
      themeId: "local-web-integration",
      durationMinutes: 30,
      scheduledAt: nearFutureSchedule(),
    },
    expected: [200, 201],
  });
  const orderId = created.data.id;
  assert.ok(orderId);
  assert.equal(created.data.status, "pending");

  console.log("5/9 Companion confirms; customer starts Native Pay");
  const confirmed = await webRequest(
    companion,
    `/api/backend/orders/service/${encodeURIComponent(orderId)}/confirm`,
    { method: "POST", expected: [200, 201] },
  );
  assert.ok(confirmed.data.companionConfirmedAt);
  const prepay = await webRequest(
    customer,
    `/api/backend/orders/${encodeURIComponent(orderId)}/prepay`,
    { method: "POST", data: { channel: "native" }, expected: [200, 201] },
  );
  const payment = prepay.data.payment;
  assert.equal(payment.channel, "native");
  assert.equal(payment.mock, true);
  assert.ok(payment.wechatNativeParams?.codeUrl, "Native Pay must return a QR code URL");

  console.log("6/9 Payment callback simulation and web payment sync");
  const notifyResponse = await fetch(`${API_BASE_URL}/payments/wechat/mock-notify`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${customer.cookies.get("tt_access")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ outTradeNo: payment.outTradeNo }),
  });
  assert.ok(notifyResponse.ok, `mock payment callback returned ${notifyResponse.status}`);
  const paid = await webRequest(
    customer,
    `/api/backend/orders/${encodeURIComponent(orderId)}/payment/sync`,
    { method: "POST", expected: [200, 201] },
  );
  assert.equal(paid.data.data?.orderStatus, "paid");

  console.log("7/9 Paid-order two-way chat through the web proxy");
  await new Promise((resolve) => setTimeout(resolve, 6_000));
  const customerMessage = `网页联调客户消息-${Date.now()}`;
  const companionMessage = `网页联调陪伴者回复-${Date.now()}`;
  const customerSend = await webRequest(
    customer,
    `/api/backend/conversations/${COMPANION_ID}/messages`,
    { method: "POST", data: { content: customerMessage }, expected: [200, 201] },
  );
  assert.equal(customerSend.data.moderation?.decision, "allow");

  const companionConversations = await webRequest(companion, "/api/backend/conversations");
  const conversation = companionConversations.data.conversations?.find(
    (item) => item.companionId === COMPANION_ID && item.viewerRole === "companion",
  );
  assert.ok(conversation?.id, "companion workbench must see the paid conversation");
  const companionSend = await webRequest(
    companion,
    `/api/backend/conversations/${encodeURIComponent(conversation.id)}/messages`,
    { method: "POST", data: { content: companionMessage }, expected: [200, 201] },
  );
  assert.equal(companionSend.data.moderation?.decision, "allow");
  const messages = await webRequest(
    customer,
    `/api/backend/conversations/${COMPANION_ID}/messages`,
  );
  const contents = new Set(messages.data.messages?.map((item) => item.content));
  assert.ok(contents.has(customerMessage));
  assert.ok(contents.has(companionMessage));

  console.log("8/9 User orders and companion service orders share state");
  const [customerOrders, companionOrders] = await Promise.all([
    webRequest(customer, "/api/backend/orders"),
    webRequest(companion, "/api/backend/orders/service"),
  ]);
  const customerOrderItems = customerOrders.data.items ?? customerOrders.data.orders ?? [];
  const companionOrderItems = companionOrders.data.items ?? companionOrders.data.orders ?? [];
  assert.ok(customerOrderItems.some((item) => item.id === orderId && item.status === "paid"));
  assert.ok(companionOrderItems.some((item) => item.id === orderId && item.status === "paid"));

  console.log("9/9 Refund and logout through the web proxy");
  const refund = await webRequest(
    customer,
    `/api/backend/orders/${encodeURIComponent(orderId)}/refund`,
    { method: "POST", data: { reason: "LOCAL_WEB_INTEGRATION" }, expected: [200, 201] },
  );
  assert.equal(refund.data.refund?.status, "success");
  await webRequest(customer, "/api/session/logout", { method: "POST" });
  const loggedOut = await webRequest(customer, "/api/session", { expected: [401] });
  assert.equal(loggedOut.response.status, 401);

  console.log("Web-to-backend integration passed: public catalog, web consent, two roles, workbench, order, Native Pay, chat, refund, and logout.");
}

await run();
