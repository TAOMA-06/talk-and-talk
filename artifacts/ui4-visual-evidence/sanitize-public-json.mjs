import { readdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const evidenceRoot = resolve(import.meta.dirname);
const repositoryRoot = resolve(evidenceRoot, "../..");

async function jsonFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await jsonFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(path);
  }
  return files.sort();
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item)]));
  }
  if (typeof value === "string" && value.startsWith(`${repositoryRoot}/`)) {
    return relative(repositoryRoot, value).split("\\").join("/");
  }
  return value;
}

const changed = [];
for (const path of await jsonFiles(evidenceRoot)) {
  const source = await readFile(path, "utf8");
  if (!source.includes(`${repositoryRoot}/`)) continue;
  const parsed = JSON.parse(source);
  const next = `${JSON.stringify(sanitize(parsed), null, 2)}\n`;
  if (next !== source) {
    await writeFile(path, next);
    changed.push(relative(repositoryRoot, path).split("\\").join("/"));
  }
}

function hasPersonalAbsolutePath(value) {
  if (Array.isArray(value)) return value.some(hasPersonalAbsolutePath);
  if (value && typeof value === "object") return Object.values(value).some(hasPersonalAbsolutePath);
  return typeof value === "string"
    && (/^\/(?:Users|home)\//.test(value) || /^[A-Za-z]:\\Users\\/.test(value));
}

const remaining = [];
for (const path of await jsonFiles(evidenceRoot)) {
  const source = await readFile(path, "utf8");
  if (hasPersonalAbsolutePath(JSON.parse(source))) {
    remaining.push(relative(repositoryRoot, path).split("\\").join("/"));
  }
}
if (remaining.length) throw new Error(`personal absolute paths remain: ${remaining.join(", ")}`);
process.stdout.write(`${JSON.stringify({ passed: true, changed, remainingPersonalAbsolutePaths: 0 })}\n`);
