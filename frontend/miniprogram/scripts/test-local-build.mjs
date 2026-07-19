import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(sourceRoot, "../..");
const generator = join(sourceRoot, "scripts/create-local-copy.mjs");
const validator = join(sourceRoot, "scripts/validate.mjs");
const localApiBaseUrl = "http://127.0.0.1:3000/api/v1";
const releaseEnvironment = {
  MINIPROGRAM_RELEASE: "1",
  WECHAT_MINIPROGRAM_APP_ID: "wx1234567890abcdef"
};

function run(script, args = [], environment = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, ...environment }
  });
}

function processOutput(result) {
  return `${result.stdout || ""}${result.stderr || ""}`;
}

function requireSuccess(result, description) {
  assert.equal(result.status, 0, `${description} failed:\n${processOutput(result)}`);
}

const sourceConfigPath = join(sourceRoot, "utils/config.ts");
const sourceProjectPath = join(sourceRoot, "project.config.json");
const sourceConfigBefore = readFileSync(sourceConfigPath, "utf8");
const sourceProjectBefore = readFileSync(sourceProjectPath, "utf8");
const temporaryRoot = mkdtempSync(join(tmpdir(), "talkandtalk-miniprogram-local-build-"));
const generatedRoot = join(temporaryRoot, "project");

try {
  requireSuccess(
    run(generator, ["--api-base-url", localApiBaseUrl, "--output", generatedRoot]),
    "local Mini Program copy generation"
  );

  const generatedConfig = readFileSync(join(generatedRoot, "utils/config.ts"), "utf8");
  const generatedProject = JSON.parse(readFileSync(join(generatedRoot, "project.config.json"), "utf8"));
  assert.match(generatedConfig, /GENERATED LOCAL DEVTOOLS BUILD ONLY/);
  assert.match(generatedConfig, /API_BASE_URL = "http:\/\/127\.0\.0\.1:3000\/api\/v1"/);
  assert.match(generatedConfig, /privacy: "http:\/\/127\.0\.0\.1:3000\/legal\/privacy\.html"/);
  assert.match(generatedConfig, /terms: "http:\/\/127\.0\.0\.1:3000\/legal\/terms\.html"/);
  assert.doesNotMatch(generatedConfig, /WECHAT_MINIPROGRAM_APP_SECRET/);
  assert.equal(generatedProject.setting.urlCheck, false);
  assert.equal(generatedProject.projectname, "talk-and-talk-local-do-not-upload");
  assert.equal(generatedProject.appid, undefined);
  assert.ok(existsSync(join(generatedRoot, ".talkandtalk-local-build")));

  const stagingRoot = join(temporaryRoot, "staging-project");
  requireSuccess(
    run(generator, ["--api-base-url", "https://api-staging.talkandtalk.app/api/v1", "--output", stagingRoot]),
    "HTTPS staging Mini Program copy generation"
  );
  const stagingProject = JSON.parse(readFileSync(join(stagingRoot, "project.config.json"), "utf8"));
  assert.equal(stagingProject.setting.urlCheck, true, "HTTPS staging copies must retain domain validation");

  requireSuccess(run(validator, [], releaseEnvironment), "production source release validation");

  const generatedReleaseValidation = run(validator, ["--root", generatedRoot], releaseEnvironment);
  assert.notEqual(generatedReleaseValidation.status, 0, "release validation must reject a generated local copy");
  assert.match(processOutput(generatedReleaseValidation), /setting\.urlCheck=true/);
  assert.match(processOutput(generatedReleaseValidation), /API_BASE_URL must use a public HTTPS domain/);

  const insecurePublicHttp = run(generator, [
    "--api-base-url", "http://example.com/api/v1",
    "--output", join(temporaryRoot, "insecure-http")
  ]);
  assert.notEqual(insecurePublicHttp.status, 0, "the generator must reject an insecure public HTTP endpoint");
  assert.match(processOutput(insecurePublicHttp), /http API targets are limited/);

  assert.equal(readFileSync(sourceConfigPath, "utf8"), sourceConfigBefore, "generation must not edit the release API config");
  assert.equal(readFileSync(sourceProjectPath, "utf8"), sourceProjectBefore, "generation must not edit the release project config");
  console.log("Mini Program local-build isolation test passed");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
