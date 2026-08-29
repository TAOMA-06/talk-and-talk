import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const app = JSON.parse(readFileSync(resolve(root, "app.json"), "utf8"));
const handRebuilt = new Set([
  "pages/consent/index",
  "pages/home/index",
  "pages/discover/index",
  "pages/orders/index",
  "pages/messages/index",
  "pages/profile/index",
  "pages/companion/detail",
  "pages/companion/workbench/index"
]);

let merged = 0;
for (const page of app.pages) {
  if (handRebuilt.has(page)) continue;
  const file = resolve(root, `${page}.wxss`);
  if (!existsSync(file)) continue;
  const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const order = [];
  const rules = new Map();
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim().replace(/\s+/g, " ");
    if (!selector || selector.startsWith("@")) continue;
    if (!rules.has(selector)) {
      order.push(selector);
      rules.set(selector, new Map());
    }
    const declarations = rules.get(selector);
    for (const declaration of match[2].split(";")) {
      const index = declaration.indexOf(":");
      if (index < 1) continue;
      const property = declaration.slice(0, index).trim();
      const value = declaration.slice(index + 1).trim();
      if (property && value) declarations.set(property, value);
    }
  }
  const next = order.map((selector) => {
    const body = [...rules.get(selector)].map(([property, value]) => `  ${property}: ${value};`).join("\n");
    return `${selector} {\n${body}\n}`;
  }).join("\n\n") + "\n";
  writeFileSync(file, next);
  merged += 1;
}

process.stdout.write(`UI 2.0 merged ${merged} registered page styles\n`);
