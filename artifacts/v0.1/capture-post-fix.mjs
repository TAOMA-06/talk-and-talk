import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const automatorBase = process.env.MINIPROGRAM_AUTOMATOR_ROOT?.trim();
const port = Number(process.env.MINIPROGRAM_AUTOMATION_PORT || 9435);
if (!automatorBase) throw new Error("MINIPROGRAM_AUTOMATOR_ROOT is required");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid automation port");

const here = resolve(import.meta.dirname);
const repositoryRoot = resolve(here, "../..");
const outputPath = resolve(here, "devtools-post-fix-consent.png");
const resultPath = resolve(here, "post-fix-devtools.json");
const localCopy = JSON.parse(await readFile(
  resolve(repositoryRoot, "artifacts/ui4-visual-evidence/local-copy-verification.json"),
  "utf8"
));
const actionBarStyles = await readFile(
  resolve(repositoryRoot, "frontend/miniprogram/components/tt-action-bar/index.wxss"),
  "utf8"
);

const automatorRoot = `${automatorBase}/node_modules/miniprogram-automator`;
const MiniProgram = require(`${automatorRoot}/out/MiniProgram.js`).default;
MiniProgram.prototype.checkVersion = async function checkVersionCompatibilityBridge() {};
const automator = require(automatorRoot);
const miniProgram = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${port}` });
const consoleEvents = [];
miniProgram.on("console", (entry) => consoleEvents.push(entry));

try {
  await miniProgram.callWxMethod("clearStorage", {});
  const page = await miniProgram.reLaunch("/pages/consent/index");
  await new Promise((resolveWait) => setTimeout(resolveWait, 2200));
  const current = await miniProgram.currentPage();
  await miniProgram.pageScrollTo(0);
  await miniProgram.screenshot({ path: outputPath });
  await new Promise((resolveWait) => setTimeout(resolveWait, 500));

  const screenshot = await readFile(outputPath);
  const sourceSelectorWarnings = consoleEvents.filter((entry) => {
    const text = JSON.stringify(entry);
    return /Some selectors are not allowed in component wxss|tt-action-bar\/index\.wxss|forbidden component WXSS/i.test(text);
  });
  const result = {
    passed: (page?.path || current?.path) === "pages/consent/index"
      && sourceSelectorWarnings.length === 0
      && !/\.motion-off\s+button\b/.test(actionBarStyles),
    capturedAt: new Date().toISOString(),
    route: "pages/consent/index",
    actualPath: page?.path || current?.path || "",
    screenshot: "artifacts/v0.1/devtools-post-fix-consent.png",
    screenshotSha256: createHash("sha256").update(screenshot).digest("hex"),
    screenshotDimensions: {
      width: screenshot.readUInt32BE(16),
      height: screenshot.readUInt32BE(20)
    },
    sourceDigest: localCopy.sourceDigest,
    localCopyDigest: localCopy.localDigest,
    comparedFiles: localCopy.comparedFiles,
    consoleEventCount: consoleEvents.length,
    sourceSelectorWarningCount: sourceSelectorWarnings.length,
    sourceSelectorWarnings,
    selectorContract: ".motion-off targets .action-secondary and .action-primary classes; component tag, ID and attribute selectors are rejected by ui2-audit.mjs",
    boundary: "Official WeChat DevTools simulator and source-warning check; not Preview, Upload, real-device, FPS, API, identity, order or payment evidence."
  };
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.passed) process.exitCode = 1;
} finally {
  miniProgram.disconnect();
}
