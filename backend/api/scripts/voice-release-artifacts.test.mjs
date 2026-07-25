import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  TLS_SIG_PACKAGE,
  TLS_SIG_VERSION,
  TRTC_MINIPROGRAM_PACKAGE,
  TRTC_MINIPROGRAM_VERSION,
  validateVoiceReleaseArtifacts
} from "./voice-release-artifacts.mjs";

async function createReleaseFixture() {
  const root = await mkdtemp(join(tmpdir(), "talk-and-talk-voice-release-"));
  const backendRoot = join(root, "backend/api");
  const miniProgramRoot = join(root, "frontend/miniprogram");
  const backendPackage = {
    name: "fixture-api",
    private: true,
    dependencies: { [TLS_SIG_PACKAGE]: TLS_SIG_VERSION }
  };
  const packageLock = {
    name: "fixture-api",
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { [TLS_SIG_PACKAGE]: TLS_SIG_VERSION } },
      [`node_modules/${TLS_SIG_PACKAGE}`]: { version: TLS_SIG_VERSION }
    }
  };

  await mkdir(join(backendRoot, "node_modules", TLS_SIG_PACKAGE), { recursive: true });
  await mkdir(join(miniProgramRoot, "miniprogram_npm", TRTC_MINIPROGRAM_PACKAGE), { recursive: true });
  await mkdir(join(miniProgramRoot, "pages/voice"), { recursive: true });
  await writeFile(join(backendRoot, "package.json"), JSON.stringify(backendPackage));
  await writeFile(join(backendRoot, "package-lock.json"), JSON.stringify(packageLock));
  await writeFile(
    join(backendRoot, "node_modules", TLS_SIG_PACKAGE, "package.json"),
    JSON.stringify({ name: TLS_SIG_PACKAGE, version: TLS_SIG_VERSION, main: "index.js" })
  );
  await writeFile(join(backendRoot, "node_modules", TLS_SIG_PACKAGE, "index.js"), "module.exports = {};\n");
  await writeFile(
    join(miniProgramRoot, "package.json"),
    JSON.stringify({ name: "fixture-mini-program", dependencies: { [TRTC_MINIPROGRAM_PACKAGE]: TRTC_MINIPROGRAM_VERSION } })
  );
  await writeFile(join(miniProgramRoot, "miniprogram_npm", TRTC_MINIPROGRAM_PACKAGE, "index.js"), "module.exports = {};\n");
  await writeFile(join(miniProgramRoot, "pages/voice/index.ts"), 'const TRTC = require("trtc-wx-sdk");\n');
  return root;
}

test("accepts a complete backend signer and Mini Program RTC build fixture", async () => {
  const root = await createReleaseFixture();
  try {
    assert.deepEqual(validateVoiceReleaseArtifacts(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports a missing locked signer and Mini Program npm build output", async () => {
  const root = await createReleaseFixture();
  try {
    await rm(join(root, "backend/api/package-lock.json"));
    await rm(join(root, "backend/api/node_modules", TLS_SIG_PACKAGE), { recursive: true });
    await rm(join(root, "frontend/miniprogram/miniprogram_npm", TRTC_MINIPROGRAM_PACKAGE), { recursive: true });

    const errors = validateVoiceReleaseArtifacts(root).join("\n");
    assert.match(errors, /must lock tls-sig-api-v2@1\.0\.2/);
    assert.match(errors, /not resolvable from backend\/api/);
    assert.match(errors, /构建 npm/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
