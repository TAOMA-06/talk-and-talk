#!/usr/bin/env node
/**
 * Static assertions for the commercial nginx example + CloudBase exposure note.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const confPath = join(root, "infra", "nginx", "talk-and-talk.conf.example");
const cloudbasePath = join(root, "infra", "cloudbase", "cloudbaserc.voice-ready.template.json");

test("nginx example locks /review/ and raises bill-import body size", () => {
  const conf = readFileSync(confPath, "utf8");
  assert.match(conf, /location\s+\/review\//);
  assert.match(conf, /location\s+\/admin\//);
  assert.match(conf, /location\s+\/review\/\s*\{[\s\S]*?deny\s+all;/);
  assert.match(conf, /location\s+\/admin\/\s*\{[\s\S]*?deny\s+all;/);
  assert.match(
    conf,
    /location\s+=\s+\/api\/v1\/admin\/commercial\/payment-reconciliation\/merchant-imports\/text\s*\{[\s\S]*?client_max_body_size\s+20m;/
  );
  assert.match(conf, /location\s+=\s+\/api\/v1\/health\/ready\s*\{[\s\S]*?deny\s+all;/);
  assert.match(conf, /client_max_body_size\s+1m;/);
});

test("CloudBase template marks private ingress as required for servicePath=/", () => {
  const cloudbase = JSON.parse(readFileSync(cloudbasePath, "utf8"));
  assert.equal(cloudbase.PRIVATE_INGRESS_REQUIRED, true);
  assert.equal(cloudbase.framework.plugins["talk-and-talk-api"].inputs.servicePath, "/");
});
