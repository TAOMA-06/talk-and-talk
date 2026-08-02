import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(new URL(pathname, "http://localhost"), {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

async function request(pathname, init) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(new URL(pathname, "http://localhost"), init),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Talk&Talk official marketing home", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN"/i);
  assert.match(html, /<title>Talk&amp;Talk 官方网站｜有边界的陪伴｜Talk&amp;Talk<\/title>/i);
  assert.match(html, /可信陪伴链/);
  assert.match(html, /微信小程序/);
  assert.match(html, /了解服务路径/);
  assert.match(html, /先认识规则，再放心开始/);
  assert.match(html, /role="tablist"/);
  assert.doesNotMatch(html, /style="[^"]*opacity:0(?:[;"])/);
  assert.doesNotMatch(html, /在开始之前|同意并进入/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton|codex-preview/i);
});

test("serves every primary product route with route-specific metadata", async () => {
  const routes = [
    ["/discover", "发现陪伴｜Talk&amp;Talk"],
    ["/about", "关于我们｜Talk&amp;Talk"],
    ["/login", "登录｜Talk&amp;Talk"],
    ["/community", "广场｜Talk&amp;Talk"],
    ["/orders", "订单｜Talk&amp;Talk"],
    ["/messages", "消息｜Talk&amp;Talk"],
    ["/profile", "我的｜Talk&amp;Talk"],
    ["/workbench", "陪伴者工作台｜Talk&amp;Talk"],
    ["/demo", "网页产品演示｜Talk&amp;Talk"],
    ["/safety", "安全与支持｜Talk&amp;Talk"],
    ["/business", "平台与合作｜Talk&amp;Talk"],
    ["/how-it-works", "产品如何运作｜Talk&amp;Talk"],
    ["/partners", "合作与联系｜Talk&amp;Talk"],
    ["/companions/preview-linyu", "陪伴者资料｜Talk&amp;Talk"],
  ];

  for (const [pathname, title] of routes) {
    const response = await render(pathname);
    assert.equal(response.status, 200, pathname);
    const html = await response.text();
    assert.match(html, new RegExp(`<title>${title}</title>`, "i"), pathname);
  }
});

test("separates the indexable official site from transactional product routes", async () => {
  const [robots, sitemap, discover, login, workbench, companion, demo] = await Promise.all([
    readFile(new URL("../app/robots.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/sitemap.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/discover/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/workbench/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/companions/[id]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/demo/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(robots, /"\/discover"/);
  assert.match(robots, /"\/login"/);
  assert.match(robots, /"\/workbench"/);
  assert.match(robots, /"\/companions\/"/);
  assert.match(sitemap, /how-it-works/);
  assert.match(sitemap, /partners/);
  assert.match(sitemap, /\$\{base\}\/demo/);
  assert.doesNotMatch(sitemap, /\$\{base\}\/discover/);
  assert.doesNotMatch(sitemap, /\$\{base\}\/login/);

  for (const source of [discover, login, workbench, companion]) {
    assert.match(source, /robots: \{ index: false, follow: false \}/);
  }
  assert.match(demo, /canonical: "\/demo"/);
});

test("keeps official-site canonicals distinct and resilient to forwarded hosts", async () => {
  const [layout, about, business, howItWorks, partners, safety] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/about/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/business/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/how-it-works/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/partners/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/safety/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(layout, /x-forwarded-host/);
  assert.match(layout, /https:\/\/talkandtalk\.app/);
  assert.match(about, /canonical: "\/about"/);
  assert.match(business, /canonical: "\/business"/);
  assert.match(howItWorks, /canonical: "\/how-it-works"/);
  assert.match(partners, /canonical: "\/partners"/);
  assert.match(safety, /canonical: "\/safety"/);

  for (const source of [about, business, howItWorks, partners, safety]) {
    assert.match(source, /openGraph:/);
    assert.match(source, /url: "\//);
  }
});

test("keeps the official shell usable without a Web-account entry", async () => {
  const [shell, cta, reveal] = await Promise.all([
    readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/MiniprogramCta.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/motion/Reveal.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(shell, /marketing-mobile-nav/);
  assert.match(shell, /官网导航/);
  assert.match(shell, /网页产品演示/);
  assert.match(shell, /isMarketing \? \(/);
  assert.match(shell, /if \(isMarketing\)/);
  assert.match(cta, /复制名称并在微信搜索/);
  assert.match(cta, /<button/);
  assert.match(reveal, /useScrollEntrance/);
  assert.match(reveal, /IntersectionObserver/);
  assert.match(reveal, /startsInInitialView/);
  assert.match(reveal, /revealState = "static"/);
});

test("keeps public browsing open while requiring consent at login", async () => {
  const [shell, login] = await Promise.all([
    readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/LoginScreen.tsx", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(shell, /ConsentGate|consent-screen|同意并进入/);
  assert.match(login, /saveConsent\(\)/);
  assert.match(login, /我确认已年满 18 周岁/);
  assert.match(login, /不是心理治疗或紧急救援服务/);
});

test("renders an investor-ready but evidence-bounded platform brief", async () => {
  const response = await render("/business");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /可信的服务基础设施/);
  assert.match(html, /已经实现并可联调/);
  assert.match(html, /需要部署方完成/);
  assert.match(html, /不使用未经核验的用户数、GMV 或增长率/);
});

test("offers a no-login, read-only product tour for commercial evaluation", async () => {
  const [response, bookingResponse] = await Promise.all([
    render("/demo"),
    render("/demo?stage=booking"),
  ]);
  assert.equal(response.status, 200);
  assert.equal(bookingResponse.status, 200);
  const html = await response.text();
  const bookingHtml = await bookingResponse.text();
  assert.match(html, /不创建账号、不提交信息、不发起订单/);
  assert.match(html, /产品演示阶段/);
  assert.match(html, /脱敏示例/);
  assert.match(html, /平台共同状态/);
  assert.match(bookingHtml, /把一次约定写进同一条状态/);
});

test("keeps motion causal, performant and the commercial tour deep-linkable", async () => {
  const [hero, heroStyles, journey, signal, demo, business] = await Promise.all([
    readFile(new URL("../components/motion/HeroOrchestration.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../components/motion/TrustJourney.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/motion/ConnectionPulse.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/DemoExperience.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/BusinessScreen.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(hero, /hero-entrance-title/);
  assert.doesNotMatch(heroStyles, /opacity:\s*0\.01/);
  assert.match(journey, /tabListRef/);
  assert.match(journey, /tabList\.scrollTo/);
  assert.match(journey, /journey-mobile-position/);
  assert.doesNotMatch(journey, /"complete"/);
  assert.match(signal, /pointOnSignalPath/);
  assert.match(signal, /data-signal-flow/);
  assert.match(signal, /visibilitychange/);
  assert.match(signal, /requestAnimationFrame/);
  assert.match(signal, /isSignalTraveling/);
  assert.match(demo, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(demo, /demo-status-bridge/);
  assert.match(business, /stage=booking/);
  assert.match(business, /stage=delivery/);
  assert.match(business, /stage=support/);
});

test("keeps official-company facts configurable without fabricating a public disclosure", async () => {
  const [disclosure, about, shell, layout, sitemap, entry] = await Promise.all([
    readFile(new URL("../lib/public-disclosure.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/AboutScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/sitemap.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/miniprogram-entry.ts", import.meta.url), "utf8"),
  ]);

  assert.match(disclosure, /verifiedPublicValue/);
  assert.match(disclosure, /NEXT_PUBLIC_LEGAL_OPERATOR_NAME/);
  assert.match(about, /hasVerifiedPublicDisclosure/);
  assert.match(shell, /miniprogramEntryUrl/);
  assert.match(layout, /og-trust-path\.png/);
  assert.match(layout, /metadataBase: siteOrigin/);
  assert.match(sitemap, /PUBLIC_SITE_CONTENT_UPDATED_AT/);
  assert.match(entry, /NEXT_PUBLIC_MINIPROGRAM_PATH/);
  await access(new URL("../public/og-trust-path.png", import.meta.url));
});

test("contains no disposable starter preview", async () => {
  const [layout, packageJson] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(packageJson, /"name": "talk-and-talk-web"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton|starter/i);
  assert.doesNotMatch(layout, /codex-preview|_sites-preview|Starter Project/);

  await assert.rejects(
    access(new URL("app/_sites-preview/SkeletonPreview.tsx", templateRoot)),
  );
});

test("keeps privileged and cross-site mutations outside the browser proxy", async () => {
  const [directAuth, encodedAdmin, crossSiteWrite] = await Promise.all([
    request("/api/backend/auth/phone/login"),
    request("/api/backend/%2561dmin/users"),
    request("/api/backend/community/posts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify({ content: "not forwarded" }),
    }),
  ]);

  assert.equal(directAuth.status, 403);
  assert.equal(encodedAdmin.status, 403);
  assert.equal(crossSiteWrite.status, 403);
});

test("rejects malformed or stale login consent before contacting auth", async () => {
  const response = await request("/api/session/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      phone: "13800138000",
      code: "123456",
      consent: {
        version: "2.2-2026-08-01",
        privacyAccepted: true,
        termsAccepted: true,
        adultConfirmed: true,
        source: "web",
        privacyUrl: "https://api.talkandtalk.app/legal/privacy.html",
        termsUrl: "https://api.talkandtalk.app/legal/terms.html",
        acceptedAt: "2020-01-01T00:00:00.000Z",
      },
    }),
  });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "LEGAL_CONSENT_REQUIRED");
});

test("keeps web legal-consent metadata aligned with the current release definition", async () => {
  const [definition, client, loginRoute, integration] = await Promise.all([
    readFile(new URL("../lib/legal-consent.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/api-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/session/login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("live-backend-integration.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(definition, /2\.2-2026-08-01/);
  assert.match(client, /LEGAL_CONSENT_VERSION/);
  assert.match(loginRoute, /LEGAL_CONSENT_VERSION/);
  assert.match(integration, /2\.2-2026-08-01/);
  assert.doesNotMatch(`${client}\n${loginRoute}\n${integration}`, /2\.0-2026-07-20/);
});
