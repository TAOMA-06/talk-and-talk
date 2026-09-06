import {
  createHash,
  createHmac,
  pbkdf2Sync,
  randomBytes
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = resolve(repo, "backend/api/.env.cloudbase.staging");
const cli = process.env.CLOUDBASE_CLI
  || "/private/tmp/talktalk-cloudbase-cli/node_modules/.bin/tcb";
const envId = "talk-and-talk-staging-d6d04a14b8";

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return [];
    const separator = line.indexOf("=");
    if (separator <= 0) return [];
    return [[line.slice(0, separator), line.slice(separator + 1)]];
  }));
}

function quoteIdentifier(value) {
  if (!/^[a-z][a-z0-9_]{2,31}$/.test(value)) {
    throw new Error("Database role must be a lowercase PostgreSQL identifier");
  }
  return `"${value}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function scramVerifier(password) {
  const iterations = 4096;
  const salt = randomBytes(16);
  const saltedPassword = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", saltedPassword).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", saltedPassword).update("Server Key").digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}`
    + `$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

function sanitized(output, secrets) {
  let result = String(output || "");
  for (const secret of secrets.sort((left, right) => right.length - left.length)) {
    if (secret.length >= 16) result = result.split(secret).join("[REDACTED]");
  }
  return result;
}

function executeSql(sql, secrets) {
  const result = spawnSync(cli, [
    "api", "tcb", "ExecutePGSql",
    "--api-version", "2018-06-08",
    "--body", JSON.stringify({ EnvId: envId, Sql: sql }),
    "--json"
  ], {
    cwd: repo,
    encoding: "utf8",
    env: process.env
  });
  if (result.status !== 0) {
    process.stderr.write(sanitized(result.stderr || result.stdout, secrets));
    process.exit(result.status ?? 1);
  }
  const output = String(result.stdout || "").replace(/\u001b\[[0-9;]*m/g, "");
  const start = output.indexOf("{");
  if (start < 0) throw new Error("CloudBase CLI did not return JSON");
  return JSON.parse(output.slice(start));
}

const values = parseEnv(await readFile(envFile, "utf8"));
for (const key of ["CLOUDBASE_ENV_ID", "PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD"]) {
  if (!values[key]) throw new Error(`${key} is required in the CloudBase environment file`);
}
if (values.CLOUDBASE_ENV_ID !== envId) {
  throw new Error("CloudBase database role target does not match the expected environment");
}
const role = quoteIdentifier(values.PGUSER);
const database = quoteIdentifier(values.PGDATABASE);
const verifier = scramVerifier(values.PGPASSWORD);
const secrets = [values.PGPASSWORD, verifier];
const exists = executeSql(
  `SELECT 1 FROM pg_roles WHERE rolname = ${quoteLiteral(values.PGUSER)}`,
  secrets
);
const existsRows = exists.data?.Rows || exists.Rows || [];

if (existsRows.length === 0) {
  executeSql(
    `CREATE ROLE ${role} LOGIN PASSWORD ${quoteLiteral(verifier)}`,
    secrets
  );
} else {
  executeSql(
    `ALTER ROLE ${role} LOGIN PASSWORD ${quoteLiteral(verifier)}`,
    secrets
  );
}

executeSql([
  `ALTER ROLE ${role} NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20`,
  `GRANT CONNECT ON DATABASE ${database} TO ${role}`,
  `GRANT USAGE ON SCHEMA public TO ${role}`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
  `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
  `ALTER DEFAULT PRIVILEGES FOR ROLE cloudbase_postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
  `ALTER DEFAULT PRIVILEGES FOR ROLE cloudbase_postgres IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${role}`,
  `ALTER ROLE ${role} IN DATABASE ${database} SET search_path = public`,
  `ALTER ROLE ${role} IN DATABASE ${database} SET TimeZone = 'UTC'`
].join(";\n"), secrets);

process.stdout.write(`${JSON.stringify({
  envId,
  database: values.PGDATABASE,
  role: values.PGUSER,
  hostConfigured: true,
  passwordRotated: true,
  privilegeScope: "public schema application objects"
})}\n`);
