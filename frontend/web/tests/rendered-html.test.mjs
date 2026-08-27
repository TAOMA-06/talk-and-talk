import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

async function render(pathname = "/", { origin = "http://localhost" } = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(new URL(pathname, origin), {
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

async function renderWithoutBindings(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-no-bindings`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(new URL(pathname, "http://localhost"), {
      headers: { accept: "text/html" },
    }),
    undefined,
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

async function withEnvironment(values, run) {
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
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

async function optimizedImageRequest({ width = 32, ...overrides } = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-image`);
  const { default: worker } = await import(workerUrl.href);
  const bindings = {
    ASSETS: {
      fetch: async () => new Response("asset", { headers: { "content-type": "image/png" } }),
    },
    IMAGES: {
      input: () => ({
        transform: () => ({
          output: async () => ({
            response: () => new Response("image", { headers: { "content-type": "image/png" } }),
          }),
        }),
      }),
    },
    ...overrides,
  };
  return worker.fetch(
    new Request(`https://talkandtalk.app/_vinext/image?url=%2Fbrand%2Fapp-icon.png&w=${width}&q=75`),
    bindings,
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
  // Absolute home title must not double-append the layout template brand suffix.
  assert.match(html, /<title>Talk&amp;Talk 官方网站｜有边界的陪伴<\/title>/i);
  assert.doesNotMatch(html, /<title>Talk&amp;Talk 官方网站｜有边界的陪伴｜Talk&amp;Talk<\/title>/i);
  // Hero states concrete job-to-be-done within first meaningful paint.
  assert.match(html, /有边界的线上陪伴/);
  assert.match(html, /被认真听见/);
  assert.match(html, /女性友好的线上陪伴/);
  assert.match(html, /连接空泡/);
  assert.match(html, /微信小程序/);
  assert.match(html, /了解服务路径/);
  assert.match(html, /先认识规则，再进入小程序/);
  assert.match(html, /hero-trust-strip/);
  assert.match(html, /文字互动/);
  assert.match(html, /身份核验通道完成前不开放新预约、支付或聊天/);
  assert.doesNotMatch(html, /App 即将到来/);
  assert.match(html, /bubble-hero|icon-orbit|app-icon/);
  assert.match(html, /非医疗|非急救|年满 18/);
  // Brand signature retained (symbol section + orbit caption).
  assert.match(html, /两枚对话相遇|形成一颗温柔的心/);
  // next/image may encode the path as /brand/app-icon.png or %2Fbrand%2Fapp-icon.png
  assert.match(html, /app-icon\.png/);
  assert.doesNotMatch(html, /style="[^"]*opacity:0(?:[;"])/);
  assert.doesNotMatch(html, /在开始之前|同意并进入/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton|codex-preview/i);
  assert.doesNotMatch(html, /重新定义未来|赋能无限可能|全球领先|行业第一/);
  assert.doesNotMatch(html, /用户数|GMV|融资额/);
});

test("built public Worker tolerates a missing local binding object", async () => {
  const response = await renderWithoutBindings("/");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
});

test("serves every public marketing route with route-specific metadata", async () => {
  const routes = [
    ["/about", "关于我们｜Talk&amp;Talk"],
    ["/safety", "安全与支持｜Talk&amp;Talk"],
    ["/how-it-works", "产品如何运作｜Talk&amp;Talk"],
    ["/partners", "合作与联系｜Talk&amp;Talk"],
  ];

  for (const [pathname, title] of routes) {
    const response = await render(pathname);
    assert.equal(response.status, 200, pathname);
    const html = await response.text();
    assert.match(html, new RegExp(`<title>${title}</title>`, "i"), pathname);
  }
});

const lockedRuntime = process.env.NODE_ENV === "production" || process.env.WEB_DEFAULT_SURFACE_TEST === "1";

test("candidate check explicitly invokes both locked-worker runtime suites", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(packageJson.scripts.test, /test:default-surface/);
  assert.match(packageJson.scripts.test, /test:production-surface/);
  assert.match(packageJson.scripts["test:default-surface"], /WEB_DEFAULT_SURFACE_TEST=1/);
  assert.match(packageJson.scripts["test:production-surface"], /NODE_ENV=production/);
});

// The local-open render suite intentionally exercises development HTML. Register
// this assertion only in the dedicated locked-runtime suites instead of emitting
// a skip that could be confused with candidate evidence.
if (lockedRuntime) {
  test("the built locked worker rejects private, deferred, and BFF surfaces", async () => {
    for (const pathname of ["/business", "/demo", "/discover", "/companions/preview-linyu", "/login"]) {
      const response = await render(pathname);
      assert.equal(response.status, 404, pathname);
    }
    const sessionResponse = await request("/api/session/login", { method: "POST" });
    assert.equal(sessionResponse.status, 403, "/api/session/login");
    const backendResponse = await request("/api/backend/orders");
    assert.equal(backendResponse.status, 403, "/api/backend/orders");
  });
}

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
  assert.match(sitemap, /sitemapPublicPaths/);
  assert.match(sitemap, /isProductionCandidateSurface/);
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
  const [shell, cta, reveal, home] = await Promise.all([
    readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/MiniprogramCta.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/motion/Reveal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/MarketingHomeScreen.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(shell, /marketing-mobile-nav/);
  assert.match(shell, /官网导航/);
  assert.doesNotMatch(shell, /App 即将到来/);
  assert.match(shell, /isMarketing \? \(/);
  assert.match(shell, /if \(isMarketing\)/);
  assert.match(shell, /有边界的线上陪伴/);
  assert.match(shell, /resolveMiniprogramEntry/);
  assert.doesNotMatch(shell, /miniprogramEntryUrl/);
  assert.match(home, /bubble-hero/);
  assert.match(home, /hero-trust-strip/);
  assert.match(home, /IconOrbit/);
  assert.match(home, /MiniprogramCta/);
  assert.doesNotMatch(home, /showAppComingSoon/);
  assert.match(home, /secondaryHref="\/how-it-works"/);
  assert.match(home, /\/brand\/app-icon\.png/);
  assert.match(home, /有边界的线上陪伴/);
  assert.match(home, /被认真听见/);
  assert.match(home, /home-values|home-trust|home-moment/);
  assert.match(shell, /BrandMark|app-icon\.png/);
  assert.match(cta, /复制名称并在微信搜索/);
  assert.match(cta, /resolveMiniprogramEntry/);
  assert.match(cta, /resolveMiniprogramQr/);
  assert.doesNotMatch(cta, /miniprogramEntryUrl|miniprogramQrUrl|showAppComingSoon/);
  assert.match(cta, /<button/);
  assert.match(reveal, /useScrollEntrance/);
  assert.match(reveal, /IntersectionObserver/);
  assert.match(reveal, /startsInInitialView/);
  assert.match(reveal, /revealState = "static"/);
});

test("keeps light marketing copy on solid forest bands, not bright mint fills", async () => {
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  // Light text sits on path / primary channel / closing bands — those fills must stay dark forest.
  const ruleBodies = [
    [/\.mint-path\s+\.bubble-path-inner\s*,\s*\.home-path\s+\.bubble-path-inner\s*\{([^}]+)\}/s, "mint/home path"],
    [/\.mint-channel-primary\s*\{([^}]+)\}/s, "mint channel primary"],
    [/\.mint-closing\s*\{([^}]+)\}/s, "mint closing"],
    [/\.bubble-channel-card\.primary\s*\{([^}]+)\}/s, "channel primary"],
    [/\.bubble-closing\s*\{([^}]+)\}/s, "bubble closing"],
  ];

  for (const [pattern, label] of ruleBodies) {
    const match = styles.match(pattern);
    assert.ok(match, `${label} rule must exist`);
    const body = match[1];
    assert.match(body, /#0c241c|#0c2a22|#0f2e24|#12352a|#134636/i, `${label} must use solid forest ink`);
    assert.doesNotMatch(
      body,
      /#7ee0a8|#3fd18c|#6fd4a0|rgba\(\s*22\s*,\s*154\s*,\s*95\s*,\s*0\.[1-6]/i,
      `${label} must not use bright mint fills under light copy`,
    );
  }
});

test("safety page keeps evidence-bounded support paths and miniprogram CTA", async () => {
  const [safetySource, styles, response] = await Promise.all([
    readFile(new URL("../components/SafetyScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    render("/safety"),
  ]);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(safetySource, /MiniprogramCta/);
  assert.match(safetySource, /safety-closing-cta/);
  assert.match(safetySource, /site-safety-page|marketing-detail-page/);
  assert.match(html, /选择正确的入口/);
  assert.match(html, /进入小程序后使用对应页面的举报与售后入口/);
  assert.match(html, /不能提供紧急响应/);
  assert.match(html, /举报是线索，不是结论/);
  assert.doesNotMatch(html, /用户数|GMV|融资/);
  // Safety principle / help-path copy must stay at readable body sizes (not microtype).
  // Prefer the last matching rule (later cascade / page-specific reinforcements).
  const helpCardsStrong = [...styles.matchAll(/\.help-cards strong\s*\{[^}]*font-size:\s*([\d.]+)px/gs)].at(-1);
  const helpCardsSmall = [...styles.matchAll(/\.help-cards small\s*\{[^}]*font-size:\s*([\d.]+)px/gs)].at(-1);
  const safetyGridP = [...styles.matchAll(/\.safety-grid p\s*\{[^}]*font-size:\s*([\d.]+)px/gs)].at(-1);
  const safetyGridH3 = [...styles.matchAll(/\.safety-grid h3\s*\{[^}]*font-size:\s*([\d.]+)px/gs)].at(-1);
  assert.ok(helpCardsStrong, "help-cards strong size must be declared");
  assert.ok(helpCardsSmall, "help-cards small size must be declared");
  assert.ok(safetyGridP, "safety-grid p size must be declared");
  assert.ok(safetyGridH3, "safety-grid h3 size must be declared");
  assert.ok(Number(helpCardsStrong[1]) >= 14, `help-cards strong too small: ${helpCardsStrong[1]}px`);
  assert.ok(Number(helpCardsSmall[1]) >= 13, `help-cards small too small: ${helpCardsSmall[1]}px`);
  assert.ok(Number(safetyGridP[1]) >= 13, `safety-grid p too small: ${safetyGridP[1]}px`);
  assert.ok(Number(safetyGridH3[1]) >= 14, `safety-grid h3 too small: ${safetyGridH3[1]}px`);
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

test("keeps marketing motion causal and performant", async () => {
  const [hero, heroStyles, journey, signal] = await Promise.all([
    readFile(new URL("../components/motion/HeroOrchestration.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../components/motion/TrustJourney.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/motion/ConnectionPulse.tsx", import.meta.url), "utf8"),
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
});

test("public HTML never promotes private product routes or unsafe Mini Program config", async () => {
  for (const pathname of ["/", "/how-it-works", "/safety", "/about", "/partners"]) {
    const response = await render(pathname);
    assert.equal(response.status, 200, pathname);
    const html = await response.text();
    assert.doesNotMatch(html, /href=["']\/business(?:["'#?]|$)/, pathname);
    assert.doesNotMatch(html, /href=["']\/demo(?:["'#?]|$)/, pathname);
  }

  await withEnvironment({
    NEXT_PUBLIC_MINIPROGRAM_PATH: "https://evil.example/mp?token=unsafe",
    NEXT_PUBLIC_MINIPROGRAM_QR_URL: "https://evil.example/qr.png#unsafe",
  }, async () => {
    const response = await render("/");
    const html = await response.text();
    assert.doesNotMatch(html, /evil\.example|token=unsafe|#unsafe/);
  });
});

test("built worker emits security headers for public HTML", async () => {
  const response = await render("/", { origin: "https://talkandtalk.app" });
  const csp = response.headers.get("content-security-policy") ?? "";
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.match(response.headers.get("permissions-policy") ?? "", /camera=\(\), geolocation=\(\), microphone=\(\)/);
  assert.match(response.headers.get("strict-transport-security") ?? "", /max-age=31536000/);
});

test("built worker emits the same security boundary for optimized images", async () => {
  const response = await optimizedImageRequest();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.match(response.headers.get("permissions-policy") ?? "", /camera=\(\)/);
  assert.match(response.headers.get("strict-transport-security") ?? "", /max-age=31536000/);
});

test("image transformation is opt-in after a configured binding is verified", async () => {
  const response = await optimizedImageRequest({ TALKTALK_IMAGE_TRANSFORM_ENABLED: "true" });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "image");
});

test("built Worker declares the bindings required for local public image requests", async () => {
  const config = JSON.parse(await readFile(new URL("../dist/server/wrangler.json", import.meta.url), "utf8"));
  assert.equal(config.assets?.binding, "ASSETS");
  assert.equal(config.assets?.not_found_handling, "none");
  assert.equal(config.images?.binding, "IMAGES");
});

test("optimized images safely use the original asset without a local transformer", async () => {
  const response = await optimizedImageRequest({ IMAGES: undefined });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "asset");
  assert.match(response.headers.get("cache-control") ?? "", /immutable/);
});

test("optimized image endpoint accepts every emitted public brand width", async () => {
  for (const width of [36, 44, 220, 420, 640]) {
    const response = await optimizedImageRequest({ width, IMAGES: undefined });
    assert.equal(response.status, 200, `width=${width}`);
    assert.equal(await response.text(), "asset", `width=${width}`);
  }
});

test("optimized image endpoint fails closed when the required assets binding is absent", async () => {
  const response = await optimizedImageRequest({ ASSETS: undefined, IMAGES: undefined });
  assert.equal(response.status, 503);
  assert.match(await response.text(), /Image assets are unavailable/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
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
  assert.match(shell, /resolveMiniprogramEntry/);
  assert.doesNotMatch(shell, /miniprogramEntryUrl|miniprogramQrUrl/);
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

  if (process.env.NODE_ENV === "production" || process.env.WEB_DEFAULT_SURFACE_TEST === "1") {
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error.code, "ROUTE_NOT_ALLOWED");
    return;
  }

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
