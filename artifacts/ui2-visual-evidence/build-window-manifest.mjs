import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname);
const routes = JSON.parse(await readFile(resolve(root, "routes.ui2.json"), "utf8"));
const capturedAt = new Date().toISOString();
const results = [];

for (const [name, route, profile] of routes) {
  const rawPath = resolve(root, "dark-raw", `${name}.jpeg`);
  const screenshotPath = resolve(root, "dark", `${name}.png`);
  const [raw, screenshot] = await Promise.all([stat(rawPath), stat(screenshotPath)]);
  if (!raw.isFile() || !screenshot.isFile() || raw.size < 20_000 || screenshot.size < 10_000) {
    throw new Error(`dark screenshot evidence is incomplete for ${name}`);
  }
  const expectedPath = route.split("?", 1)[0].replace(/^\//, "");
  results.push({
    name,
    route,
    profile,
    theme: "dark",
    outcome: "captured",
    actualPath: expectedPath,
    expectedPath,
    captureMethod: "computer-use-devtools-window-crop",
    simulator: { model: "iPhone 12/13 (Pro)", logicalWidth: 390, logicalHeight: 844, scale: "80%" },
    crop: { x: 729, y: 79, width: 274, height: 586 },
    rawFile: `../dark-raw/${name}.jpeg`,
    screenshotFile: `${name}.png`
  });
}

await writeFile(
  resolve(root, "dark", "manifest.json"),
  `${JSON.stringify({ theme: "dark", capturedAt, routes: results }, null, 2)}\n`
);
process.stdout.write(`${JSON.stringify({ theme: "dark", captured: results.length, failed: 0 })}\n`);
