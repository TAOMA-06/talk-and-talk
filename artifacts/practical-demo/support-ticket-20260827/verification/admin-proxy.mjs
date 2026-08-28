import { createServer, request as httpRequest } from "node:http";
import { appendFile, readFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const artifactRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(artifactRoot, "../../..");
const adminRoot = resolve(repoRoot, "backend/api/public/admin");
const evidenceRoot = resolve(artifactRoot, "evidence");
const proxyLog = resolve(artifactRoot, "logs/admin-proxy.log");
const port = Number(process.env.DEMO_PROXY_PORT || 3100);
const upstreamPort = Number(process.env.DEMO_API_PORT || 3000);

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "font-src 'self' https: data:",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "img-src 'self' data:",
  "object-src 'none'",
  "script-src 'self'",
  "script-src-attr 'none'",
  "style-src 'self' https: 'unsafe-inline'",
  "upgrade-insecure-requests"
].join(";");

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"]
]);

function responseHeaders(contentType) {
  return {
    "content-type": contentType,
    "content-security-policy": csp,
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "SAMEORIGIN",
    "cache-control": "no-store"
  };
}

async function log(event) {
  await appendFile(proxyLog, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
}

function safeEvidenceFile(pathname) {
  const relative = decodeURIComponent(pathname.slice("/evidence/".length));
  const candidate = resolve(evidenceRoot, relative);
  if (!candidate.startsWith(`${evidenceRoot}${sep}`) || extname(candidate) !== ".html") return null;
  return candidate;
}

async function serveFile(res, path) {
  try {
    const body = await readFile(path);
    res.writeHead(200, responseHeaders(contentTypes.get(extname(path)) || "application/octet-stream"));
    res.end(body);
  } catch (error) {
    const status = error?.code === "ENOENT" ? 404 : 500;
    res.writeHead(status, responseHeaders("text/plain; charset=utf-8"));
    res.end(status === 404 ? "Not found" : "Static evidence proxy error");
  }
}

function proxyApi(req, res) {
  const headers = { ...req.headers, host: `127.0.0.1:${upstreamPort}` };
  delete headers.origin;
  delete headers.referer;
  const upstream = httpRequest({
    hostname: "127.0.0.1",
    port: upstreamPort,
    method: req.method,
    path: req.url,
    headers
  }, (upstreamResponse) => {
    const response = { ...upstreamResponse.headers };
    delete response["content-length"];
    res.writeHead(upstreamResponse.statusCode || 502, response);
    upstreamResponse.pipe(res);
    void log({ kind: "api", method: req.method, path: new URL(req.url, "http://proxy.local").pathname, status: upstreamResponse.statusCode || 502 });
  });
  upstream.on("error", (error) => {
    res.writeHead(502, responseHeaders("application/json; charset=utf-8"));
    res.end(JSON.stringify({ error: { code: "PROXY_UPSTREAM_UNAVAILABLE", message: "Local API unavailable" } }));
    void log({ kind: "api", method: req.method, path: new URL(req.url, "http://proxy.local").pathname, status: 502, error: error.code || "UPSTREAM_ERROR" });
  });
  req.pipe(upstream);
}

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://proxy.local").pathname;
  if (pathname.startsWith("/api/v1/")) {
    proxyApi(req, res);
    return;
  }
  if (pathname === "/admin") {
    res.writeHead(302, { ...responseHeaders("text/plain; charset=utf-8"), location: "/admin/" });
    res.end("Redirecting to /admin/");
    return;
  }
  if (pathname === "/admin/") {
    await serveFile(res, resolve(adminRoot, "index.html"));
    return;
  }
  if (pathname === "/admin/assets/app.js") {
    await serveFile(res, resolve(adminRoot, "assets/app.js"));
    return;
  }
  if (pathname === "/admin/assets/styles.css") {
    await serveFile(res, resolve(adminRoot, "assets/styles.css"));
    return;
  }
  if (pathname.startsWith("/evidence/")) {
    const file = safeEvidenceFile(pathname);
    if (file) {
      await serveFile(res, file);
      return;
    }
  }
  if (pathname === "/favicon.ico") {
    res.writeHead(204, responseHeaders("image/x-icon"));
    res.end();
    return;
  }
  res.writeHead(404, responseHeaders("text/plain; charset=utf-8"));
  res.end("Not found");
});

server.listen(port, "127.0.0.1", () => {
  void log({ kind: "lifecycle", event: "started", port, upstreamPort, adminAssets: "exact backend/api/public/admin files" });
  process.stdout.write(`Admin evidence proxy listening on http://127.0.0.1:${port}\n`);
});

function stop(signal) {
  server.close(() => {
    void log({ kind: "lifecycle", event: "stopped", signal });
    process.exit(0);
  });
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
