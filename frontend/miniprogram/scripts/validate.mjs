import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const warnings = [];

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

if (!pages.length) errors.push("app.json must register at least one page");
if (new Set(pages).size !== pages.length) errors.push("app.json contains duplicate pages");
if (!project.setting?.useCompilerPlugins?.includes("typescript")) {
  errors.push("project.config.json must enable the TypeScript compiler plugin");
}
if (!project.appid || project.appid === "touristappid") {
  warnings.push("project.config.json still uses touristappid; set the real AppID before device login/payment testing");
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
if (!/https:\/\//.test(apiConfig) || /localhost|127\.0\.0\.1/.test(apiConfig)) {
  errors.push("utils/config.ts must use a public HTTPS API domain");
}

for (const warning of warnings) console.warn(`WARN: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}
console.log(`Mini Program structure valid: ${pages.length} pages, ${app.tabBar?.list?.length || 0} tabs`);
