import assert from "node:assert/strict";
import test from "node:test";

import {
  miniprogramCtaCopy,
  resolveMiniprogramEntry,
  resolveMiniprogramQr,
} from "../lib/miniprogram-entry.ts";

test("missing config yields honest search fallback", () => {
  const resolution = resolveMiniprogramEntry({
    path: "",
    qrUrl: "",
    searchName: "Talk&Talk",
  });
  assert.equal(resolution.kind, "fallback");
  assert.equal(resolution.reason, "config_missing");
  const copy = miniprogramCtaCopy(resolution);
  assert.equal(copy.fallback, true);
  assert.match(copy.primary, /Talk&Talk/);
});

test("allowlisted https QR is accepted", () => {
  const resolution = resolveMiniprogramEntry({
    path: "",
    qrUrl: "https://cdn.talkandtalk.app/qr/mini.png",
  });
  assert.deepEqual(resolution, {
    kind: "qr",
    href: "https://cdn.talkandtalk.app/qr/mini.png",
  });
});

test("non-allowlisted QR host falls back", () => {
  const resolution = resolveMiniprogramEntry({
    path: "",
    qrUrl: "https://evil.example/qr.png",
  });
  assert.equal(resolution.kind, "fallback");
  assert.equal(resolution.reason, "qr_host_not_allowlisted");
});

test("a valid QR remains separately resolvable when a configured deep link is rejected", () => {
  const entry = resolveMiniprogramEntry({
    path: "https://evil.example/mp",
    qrUrl: "https://cdn.talkandtalk.app/qr/mini.png",
  });
  const qr = resolveMiniprogramQr({ qrUrl: "https://cdn.talkandtalk.app/qr/mini.png" });
  assert.deepEqual(entry, {
    kind: "fallback",
    searchName: "Talk&Talk",
    reason: "entry_host_not_allowlisted",
  });
  assert.deepEqual(qr, { kind: "qr", href: "https://cdn.talkandtalk.app/qr/mini.png" });
});

test("QR resolver rejects raw hostile configuration values", () => {
  for (const qrUrl of [
    "javascript:alert(1)",
    "https://evil.example/qr.png",
    "https://user:pass@cdn.talkandtalk.app/qr.png",
    "https://cdn.talkandtalk.app/qr.png#fragment",
    "https://cdn.talkandtalk.app/qr.png?cache=1",
  ]) {
    assert.equal(resolveMiniprogramQr({ qrUrl }).kind, "fallback", qrUrl);
  }
});

test("weixin scheme path is accepted (query tokens allowed)", () => {
  const resolution = resolveMiniprogramEntry({
    path: "weixin://dl/business/?t=demo",
    qrUrl: "",
  });
  assert.equal(resolution.kind, "path");
});

test("weixin deep links must target the official Mini Program entry only", () => {
  for (const [path, reason] of [
    ["weixin://evil.example/business/?t=demo", "entry_weixin_target_not_allowlisted"],
    ["weixin://dl/other/?t=demo", "entry_weixin_target_not_allowlisted"],
    ["weixin://dl/business/extra?t=demo", "entry_weixin_target_not_allowlisted"],
    ["weixin://dl/business/?redirect=https%3A%2F%2Fevil.example", "entry_weixin_target_not_allowlisted"],
    ["weixin://dl/business/?t=one&t=two", "entry_weixin_target_not_allowlisted"],
    ["weixin://dl/business/?t=", "entry_weixin_target_not_allowlisted"],
    ["weixin://dl:8443/business/?t=demo", "entry_url_injection"],
    ["weixin://user:pass@dl/business/?t=demo", "entry_url_injection"],
    ["weixin://dl/business/?t=demo#fragment", "entry_url_injection"],
  ]) {
    const resolution = resolveMiniprogramEntry({ path, qrUrl: "" });
    assert.equal(resolution.kind, "fallback", path);
    assert.equal(resolution.reason, reason, path);
  }
});

test("allowlisted https entry path is accepted without injection", () => {
  const resolution = resolveMiniprogramEntry({
    path: "https://talkandtalk.app/mp",
    qrUrl: "",
  });
  assert.equal(resolution.kind, "path");
});

test("https entry path with non-allowlisted host falls back", () => {
  const resolution = resolveMiniprogramEntry({
    path: "https://evil.example/mp",
    qrUrl: "",
  });
  assert.equal(resolution.kind, "fallback");
  assert.equal(resolution.reason, "entry_host_not_allowlisted");
});

test("credentials, fragments, and https query strings are rejected", () => {
  assert.equal(
    resolveMiniprogramEntry({ path: "https://user:pass@talkandtalk.app/mp" }).kind,
    "fallback",
  );
  assert.equal(
    resolveMiniprogramEntry({ qrUrl: "https://cdn.talkandtalk.app/q.png#x" }).kind,
    "fallback",
  );
  assert.equal(
    resolveMiniprogramEntry({ qrUrl: "https://cdn.talkandtalk.app/q.png?x=1" }).kind,
    "fallback",
  );
  assert.equal(
    resolveMiniprogramEntry({ path: "https://talkandtalk.app/mp?x=1" }).kind,
    "fallback",
  );
  assert.equal(
    resolveMiniprogramEntry({ path: "https://talkandtalk.app:8443/mp" }).kind,
    "fallback",
  );
});

test("javascript or bare tokens are not promoted to deep links", () => {
  assert.equal(
    resolveMiniprogramEntry({ path: "javascript:alert(1)" }).kind,
    "fallback",
  );
  assert.equal(
    resolveMiniprogramEntry({ path: "pages/home/index" }).kind,
    "fallback",
  );
});
