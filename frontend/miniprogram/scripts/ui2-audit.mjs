import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const app = JSON.parse(readFileSync(resolve(root, "app.json"), "utf8"));
const theme = JSON.parse(readFileSync(resolve(root, app.themeLocation || "theme.json"), "utf8"));
const failures = [];
const fail = (message) => failures.push(message);

if (app.darkmode !== true || app.themeLocation !== "theme.json") fail("app.json must enable darkmode with theme.json");
if (!theme.light || !theme.dark) fail("theme.json must declare light and dark themes");
if (app.pages.length !== 31) fail(`expected 31 registered pages, found ${app.pages.length}`);
if (Object.keys(app.usingComponents || {}).length < 10) fail("shared UI component registry is incomplete");

for (const [name, componentPath] of Object.entries(app.usingComponents || {})) {
  const base = resolve(root, String(componentPath).replace(/^\//, ""));
  for (const extension of ["json", "ts", "wxml", "wxss"]) {
    if (!existsSync(`${base}.${extension}`)) fail(`component ${name} is missing ${extension}`);
  }
}

for (const page of app.pages) {
  const wxss = resolve(root, `${page}.wxss`);
  const wxml = resolve(root, `${page}.wxml`);
  const json = resolve(root, `${page}.json`);
  for (const file of [wxss, wxml, json]) if (!existsSync(file)) fail(`registered page asset missing: ${file}`);
  if (!existsSync(wxss)) continue;
  const styles = readFileSync(wxss, "utf8");
  const template = existsSync(wxml) ? readFileSync(wxml, "utf8") : "";
  if ((styles.match(/\{/g) || []).length !== (styles.match(/\}/g) || []).length) fail(`${page}.wxss has unbalanced rule braces`);
  if (/\{\s*\}/.test(styles)) fail(`${page}.wxss has an empty rule`);
  if (/#[0-9a-f]{3,8}\b/i.test(styles)) fail(`${page}.wxss contains raw colors instead of semantic tokens`);
  if (/(?:linear|radial)-gradient/i.test(styles)) fail(`${page}.wxss contains a prohibited decorative gradient`);
  if (/box-shadow\s*:(?!\s*none)/i.test(styles)) fail(`${page}.wxss contains a prohibited decorative shadow`);
  if (/Restrained redesign/i.test(styles)) fail(`${page}.wxss still contains a legacy tail override layer`);
  if (/&amp;/i.test(template)) fail(`${page}.wxml contains an HTML entity that renders literally in DevTools`);
  for (const match of template.matchAll(/color="(#[0-9a-fA-F]{6})"/g)) {
    if (match[1].toUpperCase() !== "#C65345") fail(`${page}.wxml uses an off-system native control color: ${match[1]}`);
  }
}

for (const item of app.tabBar?.list || []) {
  for (const field of ["iconPath", "selectedIconPath"]) {
    if (typeof item[field] !== "string" || !item[field].startsWith("@")) fail(`tab ${item.pagePath} must theme ${field}`);
  }
}

for (const palette of [theme.light, theme.dark]) {
  for (const key of ["homeIcon", "homeIconSelected", "discoverIcon", "discoverIconSelected", "ordersIcon", "ordersIconSelected", "messagesIcon", "messagesIconSelected", "profileIcon", "profileIconSelected"]) {
    const file = resolve(root, palette[key] || "missing");
    if (!existsSync(file)) fail(`theme icon missing: ${key}`);
    else if (statSync(file).size > 40 * 1024) fail(`theme icon exceeds 40KB: ${palette[key]}`);
  }
}

for (const file of [
  ...["c1-linyu", "c2-xuche", "c3-zhouying", "c4-shenyi", "c5-wenzhou"].flatMap((name) =>
    [384, 768].map((size) => resolve(root, `assets/avatars/${name}-${size}.webp`))
  ),
  resolve(root, "assets/illustrations/home-hero.webp")
]) {
  if (!existsSync(file)) fail(`UI 2.0 asset missing: ${file}`);
  else if (statSync(file).size > (file.includes("home-hero") ? 300 : 160) * 1024) fail(`asset budget exceeded: ${file}`);
}

const chatSource = readFileSync(resolve(root, "pages/chat/index.ts"), "utf8");
if (!/PAYMENT_REQUIRED[\s\S]*当前没有可用的已支付订单/.test(chatSource)) {
  fail("chat must localize the expired paid-order access error");
}
for (const component of ["tt-filter-sheet", "tt-sheet"]) {
  const styles = readFileSync(resolve(root, `components/${component}/index.wxss`), "utf8");
  const source = readFileSync(resolve(root, `components/${component}/index.ts`), "utf8");
  if (!/height:\s*88vh/.test(styles) || !/overflow:\s*hidden/.test(styles)) {
    fail(`${component} must bound root-portal content to a fixed, clipped sheet`);
  }
  if (!/@media\s*\(prefers-color-scheme:\s*dark\)/.test(styles)) {
    fail(`${component} must define portal-local light/dark surface tokens`);
  }
  if (!/styleIsolation:\s*"shared"/.test(source)) {
    fail(`${component} must preserve slotted page styles inside root-portal`);
  }
}
const filterSheetStyles = readFileSync(resolve(root, "components/tt-filter-sheet/index.wxss"), "utf8");
if (!/\.filter-options\s*\{[^}]*flex-wrap:\s*wrap/.test(filterSheetStyles) || !/\.filter-chip-selected\s*\{/.test(filterSheetStyles)) {
  fail("tt-filter-sheet must own its slotted chip layout inside root-portal");
}
const discoverTemplate = readFileSync(resolve(root, "pages/discover/index.wxml"), "utf8");
if (!/class="discover-root"[\s\S]*class="page discover-page"[\s\S]*wx:if="\{\{filterSheetOpen\}\}" class="filter-root"/.test(discoverTemplate)) {
  fail("discover must keep the fixed filter dialog as a sibling of its scrollable page inside one WXML root");
}
if (/<tt-filter-sheet[\s>]/.test(discoverTemplate) || /<root-portal[\s\S]*filterSheetOpen/.test(discoverTemplate)) {
  fail("discover must not route slotted filter chips through root-portal style isolation");
}

if (failures.length) {
  process.stderr.write(failures.map((item) => `ERROR: ${item}`).join("\n") + "\n");
  process.exit(1);
}
process.stdout.write(`UI 2.0 audit passed: ${app.pages.length} pages, ${Object.keys(app.usingComponents).length} components, light/dark themes, token-only registered styles\n`);
