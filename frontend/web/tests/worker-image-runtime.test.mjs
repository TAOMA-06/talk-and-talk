import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const serverDirectory = fileURLToPath(new URL("../dist/server/", import.meta.url));
const wranglerCli = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not reserve an IPv4 loopback port")));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForResponse(url, timeoutMilliseconds = 20_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return response;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await pause(100);
  }
  throw new Error(`Timed out waiting for local Worker at ${url}: ${lastError?.message || "no response"}`);
}

async function fetchOk(url, timeoutMilliseconds = 10_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status === 200) return response;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await pause(100);
  }
  throw new Error(`Timed out fetching ${url}: ${lastError?.message || "no response"}`);
}

async function assertNonEmptyBody(response, label) {
  const reader = response.body?.getReader();
  assert.ok(reader, `${label} must have a response body`);
  try {
    const { done, value } = await reader.read();
    assert.equal(done, false, `${label} must not be empty`);
    assert.ok(value?.byteLength > 0, `${label} must contain image bytes`);
  } finally {
    await reader.cancel();
  }
}

async function stopWorker(worker) {
  if (!worker || worker.exitCode !== null || worker.signalCode !== null) return;
  worker.kill("SIGTERM");
  await Promise.race([once(worker, "exit"), pause(2_000)]);
  if (worker.exitCode === null && worker.signalCode === null) {
    worker.kill("SIGKILL");
    await once(worker, "exit");
  }
}

function optimizedImagePaths(html) {
  return [...new Set(
    [...html.matchAll(/\/_vinext\/image\?[^"'\s,]+/g)].map(([path]) => path.replaceAll("&amp;", "&")),
  )];
}

test("built local Worker serves every optimized image emitted by the public home", { timeout: 30_000 }, async (t) => {
  const runtimeDirectory = await mkdtemp(join(tmpdir(), "talktalk-web-image-runtime-"));
  const port = await reserveLoopbackPort();
  const output = [];
  const worker = spawn(
    process.execPath,
    [
      wranglerCli,
      "dev",
      "--config",
      "wrangler.json",
      "--local",
      "--no-bundle",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--inspector-ip",
      "127.0.0.1",
      "--inspector-port",
      "0",
      "--persist-to",
      runtimeDirectory,
      "--log-level",
      "warn",
    ],
    {
      cwd: serverDirectory,
      env: {
        ...process.env,
        NODE_ENV: "production",
        WEB_SURFACE_MODE: "candidate",
        TALKTALK_IMAGE_TRANSFORM_ENABLED: "false",
        WRANGLER_WRITE_LOGS: "false",
        WRANGLER_LOG_PATH: join(runtimeDirectory, "wrangler.log"),
        MINIFLARE_REGISTRY_PATH: join(runtimeDirectory, "registry"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  worker.stdout.on("data", (chunk) => output.push(chunk.toString()));
  worker.stderr.on("data", (chunk) => output.push(chunk.toString()));
  worker.on("error", (error) => output.push(`worker spawn error: ${error.message}`));
  worker.on("exit", (code, signal) => output.push(`worker exit: code=${code} signal=${signal}`));

  t.after(async () => {
    await stopWorker(worker);
    await rm(runtimeDirectory, { recursive: true, force: true });
  });

  const origin = `http://127.0.0.1:${port}`;
  try {
    const home = await waitForResponse(`${origin}/`);
    assert.equal(home.status, 200);
    const html = await home.text();
    const imagePaths = optimizedImagePaths(html);
    assert.ok(imagePaths.length > 0, "public home must emit optimized local image URLs");

    const emittedWidths = new Set(imagePaths.map((path) => new URL(path, origin).searchParams.get("w")));
    for (const width of ["36", "44", "220", "420", "640"]) {
      assert.ok(emittedWidths.has(width), `public home must retain width ${width}`);
    }

    const staticResponse = await fetchOk(`${origin}/brand/app-icon.png`);
    assert.match(staticResponse.headers.get("content-type") ?? "", /^image\/png\b/i);
    await assertNonEmptyBody(staticResponse, "/brand/app-icon.png");

    for (const path of imagePaths) {
      const response = await fetchOk(new URL(path, origin));
      assert.match(response.headers.get("content-type") ?? "", /^image\/png\b/i, path);
      await assertNonEmptyBody(response, path);
    }

    await pause(100);
    assert.doesNotMatch(output.join(""), /Image optimization error/i);
  } catch (error) {
    error.message = `${error.message}\nLocal Worker output:\n${output.join("")}`;
    throw error;
  }
});
