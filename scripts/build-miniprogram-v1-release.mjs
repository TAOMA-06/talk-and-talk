import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(repo, "frontend/miniprogram");
const deliveryDir = resolve(repo, "artifacts/delivery");
const archive = resolve(deliveryDir, "TalkAndTalk-v1.0-Miniprogram.zip");
const appId = String(process.env.TALKTALK_MINIPROGRAM_APP_ID || "").trim();

if (!/^wx[a-zA-Z0-9]{16}$/.test(appId)) {
  throw new Error("TALKTALK_MINIPROGRAM_APP_ID must be a valid wx AppID");
}

const gitStatus = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], {
  cwd: repo,
  encoding: "utf8"
});
if (gitStatus.status !== 0) throw new Error("Unable to read Git status for the release bundle");
if (gitStatus.stdout.trim() && process.env.ALLOW_DIRTY_RELEASE_BUILD !== "1") {
  throw new Error("Release bundle requires a clean tracked worktree");
}
const sourceCommit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim();
const sourceTree = spawnSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: repo, encoding: "utf8" }).stdout.trim();
if (!/^[0-9a-f]{40}$/.test(sourceCommit) || !/^[0-9a-f]{40}$/.test(sourceTree)) {
  throw new Error("Release bundle requires a committed Git source identity");
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "talktalk-v1-release-"));
const releaseRoot = resolve(temporaryRoot, "TalkAndTalk-v1.0-Miniprogram");

async function filesUnder(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const output = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) output.push(...await filesUnder(path));
    else if (entry.isFile()) output.push(path);
  }
  return output;
}

try {
  await cp(source, releaseRoot, {
    recursive: true,
    filter(path) {
      const name = basename(path);
      return name !== "node_modules"
        && name !== ".DS_Store"
        && name !== "project.private.config.json";
    }
  });

  const projectConfigPath = resolve(releaseRoot, "project.config.json");
  const projectConfig = JSON.parse(await readFile(projectConfigPath, "utf8"));
  projectConfig.appid = appId;
  projectConfig.projectname = "talk-and-talk-v1.0";
  projectConfig.setting = {
    ...projectConfig.setting,
    urlCheck: true,
    minified: true
  };
  // The handoff must run on a clean DevTools install without depending on the
  // editor's optional TypeScript compiler plugin. Ship JavaScript beside the
  // source and let the runtime resolve the standard .js entrypoints directly.
  projectConfig.setting.useCompilerPlugins = [];
  await writeFile(projectConfigPath, `${JSON.stringify(projectConfig, null, 2)}\n`);

  const compiledRoot = resolve(temporaryRoot, "compiled-js");
  const typescript = resolve(repo, "backend/api/node_modules/.bin/tsc");
  const compile = spawnSync(typescript, [
    "-p", resolve(releaseRoot, "tsconfig.json"),
    "--rootDir", releaseRoot,
    "--outDir", compiledRoot,
    "--declaration", "false",
    "--sourceMap", "false",
    "--noEmit", "false"
  ], { cwd: repo, encoding: "utf8" });
  if (compile.status !== 0) {
    throw new Error(compile.stderr || compile.stdout || "failed to compile Mini Program JavaScript");
  }
  await cp(compiledRoot, releaseRoot, { recursive: true, force: true });

  const app = JSON.parse(await readFile(resolve(releaseRoot, "app.json"), "utf8"));
  const requiredJavaScript = ["app.js", ...(app.pages || []).map((page) => `${page}.js`)];
  for (const path of requiredJavaScript) {
    try {
      await stat(resolve(releaseRoot, path));
    } catch {
      throw new Error(`Compiled Mini Program entrypoint is missing: ${path}`);
    }
  }

  await writeFile(resolve(releaseRoot, "RELEASE_INFO.md"), [
    "# Talk&Talk v1.0 微信小程序正式工程",
    "",
    "这是可用于微信开发者工具 Preview / Upload 的业务工程，不是截图演示。",
    "",
    "- 版本：1.0.0",
    `- AppID：${appId}`,
    `- Git commit：${sourceCommit}`,
    `- Git tree：${sourceTree}`,
    "- API 通道：微信 CloudBase callContainer",
    "- CloudBase 环境：talk-and-talk-staging-d6d04a14b8",
    "- 云托管服务：talk-and-talk-api",
    "- 协议页面：https://talk-and-talk-staging-d6d04a14b8-1428040864.tcloudbaseapp.com/legal/",
    "- 运行代码：已预编译 JavaScript，不依赖开发者工具 TypeScript 插件。",
    "- 打开方式：解压后在微信开发者工具选择“导入项目”，目录选择本文件所在目录。",
    "- 上传前保持“校验合法域名”开启。",
    ""
  ].join("\n"));

  const manifestFiles = [];
  for (const path of await filesUnder(releaseRoot)) {
    if (basename(path) === ".release-manifest.json") continue;
    const buffer = await readFile(path);
    manifestFiles.push({
      path: relative(releaseRoot, path),
      bytes: (await stat(path)).size,
      sha256: createHash("sha256").update(buffer).digest("hex")
    });
  }
  await writeFile(resolve(releaseRoot, ".release-manifest.json"), `${JSON.stringify({
    product: "Talk&Talk",
    version: "1.0.0",
    appId,
    source: "frontend/miniprogram",
    sourceCommit,
    sourceTree,
    generatedAt: new Date().toISOString(),
    files: manifestFiles
  }, null, 2)}\n`);

  await rm(archive, { force: true });
  const result = spawnSync("zip", ["-X", "-q", "-r", archive, basename(releaseRoot)], {
    cwd: temporaryRoot,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "failed to create release archive");
  }
  const bytes = (await stat(archive)).size;
  const sha256 = createHash("sha256").update(await readFile(archive)).digest("hex");
  process.stdout.write(`${JSON.stringify({ archive, bytes, sha256, files: manifestFiles.length })}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
