import { readFileSync, existsSync, readdirSync } from "node:fs";
import { isIP } from "node:net";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(sourceRoot, "../..");
const errors = [];
const warnings = [];
const releaseMode = /^(1|true|yes)$/i.test(process.env.MINIPROGRAM_RELEASE || "");
const arguments_ = process.argv.slice(2);

function validationRoot() {
  if (!arguments_.length) return sourceRoot;
  if (arguments_.length !== 2 || arguments_[0] !== "--root") {
    console.error("Usage: node scripts/validate.mjs [--root <mini-program-directory>]");
    process.exit(2);
  }
  return resolve(process.cwd(), arguments_[1]);
}

const root = validationRoot();
if (!existsSync(root)) {
  console.error(`Mini Program validation root does not exist: ${root}`);
  process.exit(2);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`${relative(root, path)} is not valid JSON: ${error.message}`);
    return {};
  }
}

function walk(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? walk(child) : [child];
  });
}

const app = readJson(join(root, "app.json"));
const project = readJson(join(root, "project.config.json"));
const pages = Array.isArray(app.pages) ? app.pages : [];
const externalAppId = (process.env.WECHAT_MINIPROGRAM_APP_ID || "").trim();

if (!pages.length) errors.push("app.json must register at least one page");
if (new Set(pages).size !== pages.length) errors.push("app.json contains duplicate pages");
if (!project.setting?.useCompilerPlugins?.includes("typescript")) {
  errors.push("project.config.json must enable the TypeScript compiler plugin");
}
if (project.setting?.urlCheck !== true) {
  errors.push("project.config.json must keep setting.urlCheck=true; local URL bypasses belong only in generated local copies");
}
if (project.projectname !== "talk-and-talk") {
  errors.push("project.config.json must keep the production projectname talk-and-talk");
}
if (project.appid) {
  errors.push("project.config.json must not commit an AppID; provide WECHAT_MINIPROGRAM_APP_ID through the release environment");
}
if (!/^wx[a-zA-Z0-9]{16}$/.test(externalAppId)) {
  const message = "WECHAT_MINIPROGRAM_APP_ID must be supplied externally as a valid wx-prefixed AppID";
  if (releaseMode) errors.push(message);
  else warnings.push(`${message}; local structure checks continue in development mode`);
}
if (pages[0] !== "pages/consent/index") errors.push("pages/consent/index must remain the first-use entry page");
for (const requiredPage of ["pages/consent/index", "pages/legal/index"]) {
  if (!pages.includes(requiredPage)) errors.push(`app.json must register ${requiredPage}`);
}

for (const page of pages) {
  const base = join(root, page);
  for (const extension of [".ts", ".json", ".wxml", ".wxss"]) {
    if (!existsSync(`${base}${extension}`)) errors.push(`${page}${extension} is missing`);
  }

  if (!existsSync(`${base}.ts`) || !existsSync(`${base}.wxml`)) continue;
  const source = readFileSync(`${base}.ts`, "utf8");
  const template = readFileSync(`${base}.wxml`, "utf8");
  if (!/\bPage\s*\(/.test(source)) errors.push(`${page}.ts does not register Page(...)`);

  const bindings = [...template.matchAll(/\bbind(?:tap|input|change|confirm|longpress)="([A-Za-z_$][\w$]*)"/g)]
    .map((match) => match[1]);
  for (const handler of new Set(bindings)) {
    if (!new RegExp(`\\b${handler}\\s*\\(`).test(source)) {
      errors.push(`${page}.wxml binds ${handler}, but ${page}.ts does not define it`);
    }
  }

  const withoutSelfClosing = template.replace(/<([\w-]+)\b[^>]*\/>/g, "");
  for (const tag of ["view", "button", "text", "picker", "textarea"]) {
    const opens = (withoutSelfClosing.match(new RegExp(`<${tag}\\b`, "g")) || []).length;
    const closes = (withoutSelfClosing.match(new RegExp(`</${tag}>`, "g")) || []).length;
    if (opens !== closes) errors.push(`${page}.wxml has unbalanced <${tag}> tags (${opens} open, ${closes} close)`);
  }
}

const registered = new Set(pages);
for (const item of app.tabBar?.list || []) {
  if (!registered.has(item.pagePath)) errors.push(`tabBar page ${item.pagePath} is not registered in app.json`);
}

for (const file of walk(root).filter((path) => [".ts", ".wxml", ".json"].includes(extname(path)))) {
  const content = readFileSync(file, "utf8");
  for (const match of content.matchAll(/\/pages\/([\w/-]+)(?:\?[^"'`]*)?/g)) {
    if (!registered.has(`pages/${match[1]}`)) {
      errors.push(`${relative(root, file)} navigates to unregistered page pages/${match[1]}`);
    }
  }
  if (/WECHAT_MINIPROGRAM_APP_SECRET|api\.weixin\.qq\.com\/sns\/jscode2session/.test(content)) {
    errors.push(`${relative(root, file)} contains server-only WeChat credential logic`);
  }
}

const apiConfig = readFileSync(join(root, "utils/config.ts"), "utf8");

function recordString(source, recordName, key) {
  const body = source.match(new RegExp(`const\\s+${recordName}\\b[^=]*=\\s*\\{([\\s\\S]*?)\\n\\}(?:\\s+as\\s+const)?;`))?.[1];
  return body?.match(new RegExp(`${key}\\s*:\\s*[\"']([^\"']+)[\"']`))?.[1] || null;
}

function isNonPublicOrLiteralHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || isIP(host) !== 0;
}

function publicHttpsUrl(value, expectedPath, description) {
  if (!value) {
    errors.push(`${description} must be configured`);
    return null;
  }

  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      isNonPublicOrLiteralHost(parsed.hostname) ||
      parsed.pathname !== expectedPath
    ) {
      errors.push(`${description} must use a public HTTPS domain and exact path ${expectedPath}`);
      return null;
    }
    return parsed;
  } catch {
    errors.push(`${description} must be a valid public HTTPS URL`);
    return null;
  }
}

const releaseApiBaseUrl = publicHttpsUrl(
  recordString(apiConfig, "HTTPS_BACKENDS", "release"),
  "/api/v1",
  "HTTPS_BACKENDS.release"
);
const stagingApiBaseUrl = publicHttpsUrl(
  recordString(apiConfig, "HTTPS_BACKENDS", "trial"),
  "/api/v1",
  "HTTPS_BACKENDS.trial"
);
if (releaseApiBaseUrl && stagingApiBaseUrl && releaseApiBaseUrl.origin === stagingApiBaseUrl.origin) {
  errors.push("HTTPS_BACKENDS.trial and HTTPS_BACKENDS.release must use separate origins");
}

for (const [document, publicFile] of [["privacy", "privacy.html"], ["terms", "terms.html"]]) {
  const legalUrl = publicHttpsUrl(
    recordString(apiConfig, "LEGAL_URLS", document),
    `/legal/${publicFile}`,
    `LEGAL_URLS.${document}`
  );
  if (releaseApiBaseUrl && legalUrl && releaseApiBaseUrl.origin !== legalUrl.origin) {
    errors.push(`LEGAL_URLS.${document} must use the same public origin as HTTPS_BACKENDS.release`);
  }
  if (!existsSync(join(repo, "backend/api/public/legal", publicFile))) {
    errors.push(`backend/api/public/legal/${publicFile} is missing`);
  }
}

function extractGenderContract(source, path) {
  const body = source.match(/\bUSER_GENDERS\b[^=]*=\s*\[([^\]]+)\]/s)?.[1];
  if (!body) {
    errors.push(`${path} must export USER_GENDERS as a string array`);
    return [];
  }
  return [...body.matchAll(/["']([^"']+)["']/g)].map((match) => match[1]);
}

const frontendGenderPath = join(root, "utils/models.ts");
const backendGenderPath = join(repo, "backend/api/src/users/dto/update-me.dto.ts");
const frontendGenders = extractGenderContract(readFileSync(frontendGenderPath, "utf8"), relative(repo, frontendGenderPath));
const backendGenders = extractGenderContract(readFileSync(backendGenderPath, "utf8"), relative(repo, backendGenderPath));
if (JSON.stringify(frontendGenders) !== JSON.stringify(backendGenders)) {
  errors.push(`gender contract drift: Mini Program [${frontendGenders.join(", ")}] != API [${backendGenders.join(", ")}]`);
}

if (!/callContainer/.test(readFileSync(join(root, "utils/api.ts"), "utf8")) || !/X-WX-SERVICE/.test(readFileSync(join(root, "utils/api.ts"), "utf8"))) {
  errors.push("utils/api.ts must preserve the WeChat Cloud Run transport boundary");
}

for (const warning of warnings) console.warn(`WARN: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}
console.log(`Mini Program structure valid: ${pages.length} pages, ${app.tabBar?.list?.length || 0} tabs (${releaseMode ? "release" : "development"} gate)`);
