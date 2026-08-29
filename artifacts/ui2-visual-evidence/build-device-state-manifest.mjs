import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname);
const pngDimensions = (buffer) => ({ width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) });

async function directoryEvidence(directory, expectedCount) {
  const files = (await readdir(resolve(root, directory))).filter((file) => file.endsWith(".png")).sort();
  if (files.length !== expectedCount) throw new Error(`${directory}: expected ${expectedCount} PNG files, found ${files.length}`);
  const dimensions = [];
  for (const file of files) dimensions.push(pngDimensions(await readFile(resolve(root, directory, file))));
  return {
    files,
    dimensions: [...new Set(dimensions.map((item) => `${item.width}x${item.height}`))]
  };
}

async function fileEvidence(path) {
  const buffer = await readFile(resolve(root, path));
  return { path, dimensions: pngDimensions(buffer) };
}

const evidence = {
  generatedAt: new Date().toISOString(),
  simulator: {
    "320x568": {
      model: "iPhone 5",
      theme: "light",
      fontSize: 16,
      evidence: await directoryEvidence("device-320x568", 6)
    },
    "390x844": {
      model: "iPhone 12/13 (Pro)",
      theme: "light+dark",
      fontSize: 16,
      evidence: { mainMatrix: "light/ + dark/", screenshots: 62 }
    },
    "430x932": {
      model: "iPhone 14 Pro Max",
      theme: "light",
      fontSize: 16,
      evidence: await directoryEvidence("device-430x932", 6)
    }
  },
  enlargedFont: {
    logicalDevice: "320x568",
    fontSize: 26,
    evidence: await directoryEvidence("font-26-320x568", 4)
  },
  states: {
    filterSheet: await fileEvidence("states/01-filter-sheet.png"),
    avatarFallback: await fileEvidence("states/03-avatar-fallback.png"),
    empty: await fileEvidence("device-320x568/02-discover.png"),
    disabled: await fileEvidence("light/20-companion-detail.png"),
    localizedError: await fileEvidence("font-26-320x568/04-chat.png"),
    loadingSkeleton: { status: "not_captured", reason: "Developer Tools crashed during the final visible skeleton capture" },
    keyboard: { status: "not_captured", reason: "Developer Tools reported noWindowsAvailable, then crashed before focus evidence" }
  }
};

await writeFile(resolve(root, "device-state-manifest.json"), `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ devices: 3, enlargedFontScreenshots: 4, unresolvedStates: ["loadingSkeleton", "keyboard"] })}\n`);
