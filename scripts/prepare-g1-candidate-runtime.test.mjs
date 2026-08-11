import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDirectory = fileURLToPath(new URL(".", import.meta.url));
const script = join(scriptsDirectory, "prepare-g1-candidate-runtime.sh");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "talk-and-talk-g1-runtime-test-"));
  const runnerToolCache = join(root, "toolcache");
  const nodePrefix = join(runnerToolCache, "node", "22.99.0", "x64");
  const nodeBin = join(nodePrefix, "bin");
  const node = join(nodeBin, "node");
  const npmCli = join(nodePrefix, "lib", "node_modules", "npm", "bin", "npm-cli.js");
  const runnerTemp = join(root, "runner-temp");
  const githubEnv = join(root, "github-env");
  mkdirSync(nodeBin, { recursive: true });
  mkdirSync(dirname(npmCli), { recursive: true });
  mkdirSync(runnerTemp, { recursive: true });
  writeFileSync(node, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  chmodSync(node, 0o700);
  writeFileSync(npmCli, "// fixture\n", { mode: 0o600 });
  writeFileSync(githubEnv, "", { mode: 0o600 });
  return { githubEnv, nodeBin, node, npmCli, root, runnerTemp, runnerToolCache };
}

function run(environment = {}) {
  const created = fixture();
  const result = spawnSync("/bin/sh", [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      BASH_ENV: "/dev/null",
      ENV: "/dev/null",
      GITHUB_ENV: created.githubEnv,
      HOME: "/hostile-home",
      NODE_OPTIONS: "",
      NODE_PATH: "",
      PATH: `${created.nodeBin}:/usr/bin:/bin`,
      RUNNER_TEMP: created.runnerTemp,
      RUNNER_TOOL_CACHE: created.runnerToolCache,
      ...environment,
    },
  });
  return { ...created, result };
}

function exportedEnvironment(path) {
  return Object.fromEntries(readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => {
    const equals = line.indexOf("=");
    return [line.slice(0, equals), line.slice(equals + 1)];
  }));
}

test("prepares a sealed HOME, npm config, cache, PATH, and fixed Node/npm paths", () => {
  const current = run();
  try {
    assert.equal(current.result.status, 0, current.result.stderr);
    const environment = exportedEnvironment(current.githubEnv);
    assert.equal(environment.CANDIDATE_NODE_EXECUTABLE, realpathSync(current.node));
    assert.equal(environment.CANDIDATE_NPM_CLI, realpathSync(current.npmCli));
    assert.notEqual(environment.HOME, "/hostile-home");
    assert.match(environment.PATH, new RegExp(`^${dirname(environment.CANDIDATE_NODE_EXECUTABLE).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`));
    assert.equal(environment.NPM_CONFIG_USERCONFIG, `${environment.HOME}/.npmrc`);
    assert.equal(environment.NPM_CONFIG_GLOBALCONFIG, "/dev/null");
    assert.equal(environment.NPM_CONFIG_CACHE, `${environment.CANDIDATE_RUNTIME_ROOT}/npm-cache`);
    assert.equal(environment.LD_AUDIT, "");
    assert.equal(environment.LD_LIBRARY_PATH, "");
    assert.equal(environment.LD_PRELOAD, "");
    assert.equal(environment.DYLD_INSERT_LIBRARIES, "");
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("refuses preload, shell-init, and npm-config injection before exporting a runtime", () => {
  for (const environment of [
    { NODE_OPTIONS: "--require=/tmp/hostile.cjs" },
    { NODE_PATH: "/tmp/hostile-modules" },
    { LD_AUDIT: "/tmp/hostile-audit.so" },
    { LD_PRELOAD: "/tmp/hostile.so" },
    { LD_LIBRARY_PATH: "/tmp/hostile-library" },
    { BASH_ENV: "/tmp/hostile-bash-init" },
    { ENV: "/tmp/hostile-sh-init" },
    { NPM_CONFIG_REGISTRY: "https://hostile.invalid/" },
    { npm_config_registry: "https://hostile.invalid/" },
  ]) {
    const current = run(environment);
    try {
      assert.notEqual(current.result.status, 0, JSON.stringify(environment));
      assert.match(current.result.stderr, /G1 candidate runtime refused/);
      assert.equal(readFileSync(current.githubEnv, "utf8"), "");
    } finally {
      rmSync(current.root, { recursive: true, force: true });
    }
  }
});

test("clears macOS native-loader variables for every later candidate step", () => {
  const source = readFileSync(script, "utf8");
  for (const variable of [
    "DYLD_FORCE_FLAT_NAMESPACE",
    "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH",
    "DYLD_ROOT_PATH",
  ]) {
    assert.match(source, new RegExp(`\\[ -z "\\$\\{${variable}:-\\}" \\] \\|\\| fail`), `${variable} must be rejected before bootstrap`);
    assert.match(source, new RegExp(`printf '${variable}=\\\\n'`), `${variable} must be cleared for later steps`);
  }
});
