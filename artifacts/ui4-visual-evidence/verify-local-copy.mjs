import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const sourceRoot = resolve(repoRoot, "frontend/miniprogram");
const localRoot = resolve(process.env.UI4_LOCAL_COPY_PATH?.trim() || resolve(repoRoot, "frontend/miniprogram-local"));
const outputPath = resolve(import.meta.dirname, "local-copy-verification.json");
const excludedNames = new Set([".DS_Store", "miniprogram_npm", "project.private.config.json"]);
const generatedDifferences = new Set(["project.config.json", "utils/config.ts"]);
const generatedExtras = new Set([".talkandtalk-local-build", "README.LOCAL-ONLY.md"]);

async function filesUnder(root, directory = root) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excludedNames.has(entry.name)) continue;
    const absolute = resolve(directory, entry.name);
    const path = relative(root, absolute);
    if (entry.isDirectory()) output.push(...await filesUnder(root, absolute));
    else if (entry.isFile()) output.push(path);
  }
  return output.sort();
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function digest(root, files) {
  const hash = createHash("sha256");
  for (const path of files) hash.update(`${path}\0${await sha256(resolve(root, path))}\n`);
  return hash.digest("hex");
}

const sourceFiles = (await filesUnder(sourceRoot)).filter((path) => !generatedDifferences.has(path));
const localFiles = (await filesUnder(localRoot)).filter(
  (path) => !generatedDifferences.has(path) && !generatedExtras.has(path)
);

if (JSON.stringify(sourceFiles) !== JSON.stringify(localFiles)) {
  const missing = sourceFiles.filter((path) => !localFiles.includes(path));
  const extra = localFiles.filter((path) => !sourceFiles.includes(path));
  throw new Error(`generated local copy file list differs from the frozen source: ${JSON.stringify({ missing, extra })}`);
}

const mismatched = [];
for (const path of sourceFiles) {
  if (await sha256(resolve(sourceRoot, path)) !== await sha256(resolve(localRoot, path))) mismatched.push(path);
}
if (mismatched.length) throw new Error(`generated local copy content mismatch: ${mismatched.join(", ")}`);

const marker = await readFile(resolve(localRoot, ".talkandtalk-local-build"), "utf8");
const localReadme = await readFile(resolve(localRoot, "README.LOCAL-ONLY.md"), "utf8");
const localProject = JSON.parse(await readFile(resolve(localRoot, "project.config.json"), "utf8"));
const localConfig = await readFile(resolve(localRoot, "utils/config.ts"), "utf8");

const assertions = {
  marker: marker === "Talk&Talk generated local Mini Program build. Safe to replace.\n",
  localOnlyProjectName: localProject.projectname === "talk-and-talk-local-do-not-upload",
  noStoredAppId: !("appid" in localProject),
  localDomainCheckDisabled: localProject.setting?.urlCheck === false,
  localReadmeWarning: /do not upload/i.test(localReadme),
  generatedConfigWarning: /GENERATED LOCAL DEVTOOLS BUILD ONLY\. DO NOT UPLOAD OR COMMIT THIS COPY\./.test(localConfig),
  loopbackApiOnly: /http:\/\/127\.0\.0\.1:3000\/api\/v1/.test(localConfig)
};
if (Object.values(assertions).some((value) => value !== true)) {
  throw new Error(`local-only assertions failed: ${JSON.stringify(assertions)}`);
}

const isolatedVerification = !localRoot.startsWith(`${repoRoot}/`);
const result = {
  passed: true,
  verifiedAt: new Date().toISOString(),
  sourceRoot: "frontend/miniprogram",
  localRoot: isolatedVerification ? `system-temp/${basename(localRoot)}` : relative(repoRoot, localRoot),
  isolatedVerification,
  comparedFiles: sourceFiles.length,
  sourceDigest: await digest(sourceRoot, sourceFiles),
  localDigest: await digest(localRoot, localFiles),
  expectedGeneratedDifferences: [...generatedDifferences],
  expectedGeneratedExtras: [...generatedExtras],
  assertions
};
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result)}\n`);
