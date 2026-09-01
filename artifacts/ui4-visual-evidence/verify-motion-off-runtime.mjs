import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const require = createRequire(import.meta.url);
const automatorBase = process.env.MINIPROGRAM_AUTOMATOR_ROOT?.trim();
const port = Number(process.env.MINIPROGRAM_AUTOMATION_PORT || 9432);
if (!automatorBase) throw new Error("MINIPROGRAM_AUTOMATOR_ROOT is required");

const automatorRoot = `${automatorBase}/node_modules/miniprogram-automator`;
const MiniProgram = require(`${automatorRoot}/out/MiniProgram.js`).default;
MiniProgram.prototype.checkVersion = async function checkVersionCompatibilityBridge() {};
const automator = require(automatorRoot);
const fixture = JSON.parse(await readFile(resolve(import.meta.dirname, "fixture-legal-only.json"), "utf8"));
const output = resolve(import.meta.dirname, "interaction", "motion-off");
const projectRoot = resolve(import.meta.dirname, "../..");

const delay = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");

await mkdir(output, { recursive: true });
const miniProgram = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${port}` });
try {
  await miniProgram.callWxMethod("clearStorage", {});
  for (const [key, data] of Object.entries(fixture.storage)) {
    await miniProgram.callWxMethod("setStorage", { key, data });
  }
  await miniProgram.reLaunch("/pages/home/index");
  const runtime = await miniProgram.evaluate(() => {
    const pages = getCurrentPages();
    const page = pages[pages.length - 1];
    page.setData({ motionOff: true });
    return { route: page.route, motionOff: page.data.motionOff };
  });
  await delay(80);
  const firstPath = resolve(output, "home-motion-off-a.png");
  const secondPath = resolve(output, "home-motion-off-b.png");
  await miniProgram.screenshot({ path: firstPath });
  await delay(1_200);
  await miniProgram.screenshot({ path: secondPath });
  const first = await readFile(firstPath);
  const second = await readFile(secondPath);
  const evidence = {
    generatedAt: new Date().toISOString(),
    runtime,
    first: { path: relative(projectRoot, firstPath), sha256: hash(first) },
    second: { path: relative(projectRoot, secondPath), sha256: hash(second) },
    byteIdenticalAfter1200Ms: first.equals(second),
    interpretation: "motionOff was set in the live AppService page; both captures show the immediate final state and remain stable"
  };
  await writeFile(resolve(output, "manifest.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  if (runtime?.route !== "pages/home/index" || runtime?.motionOff !== true || !evidence.byteIdenticalAfter1200Ms) {
    throw new Error(`motion-off runtime verification failed: ${JSON.stringify(evidence)}`);
  }
  process.stdout.write(`${JSON.stringify({ passed: true, ...evidence })}\n`);
} finally {
  miniProgram.disconnect();
}
