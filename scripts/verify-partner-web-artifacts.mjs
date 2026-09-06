import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const settings = JSON.parse(await readFile(resolve(repo, "frontend/web/.env.partner-site-payload.json"), "utf8"));
const accessFile = await readFile(resolve(repo, "backend/api/.env.partner-access"), "utf8");
const accessCode = accessFile.split("PARTNER_ACCESS_CODE=")[1]?.trim();
const secrets = [settings.WEB_GATEWAY_SECRET, accessCode].filter(Boolean);
let checked = 0;
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await scan(path);
    else if (entry.isFile()) {
      const value = await readFile(path);
      checked++;
      if (secrets.some((secret) => value.includes(Buffer.from(secret)))) throw new Error(`Secret embedded in browser artifact: ${path}`);
    }
  }
}
await scan(resolve(repo, "frontend/web/dist/client"));
process.stdout.write(JSON.stringify({ browserFilesChecked: checked, serverSecretsExposed: false, partnerCodeExposed: false }) + "\n");
