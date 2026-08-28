import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCandidateInputPolicy,
  isForbiddenIgnoredCandidateConfig,
  isForbiddenTrackedCandidateConfig,
} from "./candidate-input-policy.mjs";

function applyPolicy({ tree = "", index = "", tracked = "", ignored = "" } = {}) {
  return assertCandidateInputPolicy({
    gitText(args) {
      const command = args.join(" ");
      if (command === "ls-tree -r HEAD") return tree;
      if (command === "ls-files -s") return index;
      if (command === "ls-files") return tracked;
      if (command === "status --ignored --porcelain=v1 --untracked-files=all") return ignored;
      throw new Error(`Unexpected Git query: ${command}`);
    },
    fail(message) {
      throw new Error(message);
    },
  });
}

test("candidate input policy accepts tracked public templates and ordinary ignored build outputs", () => {
  assert.equal(isForbiddenTrackedCandidateConfig("frontend/web/.env.example"), false);
  assert.equal(isForbiddenTrackedCandidateConfig("backend/api/.env.production.example"), false);
  assert.equal(isForbiddenTrackedCandidateConfig("frontend/web/.ENV.EXAMPLE"), false);
  assert.equal(isForbiddenIgnoredCandidateConfig("backend/api/.ENV.PRODUCTION.EXAMPLE"), false);
  assert.equal(isForbiddenIgnoredCandidateConfig("frontend/web/dist/"), false);
  assert.doesNotThrow(() => applyPolicy({
    tracked: "frontend/web/.env.example\nbackend/api/.ENV.PRODUCTION.EXAMPLE\npackage.json\n",
    ignored: "!! frontend/web/dist/\n!! backend/api/.ENV.EXAMPLE\n!! backend/api/node_modules/\n",
  }));
});

test("candidate input policy rejects every tracked package, private Mini, and environment configuration input", () => {
  for (const path of [
    "backend/api/.env",
    "frontend/web/.env.local",
    "backend/api/.envrc",
    ".npmrc",
    ".yarnrc",
    ".yarnrc.yml",
    ".pnpmfile.cjs",
    ".pnpmfile.js",
    "backend/api/npm-shrinkwrap.json",
    "frontend/miniprogram/NpM-Shrinkwrap.JsOn",
    "frontend/miniprogram/project.private.config.json",
    "frontend/web/.ENV.Local",
    "backend/api/.ENVRC",
    ".NPMRC",
    ".YARNRC",
    ".YARNRC.YML",
    ".PNPMFILE.CJS",
    ".PNPMFILE.JS",
    "frontend/miniprogram/PROJECT.PRIVATE.CONFIG.JSON",
  ]) {
    assert.equal(isForbiddenTrackedCandidateConfig(path), true, path);
    assert.throws(() => applyPolicy({ tracked: `${path}\n` }), /tracked private configuration input/);
  }
});

test("candidate input policy rejects every ignored package, private Mini, and environment configuration input", () => {
  for (const path of [
    "backend/api/.env",
    "frontend/web/.env.local",
    "backend/api/.envrc",
    ".npmrc",
    ".yarnrc",
    ".yarnrc.yml",
    ".pnpmfile.cjs",
    ".pnpmfile.js",
    "frontend/web/npm-shrinkwrap.json",
    "backend/api/NPM-SHRINKWRAP.JSON",
    "frontend/miniprogram/project.private.config.json",
    "frontend/web/.ENV.Local",
    "backend/api/.ENVRC",
    ".NPMRC",
    ".YARNRC",
    ".YARNRC.YML",
    ".PNPMFILE.CJS",
    ".PNPMFILE.JS",
    "frontend/miniprogram/PROJECT.PRIVATE.CONFIG.JSON",
  ]) {
    assert.equal(isForbiddenIgnoredCandidateConfig(path), true, path);
    assert.throws(() => applyPolicy({ ignored: `!! ${path}\n` }), /ignored configuration input/);
  }
});

test("candidate input policy rejects a Gitlink or tracked symlink before gate execution", () => {
  assert.throws(
    () => applyPolicy({ tree: `160000 commit ${"a".repeat(40)}\t.worktrees/unmapped\n` }),
    /unresolved gitlink/,
  );
  assert.throws(
    () => applyPolicy({ index: `${"a".repeat(40)} 0\tlinked-source\n`.replace(/^/, "120000 ") }),
    /tracked symbolic link/,
  );
});
