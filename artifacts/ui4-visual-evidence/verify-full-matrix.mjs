import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname);
const routes = JSON.parse(
  await readFile(resolve(root, "../ui2-visual-evidence/routes.ui2.json"), "utf8")
);
const expectedNames = routes.map(([name]) => name).sort();
const expectedPaths = new Map(
  routes.map(([name, route]) => [name, route.split("?", 1)[0].replace(/^\//, "")])
);
const devices = {
  320: new Set(["640x912", "640x1008"]),
  390: new Set(["780x1342", "780x1506"]),
  430: new Set(["860x1504", "860x1668"])
};

function dimensions(buffer) {
  if (buffer.length < 24 || buffer.subarray(1, 4).toString("ascii") !== "PNG") {
    throw new Error("invalid PNG signature");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const summary = {};
const hashesByCombination = new Map();

for (const [width, allowedDimensions] of Object.entries(devices)) {
  for (const theme of ["light", "dark"]) {
    const key = `${width}/${theme}`;
    const directory = resolve(root, "matrix", width, theme);
    const files = (await readdir(directory))
      .filter((file) => /^\d{2}-.+\.png$/.test(file))
      .sort();
    const names = files.map((file) => file.replace(/\.png$/, ""));
    if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
      throw new Error(`${key}: screenshot names do not match all 31 registered routes`);
    }

    const manifest = JSON.parse(await readFile(resolve(directory, "manifest.json"), "utf8"));
    if (
      Number(manifest.simulator?.windowWidth) !== Number(width)
      || manifest.simulator?.theme !== theme
      || manifest.routes?.length !== 31
    ) throw new Error(`${key}: simulator or manifest metadata mismatch`);

    const manifestByName = new Map(manifest.routes.map((route) => [route.name, route]));
    const hashes = new Map();
    const seenDimensions = new Set();
    for (const file of files) {
      const name = file.replace(/\.png$/, "");
      const item = manifestByName.get(name);
      if (
        !item
        || item.outcome !== "captured"
        || item.actualPath !== expectedPaths.get(name)
        || item.expectedPath !== expectedPaths.get(name)
      ) throw new Error(`${key}/${name}: route was not captured at its expected path`);

      const buffer = await readFile(resolve(directory, file));
      const hash = createHash("sha256").update(buffer).digest("hex");
      const size = dimensions(buffer);
      const sizeKey = `${size.width}x${size.height}`;
      if (item.sha256 !== hash) throw new Error(`${key}/${file}: manifest hash mismatch`);
      if (!allowedDimensions.has(sizeKey)) {
        throw new Error(`${key}/${file}: unexpected dimensions ${sizeKey}`);
      }
      if (item.dimensions?.width !== size.width || item.dimensions?.height !== size.height) {
        throw new Error(`${key}/${file}: manifest dimensions mismatch`);
      }
      hashes.set(name, hash);
      seenDimensions.add(sizeKey);
    }
    if (new Set(hashes.values()).size < 30) {
      throw new Error(`${key}: repeated-page capture suspected`);
    }
    if (seenDimensions.size !== allowedDimensions.size) {
      throw new Error(`${key}: expected both tab and non-tab screenshot heights`);
    }
    hashesByCombination.set(key, hashes);
    summary[key] = {
      files: files.length,
      routeMatches: 31,
      uniqueImages: new Set(hashes.values()).size,
      dimensions: [...seenDimensions].sort()
    };
  }
}

const themeDifferences = {};
for (const width of Object.keys(devices)) {
  const light = hashesByCombination.get(`${width}/light`);
  const dark = hashesByCombination.get(`${width}/dark`);
  const different = expectedNames.filter((name) => light.get(name) !== dark.get(name)).length;
  if (different < 25) throw new Error(`${width}: light/dark captures are insufficiently distinct`);
  themeDifferences[width] = different;
}

process.stdout.write(`${JSON.stringify({
  passed: true,
  total: Object.values(summary).reduce((total, item) => total + item.files, 0),
  combinations: summary,
  lightDarkDifferentRoutes: themeDifferences
})}\n`);
