import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { nonPassingTestCount, runZeroSkipTest } from "./assert-zero-skips.mjs";

test("zero-skip parser rejects complete terminal Jest and Node TAP outcome blocks", () => {
  assert.equal(nonPassingTestCount("Test Suites: 1 pending, 1 total\nTests: 2 skipped, 1 todo, 3 cancelled, 6 total\nSnapshots: 0 total\nTime: 1 s\nRan all test suites.\n"), 7);
  assert.equal(nonPassingTestCount("TAP version 13\nok 1 - deferred provider # SKIP unavailable\nok 2 - later # TODO policy\n"), 2);
  assert.equal(nonPassingTestCount("TAP version 13\n1..4\n# tests 4\n# suites 0\n# pass 3\n# fail 0\n# cancelled 1\n# skipped 1\n# todo 0\n# duration_ms 1\n"), 2);
  assert.equal(nonPassingTestCount("TAP version 13\nok 1 - deferred provider # SKIP unavailable\n1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 1\n"), 1);
  assert.equal(nonPassingTestCount("TAP version 13\n1..4\n# tests 4\n# suites 0\n# pass 4\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 1\n"), 0);
});

test("zero-skip parser ignores business diagnostics that resemble outcome counts", () => {
  const diagnostics = [
    "Availability reminder delivery scanned=2 skipped=0 failed=0",
    "Availability reminder preparation scanned=5 reserved=5 skipped=0",
    "Availability reminder delivery scanned=1 authorized=0 sent=0 skipped=0",
    "Retries: 2 skipped by a business rule; later 4 skipped by a policy",
    "  Test Suites: 144 skipped, 144 total",
    "  Tests: 1337 skipped, 1337 total",
    "# skipped 2",
    "Test Suites: 144 passed, 144 total",
    "Tests: 1337 passed, 1337 total",
  ].join("\n");
  assert.equal(nonPassingTestCount(diagnostics), 0);
});

test("zero-skip parser ignores a real Jest console diagnostic but rejects its terminal summary", () => {
  const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const root = mkdtempSync(join(apiRoot, "scripts", "zero-skip-jest-"));
  try {
    const fixture = join(root, "console-diagnostic.spec.ts");
    writeFileSync(fixture, 'test("logs", () => { console.log("Tests: 2 skipped, 2 total"); expect(true).toBe(true); });\n', "utf8");
    const jest = join(apiRoot, "node_modules", "jest", "bin", "jest.js");
    assert.equal(existsSync(jest), true);
    const environment = { ...process.env };
    delete environment.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, [jest, "--runInBand", "--runTestsByPath", fixture], {
      cwd: apiRoot,
      encoding: "utf8",
      env: environment,
    });
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 0, output);
    assert.match(output, /Tests: 2 skipped, 2 total/);
    assert.equal(nonPassingTestCount(output), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("zero-skip runner accepts a colocated npm command surface without PATH-resolved npm", async () => {
  const calls = [];
  const child = {
    stdout: { on(_event, callback) { callback("TAP version 13\n1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 1\n"); } },
    stderr: { on() {} },
    once(event, callback) {
      if (event === "close") callback(0, null);
    },
  };
  await runZeroSkipTest(["--npm", "run", "check"], {
    writeStdout() {},
    writeStderr() {},
    spawnCommand(command, args, options) {
      calls.push({ args, command, options });
      return child;
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, process.execPath);
  assert.match(calls[0].args[0], /npm[\\/]bin[\\/]npm-cli\.js$/);
  assert.deepEqual(calls[0].args.slice(1), ["run", "check"]);
});

test("zero-skip runner waits for delayed final stream output before accepting the command", async () => {
  const callbacks = {};
  const child = {
    stdout: { on(event, callback) { callbacks.stdout = callback; assert.equal(event, "data"); } },
    stderr: { on(event, callback) { callbacks.stderr = callback; assert.equal(event, "data"); } },
    once(event, callback) { callbacks[event] = callback; },
  };
  const result = runZeroSkipTest(["--node-test", "placeholder.test.mjs"], {
    writeStdout() {},
    writeStderr() {},
    spawnCommand() { return child; },
  });

  callbacks.exit?.(0, null);
  callbacks.stdout("TAP version 13\n1..1\n# tests 1\n# suites 0\n# pass 0\n# fail 0\n# cancelled 0\n");
  callbacks.stdout("# skipped 1\n# todo 0\n# duration_ms 1\n");
  callbacks.close(0, null);

  await assert.rejects(result, /rejected 1 skipped/i);
});
