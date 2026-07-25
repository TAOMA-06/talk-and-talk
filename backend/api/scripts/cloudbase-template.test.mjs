import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  defaultCloudBaseTemplatePath,
  validateCloudBaseTemplate
} from "./validate-cloudbase-template.mjs";

async function writeFixture(config) {
  const root = await mkdtemp(join(tmpdir(), "talk-and-talk-cloudbase-template-"));
  const path = join(root, "cloudbaserc.template.json");
  await writeFile(path, JSON.stringify(config));
  return { root, path };
}

test("accepts the reviewed voice-ready CloudBase template", () => {
  assert.deepEqual(validateCloudBaseTemplate(defaultCloudBaseTemplatePath), []);
});

test("rejects scale-to-zero and source-controlled runtime credentials", async () => {
  const template = JSON.parse(await readFile(defaultCloudBaseTemplatePath, "utf8"));
  template.framework.plugins["talk-and-talk-api"].inputs.minNum = 0;
  template.framework.plugins["talk-and-talk-api"].inputs.envVariables = {
    TRTC_SDK_SECRET_KEY: "must-not-be-here"
  };
  const fixture = await writeFixture(template);

  try {
    const errors = validateCloudBaseTemplate(fixture.path).join("\n");
    assert.match(errors, /minNum must be an integer of at least 1/);
    assert.match(errors, /must omit envVariables/);
    assert.match(errors, /TRTC_SDK_SECRET_KEY must not be stored/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
