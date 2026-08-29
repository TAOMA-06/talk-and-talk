import { createRequire } from "node:module";
import { chmod, readFile, writeFile } from "node:fs/promises";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const apiBase = new URL(required("DEMO_API_BASE"));
const databaseUrl = required("DATABASE_URL");
const runtimeRoot = required("DEMO_RUNTIME_ROOT");
if (apiBase.hostname !== "127.0.0.1" || apiBase.protocol !== "http:") {
  throw new Error("DEMO_API_BASE must be an HTTP 127.0.0.1 endpoint");
}
if (!new URL(databaseUrl).pathname.includes("talk_and_talk_miniprogram_full_20260828_")) {
  throw new Error("DATABASE_URL must target the disposable Mini Program demo database");
}

const backendRequire = createRequire(new URL("../../backend/api/package.json", import.meta.url));
const { Client } = backendRequire("pg");
const profiles = [
  { key: "U0", dir: runtimeRoot },
  { key: "U1", dir: `${runtimeRoot}/u1` },
  { key: "P1", dir: `${runtimeRoot}/p1` },
  { key: "R1", dir: `${runtimeRoot}/r1` }
];

async function api(path, options = {}) {
  const response = await fetch(new URL(path.replace(/^\//, ""), `${apiBase.toString().replace(/\/$/, "")}/`), {
    method: options.method || "GET",
    headers: { "content-type": "application/json" },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} failed: ${payload?.error?.code || response.status}`);
  return payload.data ?? payload;
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  for (const profile of profiles) {
    const sessionPath = `${profile.dir}/customer-session.json`;
    const payloadPath = `${profile.dir}/devtools-storage-payload.json`;
    const previousSession = JSON.parse(await readFile(sessionPath, "utf8"));
    const payload = JSON.parse(await readFile(payloadPath, "utf8"));
    const userId = previousSession.user?.id || payload.storage?.["talkandtalk.user"]?.id;
    if (!userId) throw new Error(`${profile.key} is missing its fixture user id`);
    const identity = await client.query(
      `SELECT "providerId" FROM "AuthIdentity" WHERE "userId" = $1 AND "provider"::TEXT = 'phone' LIMIT 1`,
      [userId]
    );
    const phone = identity.rows[0]?.providerId;
    if (!phone) throw new Error(`${profile.key} has no fixture phone identity`);
    const sent = await api("auth/sms/send-code", { method: "POST", body: { phone } });
    if (!/^\d{6}$/.test(sent.devCode || "")) throw new Error(`${profile.key} did not receive a local dev code`);
    const session = await api("auth/phone/login", {
      method: "POST",
      body: { phone, code: sent.devCode }
    });
    payload.storage["talkandtalk.accessToken"] = session.accessToken;
    payload.storage["talkandtalk.refreshToken"] = session.refreshToken;
    payload.storage["talkandtalk.user"] = session.user;
    await writeFile(sessionPath, `${JSON.stringify(session)}\n`, { mode: 0o600 });
    await writeFile(payloadPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    await chmod(sessionPath, 0o600);
    await chmod(payloadPath, 0o600);
  }
} finally {
  await client.end();
}

process.stdout.write(`${JSON.stringify({ recreated: profiles.map((profile) => profile.key), secretsPrinted: false })}\n`);
