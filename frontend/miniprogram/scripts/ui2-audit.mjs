import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const app = JSON.parse(readFileSync(resolve(root, "app.json"), "utf8"));
const theme = JSON.parse(readFileSync(resolve(root, app.themeLocation || "theme.json"), "utf8"));
const failures = [];
const fail = (message) => failures.push(message);
const foundationOnly = process.env.UI4_FOUNDATION_ONLY === "1";

const requiredUi4Components = [
  "tt-card-shell",
  "tt-card-grid",
  "tt-section-heading",
  "tt-scene-card",
  "tt-fact-card",
  "tt-card-stage",
  "tt-cartoon-prop"
];
const portalComponents = new Set(["tt-sheet", "tt-filter-sheet"]);
const motionCapableComponents = new Set([
  "tt-card-shell",
  "tt-card-grid",
  "tt-section-heading",
  "tt-scene-card",
  "tt-fact-card",
  "tt-card-stage",
  "tt-cartoon-prop",
  "tt-media-card",
  "tt-state",
  "tt-skeleton",
  "tt-action-bar",
  "tt-sheet",
  "tt-filter-sheet"
]);
const allowedPortalColors = new Set([
  "#fffefc",
  "#efeeea",
  "#232220",
  "#5c5954",
  "#dcd8d2",
  "#979189",
  "#292724",
  "#ffffff",
  "#1b1c1a",
  "#232521",
  "#f3f1ed",
  "#b9b4ac",
  "#343630",
  "#6b6f67",
  "#151618"
]);
const allowedPortalFunctionalColors = new Set(["rgba(14,15,16,.46)"]);

function keyframeBodies(source) {
  const bodies = [];
  const marker = /@keyframes\s+[\w-]+\s*\{/gi;
  for (const match of source.matchAll(marker)) {
    const start = match.index + match[0].length;
    let depth = 1;
    let cursor = start;
    while (cursor < source.length && depth > 0) {
      if (source[cursor] === "{") depth += 1;
      if (source[cursor] === "}") depth -= 1;
      cursor += 1;
    }
    if (depth === 0) bodies.push(source.slice(start, cursor - 1));
  }
  return bodies;
}

function auditMotion(relativePath, source) {
  if (/transition\s*:\s*all\b/i.test(source)) {
    fail(`${relativePath} uses forbidden transition: all`);
  }
  if (/animation(?:-iteration-count)?\s*:[^;{}]*\binfinite\b/i.test(source)) {
    fail(`${relativePath} uses a forbidden infinite animation`);
  }
  for (const match of source.matchAll(/transition\s*:\s*([^;{}]+)/gi)) {
    const value = match[1].trim();
    if (value === "none") continue;
    for (const transition of value.split(",")) {
      const property = transition.trim().split(/\s+/)[0];
      if (!["none", "transform", "opacity"].includes(property)) {
        fail(`${relativePath} transitions ${property}; UI 4.0 motion may transition only transform/opacity`);
      }
    }
  }
  for (const body of keyframeBodies(source)) {
    for (const declaration of body.matchAll(/([\w-]+)\s*:/g)) {
      if (!["transform", "opacity"].includes(declaration[1])) {
        fail(`${relativePath} keyframes animate ${declaration[1]}; UI 4.0 keyframes may animate only transform/opacity`);
      }
    }
  }
}

function auditStaticTextOpacity(relativePath, source) {
  const textSelector = /(?:copy|label|meta|note|description|title|index|kicker|guide|summary|time|reason|muted|state|link|value)/i;
  const allowedState = /(?::active|::before|::after|\[disabled\]|\[loading\]|\.disabled\b|\.loading\b|\.button-hover\b|\.skeleton\b|\.shimmer\b)/i;
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].trim();
    if (!textSelector.test(selectors) || allowedState.test(selectors)) continue;
    const opacity = match[2].match(/(?:^|;)\s*opacity\s*:\s*(0?(?:\.\d+)?|1(?:\.0+)?)\s*(?:;|$)/);
    if (opacity && Number(opacity[1]) < 1) {
      fail(`${relativePath} dims static text via opacity in selector ${selectors}; use a validated solid foreground token`);
    }
  }
}

function auditComponentSelectors(relativePath, source) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of withoutComments.matchAll(/([^{}]+)\{/g)) {
    const selectorBlock = match[1].trim();
    if (!selectorBlock || selectorBlock.startsWith("@")) continue;
    for (const rawSelector of selectorBlock.split(",")) {
      const selector = rawSelector.trim();
      if (!selector || /^(?:from|to|\d+(?:\.\d+)?%)$/.test(selector)) continue;
      const hasId = /#[A-Za-z_][\w-]*/.test(selector);
      const hasAttribute = /\[[^\]]+\]/.test(selector);
      const hasTagOrUniversal = /(?:^|[\s>+~])(?:[A-Za-z][\w-]*|\*)(?=[.#:\[\s>+~]|$)/.test(selector);
      if (hasId || hasAttribute || hasTagOrUniversal) {
        fail(`${relativePath} uses a forbidden component WXSS tag, ID, or attribute selector: ${selector}`);
      }
    }
  }
}

function auditStyle(relativePath, source, { allowPortalColors = false, pageStyle = false } = {}) {
  if ((source.match(/\{/g) || []).length !== (source.match(/\}/g) || []).length) {
    fail(`${relativePath} has unbalanced rule braces`);
  }
  if (/\{\s*\}/.test(source)) fail(`${relativePath} has an empty rule`);
  if (/(?:linear|radial)-gradient/i.test(source)) fail(`${relativePath} contains a prohibited decorative gradient`);
  if (pageStyle && /box-shadow\s*:(?!\s*none)/i.test(source)) {
    fail(`${relativePath} must use shared elevation primitives instead of page-local shadows`);
  }
  if (/z-index\s*:\s*-/i.test(source)) {
    fail(`${relativePath} uses a negative z-index that can break interactive card hit testing`);
  }
  const rawColors = [...source.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((match) => match[0].toLowerCase());
  const functionalColors = [...source.matchAll(/\b(?:rgba?|hsla?)\([^)]*\)/gi)]
    .map((match) => match[0].toLowerCase().replace(/\s+/g, ""));
  if (allowPortalColors) {
    for (const color of rawColors) {
      if (!allowedPortalColors.has(color)) fail(`${relativePath} contains an off-system portal color: ${color}`);
    }
    for (const color of functionalColors) {
      if (!allowedPortalFunctionalColors.has(color)) fail(`${relativePath} contains an uncontrolled portal functional color: ${color}`);
    }
  } else if (rawColors.length) {
    fail(`${relativePath} contains raw colors instead of semantic tokens`);
  } else if (functionalColors.length) {
    fail(`${relativePath} contains raw functional colors instead of semantic tokens`);
  }
  auditMotion(relativePath, source);
  auditStaticTextOpacity(relativePath, source);
}

function escapePattern(value) {
  return value.replace(/[.*+?^(){}|[\]\\$]/g, "\\$&");
}

function isLoopAnimationBounded(tag) {
  const indexName = tag.match(/wx:for-index="([^"]+)"/)?.[1] || "index";
  const escaped = escapePattern(indexName);
  return new RegExp(`\\b${escaped}\\s*<\\s*3\\b|\\b${escaped}\\s*<=\\s*2\\b`).test(tag);
}

function pageClassAnimates(styles, className) {
  const escaped = escapePattern(className);
  const classPattern = new RegExp(`\\.${escaped}(?![\\w-])`);
  for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!classPattern.test(match[1])) continue;
    for (const animation of match[2].matchAll(/animation\s*:\s*([^;{}]+)/gi)) {
      if (!/^none(?:\s*!important)?$/i.test(animation[1].trim())) return true;
    }
  }
  return false;
}

function auditBoundedListMotion(page, template, styles) {
  for (const match of template.matchAll(/<[\w-]+\b[^>]*\bwx:for="[^"]+"[^>]*>/gs)) {
    const tag = match[0];
    const utilityMotion = /\b(?:tt-animate-in|tt-enter-[\w-]+|tt-state-transition)\b/.test(tag);
    const componentMotion = /motion-level="m[234]"/.test(tag) && !/entrance="none"/.test(tag);
    const classValue = tag.match(/class="([^"]*)"/)?.[1] || "";
    const literalClasses = classValue
      .replace(/\{\{[^}]*\}\}/g, " ")
      .split(/\s+/)
      .filter((value) => /^[a-zA-Z_][\w-]*$/.test(value));
    const localMotion = literalClasses.some((className) => pageClassAnimates(styles, className));
    if ((utilityMotion || componentMotion || localMotion) && !isLoopAnimationBounded(tag)) {
      fail(`${page}.wxml animates an unbounded wx:for; gate the animated class/component with its loop index < 3 and render later items static`);
    }
  }
}

function activeBinding(tag) {
  return tag.match(/\bactive="\{\{\s*([^}]+?)\s*\}\}"/)?.[1]?.trim() || null;
}

function auditM4Concurrency(page, template) {
  const m4Tags = [...template.matchAll(/<[\w-]+\b[^>]*motion-level="m4"[^>]*>/gs)].map((match) => match[0]);
  if (m4Tags.length > 1) {
    fail(`${page}.wxml mounts more than one M4 surface; only one M4 stage may run on a page`);
  }
  const stageTag = m4Tags.find((tag) => /^<tt-card-stage\b/.test(tag));
  if (!stageTag) return;
  const stageBinding = activeBinding(stageTag);
  for (const match of template.matchAll(/<tt-cartoon-prop\b[^>]*>/gs)) {
    const propTag = match[0];
    if (/motion="none"/.test(propTag) || !/motion="(?:peek|nod|breathe)"/.test(propTag)) continue;
    const propBinding = activeBinding(propTag);
    const literalActive = /\bactive(?:\s|>|=)/.test(propTag) && !propBinding;
    if (literalActive || (stageBinding && propBinding === stageBinding)) {
      fail(`${page}.wxml starts an animated prop with its M4 stage; delay the prop until the three-card stage has settled`);
    }
  }
}

function auditComponentKeyboard(name, template, styles) {
  for (const match of template.matchAll(/<view\b(?=[^>]*\bbindtap=)[^>]*>/gs)) {
    const tag = match[0];
    if (/class="[^"]*\b(?:sheet-mask|filter-mask)\b/.test(tag)) continue;
    if (!/\btabindex=/.test(tag)) {
      fail(`component ${name} has a bindtap view without a keyboard tabindex contract`);
    }
    if (!/\baria-role=/.test(tag)) {
      fail(`component ${name} has a bindtap view without an aria-role`);
    }
    const classValue = tag.match(/class="([^"]*)"/)?.[1] || "";
    const focusClass = classValue
      .replace(/\{\{[^}]*\}\}/g, " ")
      .split(/\s+/)
      .find((value) => /^[a-zA-Z_][\w-]*$/.test(value));
    if (focusClass && !new RegExp(`\\.${escapePattern(focusClass)}:focus\\s*\\{`).test(styles)) {
      fail(`component ${name} bindtap view .${focusClass} has no visible :focus rule`);
    }
  }
}

function verifyAuditRejectsNegativeFixture() {
  const baseline = failures.length;
  auditStyle(
    "__ui4_negative_fixture__.wxss",
    ".probe { color: #ff00ff; transition: all 1s; animation: probe 1s infinite; } .probe-label { opacity: .82; }",
    {}
  );
  auditComponentSelectors(
    "__ui4_negative_component_fixture__.wxss",
    ".probe button, #probe, .probe[disabled] { transform: none; }"
  );
  const probeFailures = failures.splice(baseline);
  for (const expected of ["raw colors", "transition: all", "infinite animation", "dims static text via opacity", "forbidden component WXSS"]) {
    if (!probeFailures.some((message) => message.includes(expected))) {
      fail(`UI audit self-test failed to detect ${expected}`);
    }
  }
}

verifyAuditRejectsNegativeFixture();

if (app.darkmode !== true || app.themeLocation !== "theme.json") fail("app.json must enable darkmode with theme.json");
if (!theme.light || !theme.dark) fail("theme.json must declare light and dark themes");
if (app.pages.length !== 31) fail(`expected 31 registered pages, found ${app.pages.length}`);
if (Object.keys(app.usingComponents || {}).length < 18) fail("UI 4.0 shared component registry is incomplete");
for (const component of requiredUi4Components) {
  if (!app.usingComponents?.[component]) fail(`UI 4.0 component is not globally registered: ${component}`);
}
if (!existsSync(resolve(root, "UI4_DESIGN_SYSTEM.md"))) fail("UI4_DESIGN_SYSTEM.md is missing");

for (const [name, componentPath] of Object.entries(app.usingComponents || {})) {
  const componentRelative = String(componentPath).replace(/^\//, "");
  const base = resolve(root, componentRelative);
  for (const extension of ["json", "ts", "wxml", "wxss"]) {
    if (!existsSync(`${base}.${extension}`)) fail(`component ${name} is missing ${extension}`);
  }
  const stylesPath = `${base}.wxss`;
  const componentTemplate = existsSync(`${base}.wxml`) ? readFileSync(`${base}.wxml`, "utf8") : "";
  const componentStyles = existsSync(stylesPath) ? readFileSync(stylesPath, "utf8") : "";
  if (existsSync(stylesPath)) {
    auditStyle(
      `${componentRelative}.wxss`,
      componentStyles,
      { allowPortalColors: portalComponents.has(name) }
    );
    auditComponentSelectors(`${componentRelative}.wxss`, componentStyles);
  }
  auditComponentKeyboard(name, componentTemplate, componentStyles);
  if (motionCapableComponents.has(name)) {
    const componentSource = existsSync(`${base}.ts`) ? readFileSync(`${base}.ts`, "utf8") : "";
    if (!/motionOff:\s*\{[^}]*value:\s*false/.test(componentSource)) {
      fail(`component ${name} must expose a motionOff property defaulting to false`);
    }
    if (!/motionOff\s*\?\s*['"]motion-off['"]|motion-off="\{\{motionOff\}\}"/.test(componentTemplate)) {
      fail(`component ${name} must bind motionOff to its internal final-state contract`);
    }
  }
}

let interactiveTabViewCount = 0;
for (const page of app.pages) {
  const wxss = resolve(root, `${page}.wxss`);
  const wxml = resolve(root, `${page}.wxml`);
  const json = resolve(root, `${page}.json`);
  const ts = resolve(root, `${page}.ts`);
  for (const file of [wxss, wxml, json]) if (!existsSync(file)) fail(`registered page asset missing: ${file}`);
  const styles = existsSync(wxss) ? readFileSync(wxss, "utf8") : "";
  const template = existsSync(wxml) ? readFileSync(wxml, "utf8") : "";
  const source = existsSync(ts) ? readFileSync(ts, "utf8") : "";
  if (styles && !foundationOnly) auditStyle(`${page}.wxss`, styles, { pageStyle: true });
  if (!foundationOnly && /Restrained redesign/i.test(styles)) fail(`${page}.wxss still contains a legacy tail override layer`);
  if (!foundationOnly) {
    auditBoundedListMotion(page, template, styles);
    auditM4Concurrency(page, template);
    if (!/\bmotionOff\s*:\s*false\b/.test(source)) {
      fail(`${page}.ts must initialize motionOff: false in page data`);
    }
    if (!/<(?:view|web-view)\b[^>]*class="[^"]*\{\{\s*motionOff\s*\?\s*['"]tt-motion-off['"]\s*:\s*['"]{2}\s*\}\}[^"]*"/.test(template)) {
      fail(`${page}.wxml must bind motionOff to tt-motion-off on its page content root`);
    }
    for (const match of template.matchAll(/<tt-(?:card-shell|card-grid|section-heading|scene-card|fact-card|card-stage|cartoon-prop|media-card|state|skeleton|action-bar|sheet|filter-sheet)\b[^>]*>/gs)) {
      if (!/motion-off="\{\{motionOff\}\}"/.test(match[0])) {
        fail(`${page}.wxml must pass motion-off="{{motionOff}}" to every motion-capable shared component`);
      }
    }
  }
  interactiveTabViewCount += (
    template.match(/<view\b(?=[^>]*\btabindex="0")(?=[^>]*\baria-role="(?:button|radio|checkbox|tab)")[^>]*>/gs)
    || []
  ).length;
  if (/&amp;/i.test(template)) fail(`${page}.wxml contains an HTML entity that renders literally in DevTools`);
  for (const match of template.matchAll(/color="(#[0-9a-fA-F]{6})"/g)) {
    if (match[1].toUpperCase() !== "#292724") fail(`${page}.wxml uses an off-system native control color: ${match[1]}`);
  }
}

const appStyles = readFileSync(resolve(root, "app.wxss"), "utf8");
auditMotion("app.wxss", appStyles);
for (const token of [
  "--tt-color-pastel-blue-bg",
  "--tt-color-pastel-apricot-bg",
  "--tt-color-pastel-mint-bg",
  "--tt-color-pastel-lavender-bg",
  "--tt-color-pastel-butter-bg",
  "--tt-color-pastel-rose-bg",
  "--tt-shadow-card-low",
  "--tt-shadow-card-mid",
  "--tt-shadow-card-high",
  "--tt-overlay-scrim",
  "--tt-overlay-scrim-strong",
  "--tt-color-action-tint",
  "--tt-motion-instant",
  "--tt-motion-press",
  "--tt-motion-standard",
  "--tt-motion-emphasis",
  "--tt-motion-hero",
  "--tt-motion-stagger",
  "--tt-ease-standard",
  "--tt-ease-emphasis",
  "--tt-ease-playful"
]) {
  if (!appStyles.includes(token)) fail(`app.wxss is missing UI 4.0 token ${token}`);
}
if (!/\.tt-motion-off/.test(appStyles) || !/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(appStyles)) {
  fail("app.wxss must expose motion-off and reduced-motion final-state contracts");
}
if (
  interactiveTabViewCount > 0
  && !/\[tabindex="0"\]:focus\s*\{[^}]*outline:\s*3rpx\s+solid\s+var\(--tt-color-focus-ring\)/.test(appStyles)
) {
  fail(`app.wxss must visibly focus the ${interactiveTabViewCount} interactive page view surfaces using the shared focus ring`);
}

const cardShellSource = readFileSync(resolve(root, "components/tt-card-shell/index.ts"), "utf8");
const cardShellTemplate = readFileSync(resolve(root, "components/tt-card-shell/index.wxml"), "utf8");
const cardShellStyles = readFileSync(resolve(root, "components/tt-card-shell/index.wxss"), "utf8");
if (!/motionLevel:\s*\{[^}]*value:\s*"m1"/.test(cardShellSource) || !/risk:\s*\{[^}]*value:\s*"high"/.test(cardShellSource)) {
  fail("tt-card-shell must default to stable M1/high-risk behavior");
}
if ((cardShellTemplate.match(/card-depth-plane/g) || []).length < 2 || !/card-surface/.test(cardShellTemplate)) {
  fail("tt-card-shell must render two non-interactive depth planes plus one surface");
}
if (!/\.card-depth-plane\s*\{[^}]*pointer-events:\s*none/.test(cardShellStyles)) {
  fail("tt-card-shell depth planes must not intercept card taps");
}
if (!/\.card-shell:focus\s*\{[^}]*--tt-color-focus-ring/.test(cardShellStyles)) {
  fail("tt-card-shell must expose a visible shared-token focus ring");
}

const stageSource = readFileSync(resolve(root, "components/tt-card-stage/index.ts"), "utf8");
const stageTemplate = readFileSync(resolve(root, "components/tt-card-stage/index.wxml"), "utf8");
const stageStyles = readFileSync(resolve(root, "components/tt-card-stage/index.wxss"), "utf8");
for (const slot of ["back", "middle", "front"]) {
  if (!stageTemplate.includes(`slot name="${slot}"`)) fail(`tt-card-stage is missing the ${slot} slot`);
}
if (!/active:\s*\{[^}]*value:\s*false/.test(stageSource) || !/risk:\s*\{[^}]*value:\s*"high"/.test(stageSource)) {
  fail("tt-card-stage must be static and high-risk-safe by default");
}
if (!/\.stage-layer\s*\{[^}]*pointer-events:\s*none/.test(stageStyles) || !/\.stage-hit\s*\{[^}]*pointer-events:\s*auto/.test(stageStyles)) {
  fail("tt-card-stage must keep exposed back/middle/front cards hit-testable");
}

const propSource = readFileSync(resolve(root, "components/tt-cartoon-prop/index.ts"), "utf8");
const propTemplate = readFileSync(resolve(root, "components/tt-cartoon-prop/index.wxml"), "utf8");
for (const expectation of [
  /motion:\s*\{[^}]*value:\s*"none"/,
  /risk:\s*\{[^}]*value:\s*"high"/,
  /expressive:\s*\{[^}]*value:\s*false/,
  /decorative:\s*\{[^}]*value:\s*true/
]) {
  if (!expectation.test(propSource)) fail("tt-cartoon-prop safe defaults are incomplete");
}
if (!/aria-hidden="\{\{decorative\}\}"/.test(propTemplate)) {
  fail("tt-cartoon-prop must expose its decorative accessibility contract");
}

const mediaStyles = readFileSync(resolve(root, "components/tt-media-card/index.wxss"), "utf8");
if (!/\.media-frame:focus\s*\{[^}]*--tt-color-focus-ring/.test(mediaStyles)) {
  fail("tt-media-card must expose a visible shared-token focus ring");
}

const stateSource = readFileSync(resolve(root, "components/tt-state/index.ts"), "utf8");
if (!/motionLevel:\s*\{[^}]*value:\s*"m0"/.test(stateSource)) {
  fail("tt-state must default to M0 for fail-closed and high-risk states");
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
  if (!existsSync(file)) fail(`UI 3.0 baseline asset missing: ${file}`);
  else if (statSync(file).size > (file.includes("home-hero") ? 300 : 160) * 1024) fail(`asset budget exceeded: ${file}`);
}

if (!foundationOnly) {
  const chatSource = readFileSync(resolve(root, "pages/chat/index.ts"), "utf8");
  if (!/PAYMENT_REQUIRED[\s\S]*当前没有可用的已支付订单/.test(chatSource)) {
    fail("chat must localize the expired paid-order access error");
  }
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
if (!foundationOnly && !/class="(?=[^"]*\bdiscover-root\b)[^"]*"[\s\S]*class="(?=[^"]*\bpage\b)(?=[^"]*\bdiscover-page\b)[^"]*"[\s\S]*wx:if="\{\{filterSheetOpen\}\}" class="(?=[^"]*\bfilter-root\b)[^"]*"/.test(discoverTemplate)) {
  fail("discover must keep the fixed filter dialog as a sibling of its scrollable page inside one WXML root");
}
if (!foundationOnly && (/<tt-filter-sheet[\s>]/.test(discoverTemplate) || /<root-portal[\s\S]*filterSheetOpen/.test(discoverTemplate))) {
  fail("discover must not route slotted filter chips through root-portal style isolation");
}

if (failures.length) {
  process.stderr.write(failures.map((item) => `ERROR: ${item}`).join("\n") + "\n");
  process.exit(1);
}
process.stdout.write(
  foundationOnly
    ? `UI 4.0 foundation-only audit passed: ${Object.keys(app.usingComponents).length} components, safe depth/motion/cartoon contracts, light/dark themes; page-style migration not asserted\n`
    : `UI 4.0 full UI audit passed: ${app.pages.length} registered pages, ${Object.keys(app.usingComponents).length} components, safe depth/motion/cartoon contracts, light/dark themes\n`
);
