import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const acceptanceSmoke = resolve(scriptDirectory, "acceptance-smoke.sh");
const productionSmoke = resolve(scriptDirectory, "production-smoke.sh");

test("production smoke refuses before any loopback connection without a per-action record", async () => {
  const result = await invokeProductionProbe();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PRODUCTION_SMOKE_AUTHORIZATION_EVIDENCE/);
  assert.equal(result.connectionCount, 0);
});

test("production smoke rejects expired or mismatched target records before any loopback connection", async () => {
  const expired = await invokeProductionProbe((target) => ({
      PRODUCTION_SMOKE_ALLOWED_BASE_URL: target,
      PRODUCTION_SMOKE_AUTHORIZATION_EVIDENCE: "E1-PRODUCTION-SMOKE-20260810",
      PRODUCTION_SMOKE_AUTHORIZATION_EXPIRES_AT: "2000-01-01T00:00:00Z"
  }));
  assert.notEqual(expired.status, 0);
  assert.match(expired.stderr, /expired/);
  assert.equal(expired.connectionCount, 0);

  const mismatched = await invokeProductionProbe(() => ({
      PRODUCTION_SMOKE_ALLOWED_BASE_URL: "https://127.0.0.1:1",
      PRODUCTION_SMOKE_AUTHORIZATION_EVIDENCE: "E1-PRODUCTION-SMOKE-20260810",
      PRODUCTION_SMOKE_AUTHORIZATION_EXPIRES_AT: "2099-01-01T00:00:00Z"
  }));
  assert.notEqual(mismatched.status, 0);
  assert.match(mismatched.stderr, /does not match/);
  assert.equal(mismatched.connectionCount, 0);
});

test("production smoke has only trusted direct read probes after its record gate", () => {
  const source = readSource(productionSmoke);
  assert.doesNotMatch(source, /-X POST/);
  assert.doesNotMatch(source, /auth\/sms\/send-code/);
  assert.doesNotMatch(source, /payments\/wechat\/mock-notify/);
  assert.match(source, /assert data\.get\("appEnv"\) == "production"/);
  assert.match(source, /CURL_BIN="\/usr\/bin\/curl"/);
  assert.match(source, /unset ALL_PROXY all_proxy HTTP_PROXY http_proxy HTTPS_PROXY https_proxy NO_PROXY no_proxy/);
  const curlInvocations = source.match(/(?:=\$\(|^\s*)"\$CURL_BIN"/gm) ?? [];
  const configDisabledInvocations = source.match(/(?:=\$\(|^\s*)"\$CURL_BIN" -q --noproxy '\*'/gm) ?? [];
  assert.ok(curlInvocations.length > 0);
  assert.equal(configDisabledInvocations.length, curlInvocations.length);
  assert.match(source, /value\.endswith\("Z"\)/);
});

test("acceptance smoke is explicit-development and loopback-only before any connection", async () => {
  const missingIntent = await invokeLoopbackProbe({
    script: acceptanceSmoke,
    protocol: "http"
  });
  assert.notEqual(missingIntent.status, 0);
  assert.match(missingIntent.stderr, /ACCEPTANCE_SMOKE_LOCAL_EXECUTION=1/);
  assert.equal(missingIntent.connectionCount, 0);

  const remote = await invokeLoopbackProbe({
    script: acceptanceSmoke,
    protocol: "https",
    environmentForTarget: () => ({ ACCEPTANCE_SMOKE_LOCAL_EXECUTION: "1" })
  });
  assert.notEqual(remote.status, 0);
  assert.match(remote.stderr, /non-127\.0\.0\.1/);
  assert.equal(remote.connectionCount, 0);

  const source = readSource(acceptanceSmoke);
  assert.doesNotMatch(source, /ALLOW_NON_DEVELOPMENT_SMOKE/);
  assert.doesNotMatch(source, /\|localhost/);
  assert.match(source, /CURL_BIN="\/usr\/bin\/curl"/);
  assert.match(source, /unset ALL_PROXY all_proxy HTTP_PROXY http_proxy HTTPS_PROXY https_proxy NO_PROXY no_proxy/);
  assert.match(source, /local -a args=\(-q --noproxy '\*'/);
  assert.match(source, /"\$CURL_BIN" "\$\{args\[@\]\}"/);
  assert.match(source, /PUBLIC_INTERACTION_IDENTITY_REQUIRED/);
  assert.match(source, /order and payment writes failed closed before creation/);
  assert.match(source, /this run is not commercial acceptance/);
});

function readSource(path) {
  return readFileSync(path, "utf8");
}

async function invokeProductionProbe(environmentForTarget = () => ({})) {
  return invokeLoopbackProbe({
    script: productionSmoke,
    protocol: "https",
    environmentForTarget
  });
}

async function invokeLoopbackProbe({ script, protocol, environmentForTarget = () => ({}) }) {
  let connectionCount = 0;
  const server = createServer((socket) => {
    connectionCount += 1;
    socket.destroy();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const target = `${protocol}://127.0.0.1:${address.port}`;
  const directory = mkdtempSync(join(tmpdir(), "talk-and-talk-smoke-guard-"));
  try {
    const result = await runChild("bash", [script, target], {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: directory,
      LANG: "C",
      ...environmentForTarget(target)
    });
    return { ...result, connectionCount };
  } finally {
    await closeServer(server);
    rmSync(directory, { force: true, recursive: true });
  }
}

function runChild(command, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timed out running ${command}`));
    }, 5_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (status, signal) => {
      clearTimeout(timeout);
      resolve({ status, signal, stdout, stderr });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
