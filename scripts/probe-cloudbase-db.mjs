import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { Client } = require(resolve(repo, "backend/api/node_modules/pg"));

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return [];
    const separator = line.indexOf("=");
    if (separator <= 0) return [];
    return [[line.slice(0, separator), line.slice(separator + 1)]];
  }));
}

const values = parseEnv(await readFile(resolve(repo, "backend/api/.env.cloudbase.staging"), "utf8"));
for (const key of ["PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD"]) {
  if (!values[key]) throw new Error(`${key} is required`);
}

const client = new Client({
  host: values.PGHOST,
  port: Number(values.PGPORT),
  database: values.PGDATABASE,
  user: values.PGUSER,
  password: values.PGPASSWORD,
  connectionTimeoutMillis: 5000,
  query_timeout: 5000
});

try {
  await client.connect();
  const result = await client.query(`
    SELECT
      current_user AS role,
      current_database() AS database,
      to_regclass('public."User"') IS NOT NULL AS schema_ready
  `);
  process.stdout.write(`${JSON.stringify({ connected: true, ...result.rows[0] })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    connected: false,
    code: typeof error?.code === "string" ? error.code : null,
    reason: error instanceof Error
      ? error.message.replaceAll(values.PGHOST, "[DATABASE_HOST]")
      : "Database probe failed"
  })}\n`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
