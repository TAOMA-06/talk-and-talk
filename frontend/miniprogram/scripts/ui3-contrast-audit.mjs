import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const theme = JSON.parse(readFileSync(resolve(root, "theme.json"), "utf8"));

function rgb(hex) {
  const value = hex.replace(/^#/, "");
  assert.equal(value.length, 6, "contrast audit requires six-digit hex colors");
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
}

function channel(value) {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(value) {
  const channels = Array.isArray(value) ? value : rgb(value);
  return 0.2126 * channel(channels[0]) + 0.7152 * channel(channels[1]) + 0.0722 * channel(channels[2]);
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function composite(foreground, background, alpha) {
  const fg = rgb(foreground);
  const bg = rgb(background);
  return fg.map((value, index) => value * alpha + bg[index] * (1 - alpha));
}

function selectorOpacity(relativePath, selector) {
  const source = readFileSync(resolve(root, relativePath), "utf8");
  let opacity = 1;
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(",").map((value) => value.trim());
    if (!selectors.includes(selector)) continue;
    const declaration = match[2].match(/(?:^|;)\s*opacity\s*:\s*(0?(?:\.\d+)?|1(?:\.0+)?)\s*(?:;|$)/);
    if (declaration) opacity = Math.min(opacity, Number(declaration[1]));
  }
  return opacity;
}

const checks = [
  ["powder blue", "#314F67", "#DDE8F2", 4.5],
  ["soft apricot", "#6B4237", "#F1DED5", 4.5],
  ["mist mint", "#315447", "#DDECE3", 4.5],
  ["soft lavender", "#574668", "#E9E1F0", 4.5],
  ["butter cream", "#67551F", "#F3EACD", 4.5],
  ["dusty rose", "#68424F", "#F0DFE5", 4.5],
  ["success", "#2F5C44", "#E2EFE7", 4.5],
  ["info", "#31556B", "#E1EBF2", 4.5],
  ["warning", "#705821", "#F4ECD6", 4.5],
  ["danger", "#7A393D", "#F3E2E2", 4.5],
  ["unknown", "#57524C", "#ECE9E4", 4.5],
  ["ink action", "#FFFFFF", "#292724", 4.5],
  ["control border", "#979189", "#FFFFFF", 3],
  ["dark primary", "#F3F1ED", "#1B1C1A", 4.5],
  ["dark secondary", "#B9B4AC", "#1B1C1A", 4.5],
  ["dark tertiary", "#9A958D", "#1B1C1A", 4.5],
  ["dark powder blue", "#CADCEE", "#242F3A", 4.5],
  ["dark soft apricot", "#F0D1C5", "#372A26", 4.5],
  ["dark mist mint", "#C9E4D4", "#24332B", 4.5],
  ["dark soft lavender", "#E2D3EE", "#302A38", 4.5],
  ["dark butter cream", "#E9DCAB", "#34301F", 4.5],
  ["dark dusty rose", "#ECCDD6", "#35292D", 4.5],
  ["dark success", "#9ED0B8", "#1D3028", 4.5],
  ["dark info", "#B4D2E1", "#1F3038", 4.5],
  ["dark warning", "#E3C98F", "#342B1D", 4.5],
  ["dark danger", "#F3B6BA", "#3A2225", 4.5],
  ["dark unknown", "#C8C3BC", "#2A2927", 4.5],
  ["dark action", "#151618", "#F3F1ED", 4.5],
  ["dark control border", "#6B6F67", "#1B1C1A", 3],
  ["tab light idle", theme.light.tabBarColor, theme.light.tabBarBackgroundColor, 4.5],
  ["tab light selected", theme.light.tabBarSelectedColor, theme.light.tabBarBackgroundColor, 4.5],
  ["tab dark idle", theme.dark.tabBarColor, theme.dark.tabBarBackgroundColor, 4.5],
  ["tab dark selected", theme.dark.tabBarSelectedColor, theme.dark.tabBarBackgroundColor, 4.5],
  ["portal local focus light", "#232220", "#FFFEFC", 3],
  ["portal local focus dark", "#F3F1ED", "#1B1C1A", 3]
];

const lightFocusBackgrounds = [
  ["canvas", "#F6F4F1"],
  ["surface", "#FFFEFC"],
  ["blue", "#DDE8F2"],
  ["apricot", "#F1DED5"],
  ["mint", "#DDECE3"],
  ["lavender", "#E9E1F0"],
  ["butter", "#F3EACD"],
  ["rose", "#F0DFE5"],
  ["success", "#E2EFE7"],
  ["info", "#E1EBF2"],
  ["warning", "#F4ECD6"],
  ["danger", "#F3E2E2"],
  ["unknown", "#ECE9E4"]
];
for (const [name, background] of lightFocusBackgrounds) {
  checks.push(["focus light on " + name, "#315C73", background, 3]);
}

const darkFocusBackgrounds = [
  ["canvas", "#121312"],
  ["surface", "#1B1C1A"],
  ["surface alt", "#232521"],
  ["blue", "#242F3A"],
  ["apricot", "#372A26"],
  ["mint", "#24332B"],
  ["lavender", "#302A38"],
  ["butter", "#34301F"],
  ["rose", "#35292D"],
  ["success", "#1D3028"],
  ["info", "#1F3038"],
  ["warning", "#342B1D"],
  ["danger", "#3A2225"],
  ["unknown", "#2A2927"]
];
for (const [name, background] of darkFocusBackgrounds) {
  checks.push(["focus dark on " + name, "#9FC6DC", background, 3]);
}

const results = checks.map(([name, foreground, background, minimum]) => {
  const ratio = contrast(foreground, background);
  assert.ok(
    ratio >= minimum,
    name + " contrast " + ratio.toFixed(2) + ":1 is below " + minimum + ":1"
  );
  return { name, ratio: Number(ratio.toFixed(2)), minimum };
});

const pastelPairs = [
  ["blue", "#314F67", "#DDE8F2"],
  ["apricot", "#6B4237", "#F1DED5"],
  ["mint", "#315447", "#DDECE3"],
  ["lavender", "#574668", "#E9E1F0"],
  ["butter", "#67551F", "#F3EACD"],
  ["rose", "#68424F", "#F0DFE5"]
];
const selectorSpecs = [
  {
    file: "components/tt-fact-card/index.wxss",
    selector: ".fact-label",
    neutral: ["#232220", "#FFFEFC"]
  },
  {
    file: "components/tt-fact-card/index.wxss",
    selector: ".fact-meta",
    neutral: ["#232220", "#FFFEFC"]
  },
  {
    file: "components/tt-scene-card/index.wxss",
    selector: ".scene-label",
    neutral: ["#232220", "#FFFEFC"]
  },
  {
    file: "components/tt-media-card/index.wxss",
    selector: ".media-subtitle",
    neutral: ["#5C5954", "#FFFEFC"]
  },
  {
    file: "components/tt-media-card/index.wxss",
    selector: ".media-description",
    neutral: ["#5C5954", "#FFFEFC"]
  },
  {
    file: "components/tt-media-card/index.wxss",
    selector: ".media-meta",
    neutral: ["#706C66", "#FFFEFC"]
  }
];

const selectorChecks = [];
for (const spec of selectorSpecs) {
  const alpha = selectorOpacity(spec.file, spec.selector);
  assert.equal(alpha, 1, spec.file + " " + spec.selector + " must use a solid foreground without opacity");
  const contexts = [["neutral", spec.neutral[0], spec.neutral[1]], ...pastelPairs];
  for (const [tone, foreground, background] of contexts) {
    const ratio = contrast(composite(foreground, background, alpha), background);
    assert.ok(
      ratio >= 4.5,
      spec.selector + " on " + tone + " composites to " + ratio.toFixed(2) + ":1 at alpha " + alpha
    );
    selectorChecks.push({
      selector: spec.selector,
      tone,
      alpha,
      ratio: Number(ratio.toFixed(2)),
      minimum: 4.5
    });
  }
}

process.stdout.write(JSON.stringify({ passed: true, checks: results, selectorChecks }) + "\n");
