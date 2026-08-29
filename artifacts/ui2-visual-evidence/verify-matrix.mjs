import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname);
const expected = JSON.parse(await readFile(resolve(root, "routes.ui2.json"), "utf8"))
  .map(([name]) => name)
  .sort();

function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.subarray(1, 4).toString("ascii") !== "PNG") {
    throw new Error("invalid PNG signature");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const summary = {};
for (const theme of ["light", "dark"]) {
  const directory = resolve(root, theme);
  const files = (await readdir(directory)).filter((file) => /^\d{2}-.+\.png$/.test(file)).sort();
  const names = files.map((file) => file.replace(/\.png$/, ""));
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`${theme} screenshot names do not match the 31-route matrix`);
  }
  const manifest = JSON.parse(await readFile(resolve(directory, "manifest.json"), "utf8"));
  if (manifest.routes.length !== 31 || manifest.routes.some((item) => item.outcome !== "captured")) {
    throw new Error(`${theme} manifest is not 31/31 captured`);
  }
  const dimensions = [];
  for (const file of files) {
    dimensions.push(pngDimensions(await readFile(resolve(directory, file))));
  }
  summary[theme] = {
    files: files.length,
    dimensions: [...new Set(dimensions.map((item) => `${item.width}x${item.height}`))]
  };
}

process.stdout.write(`${JSON.stringify({ passed: true, total: 62, themes: summary })}\n`);
