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
for (const requiredPage of ["pages/consent/index", "pages/legal/index", "pages/crisis/index"]) {
  if (!pages.includes(requiredPage)) errors.push(`app.json must register ${requiredPage}`);
}

const crisisTemplatePath = join(root, "pages/crisis/index.wxml");
const crisisSourcePath = join(root, "pages/crisis/index.ts");
const crisisGatePath = join(root, "utils/crisis-gate.ts");
if (existsSync(crisisTemplatePath) && existsSync(crisisSourcePath) && existsSync(crisisGatePath)) {
  const crisisTemplate = readFileSync(crisisTemplatePath, "utf8");
  const crisisSource = readFileSync(crisisSourcePath, "utf8");
  const crisisGate = readFileSync(crisisGatePath, "utf8");
  for (const requiredText of ["一键拨号", "官方来源", "核验日期", "普通客服工单不是紧急服务", "不会自动报警"]) {
    if (!crisisTemplate.includes(requiredText)) errors.push(`pages/crisis/index.wxml must disclose: ${requiredText}`);
  }
  if (!/code:\s*["']110["']/.test(crisisSource) || !/code:\s*["']120["']/.test(crisisSource)) {
    errors.push("pages/crisis/index.ts must preserve the offline 110/120 emergency baseline");
  }
  if (!/lastVerifiedOn:\s*["']\d{4}-\d{2}-\d{2}["']/.test(crisisSource)) {
    errors.push("pages/crisis/index.ts must show a dated resource verification fact");
  }
  if (/intentInput|messageId|content\s*:/.test(crisisGate)) {
    errors.push("utils/crisis-gate.ts must never persist or route raw intent/message content");
  }
}

for (const gatedPath of [
  "pages/home/index.ts",
  "pages/discover/index.ts",
  "pages/companion/detail.ts"
]) {
  const source = readFileSync(join(root, gatedPath), "utf8");
  if (!/passCrisisGate\s*\(/.test(source)) errors.push(`${gatedPath} must use the shared crisis gate`);
}
const chatTemplate = readFileSync(join(root, "pages/chat/index.wxml"), "utf8");
if (!/item\.type === 'safety'[\s\S]*查看紧急帮助/.test(chatTemplate)) {
  errors.push("pages/chat/index.wxml must provide a message-level emergency-help route for safety messages");
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

  for (const match of template.matchAll(/<(?:view|image)\b[^>]*(?:bindtap|catchtap)="[^"]+"[^>]*>/g)) {
    const control = match[0];
    if (!/\baria-role="[^"]+"/.test(control) || !/\baria-label="[^"]+"/.test(control)) {
      errors.push(`${page}.wxml has a custom tap target without aria-role and aria-label`);
    }
    if (/\baria-role="(?:button|checkbox|radio)"/.test(control) && !/\btabindex="0"/.test(control)) {
      errors.push(`${page}.wxml has a custom interactive control without tabindex=0`);
    }
  }
  for (const match of template.matchAll(/<switch\b[^>]*>/g)) {
    if (!/\baria-label="[^"]+"/.test(match[0])) {
      errors.push(`${page}.wxml has a switch without aria-label`);
    }
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

/**
 * Release is a text-only security boundary. Runtime smoke verifies behavior,
 * but it does not render WXML or catch a future removal of these UI guards.
 * Keep a cheap static gate here so the release CI rejects that drift before an
 * experience build can be uploaded.
 */
function validateTextOnlyReleaseBoundary() {
  const files = {
    config: apiConfig,
    controlledEvidence: readFileSync(join(root, "utils/controlled-evidence.ts"), "utf8"),
    models: readFileSync(join(root, "utils/models.ts"), "utf8"),
    api: readFileSync(join(root, "utils/api.ts"), "utf8"),
    attendance: readFileSync(join(root, "utils/attendance-disputes-api.ts"), "utf8"),
    chatSource: readFileSync(join(root, "pages/chat/index.ts"), "utf8"),
    chatTemplate: readFileSync(join(root, "pages/chat/index.wxml"), "utf8"),
    supportSource: readFileSync(join(root, "pages/support/detail.ts"), "utf8"),
    supportTemplate: readFileSync(join(root, "pages/support/detail.wxml"), "utf8"),
    disputeSource: readFileSync(join(root, "pages/order/dispute.ts"), "utf8"),
    disputeTemplate: readFileSync(join(root, "pages/order/dispute.wxml"), "utf8"),
    safetySource: readFileSync(join(root, "pages/companion/safety/index.ts"), "utf8"),
    safetyTemplate: readFileSync(join(root, "pages/companion/safety/index.wxml"), "utf8"),
  };
  const functionStartsWith = (source, name, expected) => {
    const match = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
    if (!match || match.index === undefined) return false;
    const bodyStart = source.indexOf("{", match.index);
    return bodyStart >= 0 && source.slice(bodyStart, bodyStart + 360).includes(expected);
  };
  const methodStartsWith = (source, name, expected) => {
    const match = new RegExp(`\\n\\s*(?:async\\s+)?${name}\\s*\\(`).exec(source);
    if (!match || match.index === undefined) return false;
    const bodyStart = source.indexOf("{", match.index);
    return bodyStart >= 0 && source.slice(bodyStart, bodyStart + 360).includes(expected);
  };

  if (!/function\s+isExplicitDevelopmentEnvironment\s*\([\s\S]*?envVersion\s*===\s*["']develop["'][\s\S]*?if\s*\(!isExplicitDevelopmentEnvironment\(\)\)\s*return\s+true/.test(files.config)) {
    errors.push("utils/config.ts must force trial, release, and unknown environments to text-only before any global override");
  }
  if (!/export\s+type\s+ChatMessage\s*=\s*\{[\s\S]*?\bconversationId\s*:\s*string\s*;[\s\S]*?\bsenderName\?\s*:\s*string\s*\|\s*null\s*;[\s\S]*?\btype\s*:\s*[\s\S]*?"safety"\s*;[\s\S]*?\bmoderationStatus\s*:\s*[\s\S]*?"removed"\s*;[\s\S]*?\bvisibility\s*:\s*[\s\S]*?"staffOnly"\s*;[\s\S]*?\battachments\s*:\s*MediaAttachment\[\]\s*;/.test(files.models)) {
    errors.push("utils/models.ts ChatMessage must match required v1 message fields and closed enums");
  }
  if (!/messages:\s*\([^)]*\)[\s\S]*?pagination:\s*\{\s*limit:\s*number;\s*nextCursor:\s*string\s*\|\s*null;\s*hasMore:\s*boolean\s*\}/.test(files.api)) {
    errors.push("utils/api.ts messages contract must require pagination.limit and pagination.nextCursor");
  }
  if (!/function\s+assertControlledEvidenceEnabled\s*\(/.test(files.controlledEvidence)) {
    errors.push("utils/controlled-evidence.ts must retain the text-only fail-closed assertion");
  }
  for (const utility of ["chooseEvidenceImage", "chooseEvidenceAudio"]) {
    if (!functionStartsWith(files.controlledEvidence, utility, "!controlledEvidenceEnabled()")) {
      errors.push(`utils/controlled-evidence.ts ${utility} must not open a local media chooser in text-only mode`);
    }
  }
  for (const utility of ["uploadControlledEvidence", "pollControlledEvidence"]) {
    if (!functionStartsWith(files.controlledEvidence, utility, "assertControlledEvidenceEnabled()")) {
      errors.push(`utils/controlled-evidence.ts ${utility} must reject before local media or network work in text-only mode`);
    }
  }
  if (!/function\s+permittedEvidenceAssetIds\s*\([^)]*\)[\s\S]*?isCommercialTextOnly\(\)\s*\?\s*\[\]/.test(files.attendance)) {
    errors.push("utils/attendance-disputes-api.ts must drop stale evidence asset IDs in text-only mode");
  }
  for (const method of ["statement", "appeal"]) {
    if (!new RegExp(`${method}:\\s*\\([^)]*evidenceAssetIds[^)]*\\)[\\s\\S]*?permittedEvidenceAssetIds\\(evidenceAssetIds\\)`, "s").test(files.attendance)) {
      errors.push(`utils/attendance-disputes-api.ts ${method} must use the text-only evidence projection`);
    }
  }

  for (const handler of ["chooseImage", "toggleRecord", "sendMedia", "previewImage", "playAudio"]) {
    if (!methodStartsWith(files.chatSource, handler, "if (isCommercialTextOnly())")) {
      errors.push(`pages/chat/index.ts ${handler} must fail closed in text-only mode`);
    }
  }
  if (!/wx:if="\{\{mediaEnabled\s*&&\s*!textOnly\}\}"/.test(files.chatTemplate)) {
    errors.push("pages/chat/index.wxml must hide media entry points when textOnly");
  }
  if (!/wx:if="\{\{!textOnly\s*&&\s*item\.attachments\.length\}\}"/.test(files.chatTemplate)) {
    errors.push("pages/chat/index.wxml must hide historic attachments when textOnly");
  }

  for (const [label, source, template] of [
    ["pages/support/detail", files.supportSource, files.supportTemplate],
    ["pages/order/dispute", files.disputeSource, files.disputeTemplate],
    ["pages/companion/safety/index", files.safetySource, files.safetyTemplate],
  ]) {
    if (!/controlledEvidenceEnabled\(\)/.test(source)) {
      errors.push(`${label}.ts must use the controlled-evidence text-only gate`);
    }
    if (!/textOnly/.test(template) || !/wx:if="\{\{!textOnly/.test(template)) {
      errors.push(`${label}.wxml must hide evidence actions and reads when textOnly`);
    }
  }
}

validateTextOnlyReleaseBoundary();

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
