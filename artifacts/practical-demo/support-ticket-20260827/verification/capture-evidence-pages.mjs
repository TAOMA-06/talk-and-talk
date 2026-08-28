import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(`${process.env.PLAYWRIGHT_NODE_MODULES}/playwright`);
const artifactRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const screenshotRoot = resolve(artifactRoot, "screenshots");
const origin = process.env.DEMO_ADMIN_ORIGIN || "http://127.0.0.1:3100";
const executablePath = process.env.CHROME_EXECUTABLE;
if (!executablePath) throw new Error("CHROME_EXECUTABLE is required");

await mkdir(screenshotRoot, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-first-run", "--no-default-browser-check"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});

const pages = [
  { id: "run-summary", url: "/evidence/01-run-summary.html", screenshot: "08-evidence-run-summary.png" },
  { id: "audit-notification", url: "/evidence/02-audit-notification.html", screenshot: "09-evidence-audit-notification.png" }
];
const results = [];
try {
  for (const item of pages) {
    await page.goto(`${origin}${item.url}`, { waitUntil: "networkidle" });
    await page.locator('[data-evidence-card="true"]').waitFor({ state: "visible" });
    const dimensions = await page.evaluate(() => ({
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight
    }));
    await page.screenshot({ path: resolve(screenshotRoot, item.screenshot) });
    results.push({
      ...item,
      dimensions,
      horizontalOverflow: dimensions.scrollWidth > dimensions.viewportWidth,
      sourceKind: "evidence-card",
      provenance: "self-contained HTML derived from media-api assertion JSON; not application UI"
    });
  }
} finally {
  await context.close();
  await browser.close();
}

const evidence = {
  generatedAt: new Date().toISOString(),
  driver: "Playwright with installed Google Chrome",
  viewport: { width: 1440, height: 810 },
  results,
  consoleErrors,
  overall: results.length === pages.length && results.every((item) => !item.horizontalOverflow) && consoleErrors.length === 0 ? "pass" : "fail"
};
await writeFile(resolve(artifactRoot, "verification/evidence-card-capture.json"), `${JSON.stringify(evidence, null, 2)}\n`);
if (evidence.overall !== "pass") throw new Error("Evidence card capture validation failed");
process.stdout.write(JSON.stringify({ overall: evidence.overall, screenshots: results.map((item) => item.screenshot) }) + "\n");
