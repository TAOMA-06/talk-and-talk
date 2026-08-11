import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const apiRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const e2eRoot = join(apiRoot, "test");

function e2eSpecs(directory = e2eRoot) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return e2eSpecs(path);
    return entry.isFile() && entry.name.endsWith(".e2e-spec.ts") ? [path] : [];
  });
}

test("every candidate E2E specification is executable; no skip or todo can consume a protected disposable run", () => {
  const deferred = [];
  for (const path of e2eSpecs()) {
    const source = readFileSync(path, "utf8");
    if (/\b(?:it|test|describe)\s*\.\s*(?:skip|todo)\s*\(/.test(source)) {
      deferred.push(path.slice(apiRoot.length + 1));
    }
  }
  assert.deepEqual(deferred, []);
});
