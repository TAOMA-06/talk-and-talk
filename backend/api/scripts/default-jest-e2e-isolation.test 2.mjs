import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const apiDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jestBinary = resolve(apiDirectory, "node_modules/jest/bin/jest.js");

test("the ordinary Jest entrypoint never discovers destructive E2E specs", () => {
  const output = execFileSync(
    process.execPath,
    [jestBinary, "--listTests", "--runInBand", "--no-cache"],
    { cwd: apiDirectory, encoding: "utf8" }
  );
  const testPaths = output.trim().split("\n").filter(Boolean);

  assert.ok(testPaths.length > 0, "the default Jest entrypoint should still discover unit specs");
  assert.equal(
    testPaths.some((path) => /[/\\]test[/\\].*\.e2e-spec\.ts$/.test(path)),
    false,
    "only test/jest-e2e.json may select destructive E2E specs"
  );
});

test("formal E2E suppresses request-log I/O without widening the global timeout", async () => {
  const [manifest, config] = await Promise.all([
    readFile(resolve(apiDirectory, "package.json"), "utf8").then(JSON.parse),
    readFile(resolve(apiDirectory, "test/jest-e2e.json"), "utf8").then(JSON.parse)
  ]);
  assert.match(manifest.scripts["test:e2e"], /--runInBand --silent$/);
  assert.equal(config.testTimeout, undefined);
});
