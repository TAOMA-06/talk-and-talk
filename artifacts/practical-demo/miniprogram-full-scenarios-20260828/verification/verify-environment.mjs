import { createRequire } from "node:module";
import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const artifactRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(artifactRoot, "../../..");
const { Client } = require(`${repoRoot}/backend/api/node_modules/pg`);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function api(path, token) {
  const response = await fetch(`${required("DEMO_API_BASE")}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return payload.data ?? payload;
}

function assertion(id, pass, evidence, details) {
  return { id, outcome: pass ? "pass" : "fail", evidence, ...(details ? { details } : {}) };
}

const runtimeDir = required("DEMO_RUNTIME_DIR");
const localProject = required("DEMO_LOCAL_PROJECT");
const session = JSON.parse(await readFile(`${runtimeDir}/customer-session.json`, "utf8"));
const storagePayload = JSON.parse(await readFile(`${runtimeDir}/devtools-storage-payload.json`, "utf8"));
const health = await api("/health");
const me = await api("/me", session.accessToken);
const companions = await api("/companions?page=1&pageSize=50");
const support = await api("/support/tickets/me?page=1&pageSize=20", session.accessToken);
const configSource = await readFile(`${localProject}/utils/config.ts`, "utf8");
const projectConfig = JSON.parse(await readFile(`${localProject}/project.config.json`, "utf8"));
const sessionMode = (await stat(`${runtimeDir}/customer-session.json`)).mode & 0o777;
const payloadMode = (await stat(`${runtimeDir}/devtools-storage-payload.json`)).mode & 0o777;

const client = new Client({ connectionString: required("DATABASE_URL") });
await client.connect();
let database;
try {
  const result = await client.query(`
    SELECT
      current_database() AS database,
      (SELECT COUNT(*)::integer FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migrations,
      (SELECT COUNT(*)::integer FROM "CompanionProfile") AS companions,
      (SELECT COUNT(*)::integer FROM "CompanionProfile" WHERE "isPublished" = TRUE) AS published_companions,
      (SELECT COUNT(*)::integer FROM "LegalConsentReceipt" WHERE "userId" = $1 AND "withdrawnAt" IS NULL) AS active_consents
  `, [session.user.id]);
  database = result.rows[0];
} finally {
  await client.end();
}

const expectedStorageKeys = [
  "talkandtalk.accessToken",
  "talkandtalk.refreshToken",
  "talkandtalk.user",
  "talkandtalk.legalConsent"
];
const assertions = [
  assertion("api-health", health.status === "ok", "isolated API reports ok"),
  assertion("session-user", me.id === session.user.id && me.role === "user", "authenticated /me matches the fresh customer"),
  assertion("seeded-companions", database.companions === 5 && database.published_companions === 4, "current seed created five companions and four published profiles", database),
  assertion("public-companions", companions.items?.length === 4 && ["c1", "c2", "c3", "c4"].every((id) => companions.items.some((item) => item.id === id)), "public API exposes the four verified seed companions"),
  assertion("migrations-current", database.migrations === 117, "all 117 committed migrations are applied"),
  assertion("current-consent", database.active_consents === 1, "fresh customer has one active consent receipt"),
  assertion("customer-support-empty", support.items?.length === 0, "fresh customer starts without support tickets"),
  assertion("local-copy-api", configSource.includes("http://127.0.0.1:32028/api/v1"), "generated Mini Program copy targets the isolated API"),
  assertion("local-copy-no-appid", !("appid" in projectConfig) && projectConfig.projectname === "talk-and-talk-local-do-not-upload", "generated project is explicitly local-only and contains no AppID"),
  assertion("storage-payload-exact", JSON.stringify(Object.keys(storagePayload.storage).sort()) === JSON.stringify(expectedStorageKeys.sort()), "temporary DevTools payload contains exactly the four supported storage keys"),
  assertion("runtime-files-private", sessionMode === 0o600 && payloadMode === 0o600, "session and storage payload files are mode 0600")
];
const evidence = {
  generatedAt: new Date().toISOString(),
  database,
  customer: { id: session.user.id, role: session.user.role },
  publicCompanions: companions.items.map((item) => ({ id: item.id, name: item.name })),
  localProject: { path: localProject, projectname: projectConfig.projectname, appidPresent: "appid" in projectConfig },
  storageKeys: Object.keys(storagePayload.storage),
  secretsIncluded: false,
  assertions,
  overall: assertions.every((item) => item.outcome === "pass") ? "pass" : "fail"
};
await writeFile(resolve(artifactRoot, "verification/runtime-verification.json"), `${JSON.stringify(evidence, null, 2)}\n`);
if (evidence.overall !== "pass") throw new Error("Runtime verification failed");
process.stdout.write(JSON.stringify({ overall: evidence.overall, assertions: assertions.length, database: database.database }) + "\n");
