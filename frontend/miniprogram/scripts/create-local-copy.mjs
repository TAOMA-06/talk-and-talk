import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = resolve(sourceRoot, "..", "miniprogram-local");
const markerFile = ".talkandtalk-local-build";
const marker = "Talk&Talk generated local Mini Program build. Safe to replace.\n";
const excludedFromCopy = new Set([".DS_Store", "miniprogram_npm", "project.private.config.json"]);

function usage(exitCode = 0) {
  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write(
    "Usage: node frontend/miniprogram/scripts/create-local-copy.mjs --api-base-url <http://127.0.0.1:3000/api/v1|https://staging-host/api/v1>\n"
  );
  process.exit(exitCode);
}

function pathIsInside(parent, child) {
  const relation = relative(parent, child);
  return relation !== "" && relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation);
}

function normalizedHost(hostname) {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function isPrivateIpv4(hostname) {
  const octets = hostname.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = octets;
  return first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254);
}

function isLocalHttpHost(hostname) {
  const host = normalizedHost(hostname);
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (isIP(host) === 4) return isPrivateIpv4(host);
  return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:");
}

function parseArguments() {
  const args = process.argv.slice(2);
  let apiBaseUrl = "";
  let output = defaultOutput;
  let hasCustomOutput = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") usage();
    if (argument === "--api-base-url") {
      apiBaseUrl = args[++index] || "";
      continue;
    }
    if (argument === "--output") {
      output = resolve(process.cwd(), args[++index] || "");
      hasCustomOutput = true;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!apiBaseUrl) throw new Error("--api-base-url is required");
  if (hasCustomOutput && !pathIsInside(resolve(tmpdir()), output)) {
    throw new Error("--output is reserved for automated tests and must be a new directory under the system temporary directory");
  }
  return { apiBaseUrl, output };
}

function parseApiBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("--api-base-url must be a valid absolute URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("--api-base-url must use http or https");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("--api-base-url must not contain credentials, a query string, or a fragment");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  if (parsed.pathname !== "/api/v1") {
    throw new Error("--api-base-url must end exactly with /api/v1");
  }
  if (parsed.protocol === "http:" && !isLocalHttpHost(parsed.hostname)) {
    throw new Error("http API targets are limited to loopback, private-LAN, or .local hosts; use HTTPS for staging");
  }
  return parsed.toString().replace(/\/$/, "");
}

function replaceExactlyOnce(source, expression, replacement, description) {
  let replacements = 0;
  const result = source.replace(expression, () => {
    replacements += 1;
    return replacement;
  });
  if (replacements !== 1) throw new Error(`Could not update ${description} in the generated config`);
  return result;
}

function replaceHttpsBackends(source, apiBaseUrl) {
  let recordReplacements = 0;
  const result = source.replace(/const HTTPS_BACKENDS[\s\S]*?\n\};/, (record) => {
    recordReplacements += 1;
    let endpointReplacements = 0;
    const updated = record.replace(/\b(develop|trial|release)\s*:\s*["'][^"']+["']/g, (_match, environment) => {
      endpointReplacements += 1;
      return `${environment}: ${JSON.stringify(apiBaseUrl)}`;
    });
    if (endpointReplacements !== 3) {
      throw new Error("Could not update all HTTPS_BACKENDS entries in the generated config");
    }
    return updated;
  });
  if (recordReplacements !== 1) {
    throw new Error("Could not locate HTTPS_BACKENDS in the generated config");
  }
  return result;
}

function localConfig(apiBaseUrl) {
  const origin = new URL(apiBaseUrl).origin;
  let source = readFileSync(join(sourceRoot, "utils/config.ts"), "utf8");
  source = replaceHttpsBackends(source, apiBaseUrl);
  source = replaceExactlyOnce(
    source,
    /privacy:\s*["'][^"']+["']/,
    `privacy: ${JSON.stringify(`${origin}/legal/privacy.html`)}`,
    "LEGAL_URLS.privacy"
  );
  source = replaceExactlyOnce(
    source,
    /terms:\s*["'][^"']+["']/,
    `terms: ${JSON.stringify(`${origin}/legal/terms.html`)}`,
    "LEGAL_URLS.terms"
  );
  return `/**\n * GENERATED LOCAL DEVTOOLS BUILD ONLY. DO NOT UPLOAD OR COMMIT THIS COPY.\n * Source: frontend/miniprogram; regenerate with create-local-copy.mjs.\n */\n${source}`;
}

function localProjectConfig(apiBaseUrl) {
  const project = JSON.parse(readFileSync(join(sourceRoot, "project.config.json"), "utf8"));
  delete project.appid;
  project.projectname = "talk-and-talk-local-do-not-upload";
  project.setting = { ...project.setting, urlCheck: new URL(apiBaseUrl).protocol === "https:" };
  return `${JSON.stringify(project, null, 2)}\n`;
}

function ensureReplaceableOutput(output) {
  if (!existsSync(output)) return;
  const existingMarker = join(output, markerFile);
  if (!existsSync(existingMarker) || readFileSync(existingMarker, "utf8") !== marker) {
    throw new Error(`Refusing to replace ${output}: it is not a generated Talk&Talk local build`);
  }
  rmSync(output, { recursive: true, force: true });
}

function writeLocalReadme(output, apiBaseUrl) {
  const domainValidation = new URL(apiBaseUrl).protocol === "https:"
    ? "- Domain validation: kept enabled for the HTTPS staging endpoint"
    : "- Domain validation: disabled only in this generated HTTP local copy";
  const text = [
    "# Local DevTools build — do not upload",
    "",
    "This directory is generated from frontend/miniprogram for local testing only.",
    "",
    `- API base URL: ${apiBaseUrl}`,
    "- Legal pages: the matching local backend origin",
    domainValidation,
    "",
    `Regenerate this directory with node frontend/miniprogram/scripts/create-local-copy.mjs --api-base-url ${apiBaseUrl}. Do not edit or upload it.`,
    ""
  ].join("\n");
  writeFileSync(join(output, "README.LOCAL-ONLY.md"), text);
}

function main() {
  const { apiBaseUrl: requestedApiBaseUrl, output } = parseArguments();
  const apiBaseUrl = parseApiBaseUrl(requestedApiBaseUrl);
  ensureReplaceableOutput(output);
  cpSync(sourceRoot, output, {
    recursive: true,
    filter: (source) => !excludedFromCopy.has(basename(source))
  });
  writeFileSync(join(output, markerFile), marker);
  writeFileSync(join(output, "utils/config.ts"), localConfig(apiBaseUrl));
  writeFileSync(join(output, "project.config.json"), localProjectConfig(apiBaseUrl));
  writeLocalReadme(output, apiBaseUrl);
  console.log(`Generated local Mini Program DevTools copy: ${output}`);
  console.log(`API base URL: ${apiBaseUrl}`);
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
