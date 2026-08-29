import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const app = JSON.parse(readFileSync(resolve(root, "app.json"), "utf8"));
const alreadyRebuilt = new Set([
  "pages/consent/index",
  "pages/home/index",
  "pages/discover/index",
  "pages/orders/index",
  "pages/messages/index",
  "pages/profile/index"
]);

const exact = new Map(Object.entries({
  "#f7f7f5": "var(--tt-bg)",
  "#202124": "var(--tt-text)",
  "#646970": "var(--tt-text-secondary)",
  "#8a9098": "var(--tt-text-tertiary)",
  "#e4e6e8": "var(--tt-border)",
  "#d8b7c1": "var(--tt-border-strong)",
  "#9b405b": "var(--tt-accent)",
  "#b94a68": "var(--tt-accent)",
  "#a43f5c": "var(--tt-accent)",
  "#7f3248": "var(--tt-accent-pressed)",
  "#f6ecef": "var(--tt-accent-soft)",
  "#f1f2f3": "var(--tt-surface-alt)",
  "#2f6b55": "var(--tt-success)",
  "#edf6f1": "var(--tt-success-soft)",
  "#8a6426": "var(--tt-warning)",
  "#faf4e8": "var(--tt-warning-soft)",
  "#a33d45": "var(--tt-danger)",
  "#faeeee": "var(--tt-danger-soft)",
  "#3f647a": "var(--tt-info)",
  "#eef3f6": "var(--tt-info-soft)"
}));

function rgb(hex) {
  const raw = hex.slice(1);
  const full = raw.length === 3 ? [...raw].map((value) => value + value).join("") : raw.slice(0, 6);
  return [0, 2, 4].map((index) => Number.parseInt(full.slice(index, index + 2), 16) / 255);
}

function hsl(hex) {
  const [r, g, b] = rgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return { hue: 0, saturation: 0, lightness };
  const delta = max - min;
  const saturation = lightness > .5 ? delta / (2 - max - min) : delta / (max + min);
  const hue = max === r
    ? ((g - b) / delta + (g < b ? 6 : 0)) * 60
    : max === g
      ? ((b - r) / delta + 2) * 60
      : ((r - g) / delta + 4) * 60;
  return { hue, saturation, lightness };
}

function tokenFor(value, line) {
  const normalized = value.toLowerCase();
  const property = line.trim().split(":", 1)[0];
  if ((normalized === "#fff" || normalized === "#ffffff") && property === "color") return "var(--tt-on-accent)";
  if (normalized === "#fff" || normalized === "#ffffff") return "var(--tt-surface)";
  if (exact.has(normalized)) return exact.get(normalized);
  const { hue, saturation, lightness } = hsl(normalized);
  if (property.includes("border") && lightness > .55) return lightness > .82 ? "var(--tt-border)" : "var(--tt-border-strong)";
  if (saturation < .14) {
    if (lightness > .9) return "var(--tt-surface)";
    if (lightness > .72) return "var(--tt-border)";
    if (lightness > .42) return "var(--tt-text-secondary)";
    return "var(--tt-text)";
  }
  const soft = lightness > .78;
  if (hue < 18 || hue >= 345) return soft ? "var(--tt-danger-soft)" : "var(--tt-danger)";
  if (hue < 55) return soft ? "var(--tt-warning-soft)" : "var(--tt-warning)";
  if (hue < 170) return soft ? "var(--tt-success-soft)" : "var(--tt-success)";
  if (hue < 250) return soft ? "var(--tt-info-soft)" : "var(--tt-info)";
  return soft ? "var(--tt-accent-soft)" : "var(--tt-accent)";
}

let changed = 0;
for (const page of app.pages) {
  if (alreadyRebuilt.has(page)) continue;
  const file = resolve(root, `${page}.wxss`);
  if (!existsSync(file)) continue;
  let source = readFileSync(file, "utf8");
  source = source.replace(/(?:-webkit-)?box-shadow\s*:[^;]+;/gi, "box-shadow: none;");
  source = source.replace(/background(?:-image)?\s*:\s*(?:linear|radial)-gradient\([^;]+;/gi, "background: var(--tt-surface-alt);");
  const lines = source.split("\n").map((line) => line.replace(/#[0-9a-fA-F]{3,8}\b/g, (value) => tokenFor(value, line)));
  const next = `${lines.join("\n").trimEnd()}\n`;
  writeFileSync(file, next);
  changed += 1;
}

process.stdout.write(`UI 2.0 tokenized ${changed} registered page styles\n`);
