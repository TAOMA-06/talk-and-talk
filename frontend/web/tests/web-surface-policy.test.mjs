import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyWebSurface,
  dispositionForPath,
  isDeferredWebSurfaceEnabled,
  isProductionCandidateSurface,
  sitemapPublicPaths,
  shouldIndexPath,
} from "../lib/web-surface-policy.ts";

test("classifies marketing, private, deferred, and API surfaces", () => {
  assert.equal(classifyWebSurface("/"), "publicMarketing");
  assert.equal(classifyWebSurface("/how-it-works"), "publicMarketing");
  assert.equal(classifyWebSurface("/business"), "privateConditional");
  assert.equal(classifyWebSurface("/demo"), "privateConditional");
  assert.equal(classifyWebSurface("/discover"), "deferredWebApp");
  assert.equal(classifyWebSurface("/companions/abc"), "deferredWebApp");
  assert.equal(classifyWebSurface("/orders"), "deferredWebApp");
  assert.equal(classifyWebSurface("/api/session/login"), "devOnlyApi");
  assert.equal(classifyWebSurface("/api/backend/orders"), "devOnlyApi");
  assert.equal(classifyWebSurface("/unknown-route"), "deferredWebApp");
});

test("NODE_ENV=production fail-closes deferred trade without explicit open mode", () => {
  const prod = { NODE_ENV: "production" };
  assert.equal(isProductionCandidateSurface(prod), true);
  assert.equal(dispositionForPath("/", prod), "allow");
  assert.equal(dispositionForPath("/safety", prod), "allow");
  assert.equal(dispositionForPath("/business", prod), "notFound");
  assert.equal(dispositionForPath("/demo", prod), "notFound");
  assert.equal(dispositionForPath("/discover", prod), "notFound");
  assert.equal(dispositionForPath("/login", prod), "notFound");
  assert.equal(dispositionForPath("/api/backend/foo", prod), "routeNotAllowed");
  assert.equal(dispositionForPath("/api/session", prod), "routeNotAllowed");
});

test("WEB_SURFACE_MODE=production refuses deferred trade and private surfaces", () => {
  const prod = { WEB_SURFACE_MODE: "production" };
  assert.equal(isProductionCandidateSurface(prod), true);
  assert.equal(dispositionForPath("/orders", prod), "notFound");
  assert.equal(dispositionForPath("/api/backend/orders", prod), "routeNotAllowed");
});

test("WEB_SURFACE_MODE=open keeps deferred pages for local/html tests", () => {
  const open = { NODE_ENV: "production", WEB_SURFACE_MODE: "open" };
  assert.equal(isProductionCandidateSurface(open), false);
  assert.equal(dispositionForPath("/discover", open), "allow");
  assert.equal(dispositionForPath("/api/session/login", open), "allow");
});

test("deferred surfaces require explicit flag and non-production API allowlist", () => {
  assert.equal(
    isDeferredWebSurfaceEnabled({
      WEB_ENABLE_DEFERRED_SURFACES: "true",
      TALKTALK_API_BASE_URL: "https://api.talkandtalk.app/api/v1",
    }),
    false,
  );
  assert.equal(
    isDeferredWebSurfaceEnabled({
      WEB_ENABLE_DEFERRED_SURFACES: "true",
      TALKTALK_API_BASE_URL: "http://127.0.0.1:3101/api/v1",
    }),
    true,
  );

  const isolatedDev = {
    WEB_SURFACE_MODE: "development",
    WEB_ENABLE_DEFERRED_SURFACES: "true",
    TALKTALK_API_BASE_URL: "http://127.0.0.1:3101/api/v1",
  };
  assert.equal(dispositionForPath("/discover", isolatedDev), "allow");
  assert.equal(dispositionForPath("/api/backend/orders", isolatedDev), "allow");
});

test("sitemap only lists public marketing paths and excludes business/demo", () => {
  const paths = sitemapPublicPaths();
  assert.deepEqual(paths, ["/", "/how-it-works", "/safety", "/partners", "/about"]);
  assert.equal(shouldIndexPath("/"), true);
  assert.equal(shouldIndexPath("/business"), false);
  assert.equal(shouldIndexPath("/demo"), false);
  assert.equal(shouldIndexPath("/discover"), false);
});
