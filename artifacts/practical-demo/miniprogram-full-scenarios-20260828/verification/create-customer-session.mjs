import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function api(path, options = {}) {
  const response = await fetch(`${required("DEMO_API_BASE")}${path}`, {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {})
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${payload?.error?.code || "REQUEST_FAILED"}: ${payload?.error?.message || response.status}`);
  return payload.data ?? payload;
}

const runtimeDir = required("DEMO_RUNTIME_DIR");
const artifactManifest = required("DEMO_CUSTOMER_MANIFEST");
const phone = required("DEMO_PHONE");
await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
await mkdir(dirname(artifactManifest), { recursive: true });

const sent = await api("/auth/sms/send-code", { method: "POST", body: { phone } });
if (!/^\d{6}$/.test(sent.devCode || "")) throw new Error("Development SMS did not return a six-digit code");
const session = await api("/auth/phone/login", { method: "POST", body: { phone, code: sent.devCode } });
const acceptedAt = new Date().toISOString();
const consentInput = {
  version: required("LEGAL_CONSENT_VERSION"),
  acceptedAt,
  privacyAccepted: true,
  termsAccepted: true,
  adultConfirmed: true,
  privacyUrl: required("LEGAL_PRIVACY_URL"),
  termsUrl: required("LEGAL_TERMS_URL"),
  source: "wechatMiniProgram"
};
const consent = await api("/users/me/legal-consents", {
  method: "POST",
  token: session.accessToken,
  body: consentInput
});

const storage = {
  "talkandtalk.accessToken": session.accessToken,
  "talkandtalk.refreshToken": session.refreshToken,
  "talkandtalk.user": session.user,
  "talkandtalk.legalConsent": { ...consentInput, userId: session.user.id }
};
const sessionPath = resolve(runtimeDir, "customer-session.json");
const payloadPath = resolve(runtimeDir, "devtools-storage-payload.json");
await writeFile(sessionPath, `${JSON.stringify(session)}\n`, { mode: 0o600 });
await writeFile(payloadPath, `${JSON.stringify({ storage }, null, 2)}\n`, { mode: 0o600 });
await chmod(sessionPath, 0o600);
await chmod(payloadPath, 0o600);

const manifest = {
  generatedAt: new Date().toISOString(),
  authBridge: "development phone login for local Developer Tools only",
  user: { id: session.user.id, role: session.user.role },
  legalConsent: { receiptId: consent.receipt.id, version: consent.receipt.version, recorded: true },
  devtoolsStorageKeys: Object.keys(storage),
  secretsPersistedInArtifact: false,
  runtimeSessionPath: "outside artifact under /private/tmp",
  runtimeStoragePayloadPath: "outside artifact under /private/tmp"
};
await writeFile(artifactManifest, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(manifest)}\n`);
