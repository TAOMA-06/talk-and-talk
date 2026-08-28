import { chmod, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const artifactRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiBase = process.env.DEMO_API_BASE?.trim();
const runtimeRoot = process.env.DEMO_RUNTIME_ROOT?.trim();
if (!apiBase || !runtimeRoot) throw new Error("DEMO_API_BASE and DEMO_RUNTIME_ROOT are required");

const profiles = [
  { key: "U0", dir: runtimeRoot },
  { key: "U1", dir: `${runtimeRoot}/u1` },
  { key: "P1", dir: `${runtimeRoot}/p1` },
  { key: "R1", dir: `${runtimeRoot}/r1` }
];
const results = [];
for (const profile of profiles) {
  const sessionPath = `${profile.dir}/customer-session.json`;
  const payloadPath = `${profile.dir}/devtools-storage-payload.json`;
  const session = JSON.parse(await readFile(sessionPath, "utf8"));
  const payload = JSON.parse(await readFile(payloadPath, "utf8"));
  const response = await fetch(`${apiBase}/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: session.refreshToken })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${profile.key} refresh failed: ${body?.error?.code || response.status}`);
  const next = body.data ?? body;
  const updated = { ...session, ...next, user: next.user || session.user };
  payload.storage["talkandtalk.accessToken"] = updated.accessToken;
  payload.storage["talkandtalk.refreshToken"] = updated.refreshToken;
  payload.storage["talkandtalk.user"] = updated.user;
  await writeFile(sessionPath, `${JSON.stringify(updated)}\n`, { mode: 0o600 });
  await writeFile(payloadPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await chmod(sessionPath, 0o600);
  await chmod(payloadPath, 0o600);
  results.push({ profile: profile.key, userId: updated.user.id, refreshed: true });
}
await writeFile(resolve(artifactRoot, "verification/session-refresh-manifest.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), profiles: results, secretsIncluded: false }, null, 2)}\n`);
process.stdout.write(JSON.stringify({ refreshed: results.map((item) => item.profile), secretsPrinted: false }) + "\n");
