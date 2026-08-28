import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `HTTP ${response.status}`);
    error.code = payload?.error?.code || "REQUEST_FAILED";
    error.status = response.status;
    throw error;
  }
  return payload.data ?? payload;
}

const runtimeDir = required("DEMO_RUNTIME_DIR");
const sessionPath = `${runtimeDir}/customer-session.json`;
const evidencePath = required("DEMO_CUSTOMER_EVIDENCE_OUT");
await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
await mkdir(dirname(evidencePath), { recursive: true });

const phone = required("DEMO_PHONE");
const sent = await api("/auth/sms/send-code", {
  method: "POST",
  body: { phone }
});
if (!/^\d{6}$/.test(sent.devCode || "")) {
  throw new Error("Development SMS endpoint did not return a devCode");
}

const session = await api("/auth/phone/login", {
  method: "POST",
  body: { phone, code: sent.devCode }
});
const acceptedAt = new Date().toISOString();
const consent = await api("/users/me/legal-consents", {
  method: "POST",
  token: session.accessToken,
  body: {
    version: required("LEGAL_CONSENT_VERSION"),
    acceptedAt,
    privacyAccepted: true,
    termsAccepted: true,
    adultConfirmed: true,
    privacyUrl: required("LEGAL_PRIVACY_URL"),
    termsUrl: required("LEGAL_TERMS_URL"),
    source: "wechatMiniProgram"
  }
});

await writeFile(sessionPath, `${JSON.stringify(session)}\n`, { mode: 0o600 });
const evidence = {
  generatedAt: new Date().toISOString(),
  authBridge: "development phone login injected into the local WeChat DevTools runtime",
  user: { id: session.user.id, role: session.user.role },
  legalConsent: {
    receiptId: consent.receipt.id,
    version: consent.receipt.version,
    recorded: true
  },
  secretsPersistedInArtifact: false,
  runtimeSessionPath: "outside artifact under /private/tmp (removed during cleanup)"
};
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(evidence)}\n`);
