import assert from "node:assert/strict";
import test from "node:test";

import {
  miniprogramCtaCopy,
  resolveMiniprogramEntry,
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

test("weixin scheme path is accepted (query tokens allowed)", () => {
  const resolution = resolveMiniprogramEntry({
    path: "weixin://dl/business/?t=demo",
    qrUrl: "",
  });
  assert.equal(resolution.kind, "path");
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
