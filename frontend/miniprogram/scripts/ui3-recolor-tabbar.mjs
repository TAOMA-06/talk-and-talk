import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const sharp = require("../../web/node_modules/sharp");
const root = resolve(import.meta.dirname, "..");
const selected = ["home", "discover", "orders", "messages", "profile"];

async function recolor(path, hex) {
  const target = Buffer.from(hex.replace(/^#/, ""), "hex");
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let offset = 0; offset < data.length; offset += info.channels) {
    if (data[offset + 3] === 0) continue;
    data[offset] = target[0];
    data[offset + 1] = target[1];
    data[offset + 2] = target[2];
  }
  await writeFile(path, await sharp(data, { raw: info }).png().toBuffer());
}

for (const name of selected) {
  await recolor(resolve(root, `assets/tabbar/${name}-light-on.png`), "#292724");
  await recolor(resolve(root, `assets/tabbar/${name}-dark-on.png`), "#F3F1ED");
}

process.stdout.write("Recolored 10 selected TabBar icons for UI 3.0\n");
