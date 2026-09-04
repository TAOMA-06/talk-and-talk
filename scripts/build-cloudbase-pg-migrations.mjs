import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(repo, "backend/api/prisma/migrations");
const outputFlag = process.argv.indexOf("--output");
const outputRoot = outputFlag >= 0 ? resolve(process.argv[outputFlag + 1] || "") : "";
if (!outputRoot || outputRoot === repo || outputRoot.startsWith(`${repo}/`)) {
  throw new Error("--output must be an explicit directory outside the repository");
}

const cloudbaseRoot = resolve(outputRoot, "cloudbase");
const migrationsRoot = resolve(cloudbaseRoot, "migrations");
await rm(cloudbaseRoot, { recursive: true, force: true });
await mkdir(migrationsRoot, { recursive: true });

const directories = (await readdir(sourceRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && /^\d{14}_[a-z0-9_]+$/.test(entry.name))
  .map((entry) => entry.name)
  .sort();

let assignedVersion = 0;
const mappedMigrations = [];
const digitWords = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
for (const directory of directories) {
  const sourceVersion = Number(directory.slice(0, 14));
  assignedVersion = Math.max(sourceVersion, assignedVersion + 1);
  const safeName = directory.slice(15)
    .replace(/[0-9]/g, (digit) => digitWords[Number(digit)])
    .replace(/[^a-z_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  const outputName = `${String(assignedVersion).padStart(14, "0")}_${safeName}.sql`;
  await cp(
    resolve(sourceRoot, directory, "migration.sql"),
    resolve(migrationsRoot, outputName)
  );
  mappedMigrations.push({ source: directory, output: outputName });
}

if (!Number.isSafeInteger(assignedVersion) || assignedVersion === 0) throw new Error("No Prisma migrations found");
const grantVersion = String(assignedVersion + 1).padStart(14, "0");
const grantFile = `${grantVersion}_cloudbase_runtime_grants.sql`;
await writeFile(resolve(migrationsRoot, grantFile), [
  "GRANT USAGE ON SCHEMA public TO cloudbase_postgres;",
  "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cloudbase_postgres;",
  "GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO cloudbase_postgres;",
  ""
].join("\n"));

await writeFile(resolve(cloudbaseRoot, "migration-manifest.json"), `${JSON.stringify({
  source: "backend/api/prisma/migrations",
  prismaMigrationCount: directories.length,
  mappedMigrations,
  cloudBaseGrantMigration: grantFile,
  total: directories.length + 1,
  generatedAt: new Date().toISOString()
}, null, 2)}\n`);

process.stdout.write(`${JSON.stringify({ outputRoot, migrationsRoot, count: directories.length + 1 })}\n`);
