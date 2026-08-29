import { chmod, readFile, writeFile } from "node:fs/promises";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const apiBase = required("DEMO_API_BASE");
const runtimeRoot = required("DEMO_RUNTIME_ROOT");
const profiles = [
  { key: "U0", dir: runtimeRoot },
  { key: "U1", dir: `${runtimeRoot}/u1` },
  { key: "P1", dir: `${runtimeRoot}/p1` },
  { key: "R1", dir: `${runtimeRoot}/r1` }
];
const refreshed = [];

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
  refreshed.push(profile.key);
}

process.stdout.write(`${JSON.stringify({ refreshed, secretsPrinted: false })}\n`);
