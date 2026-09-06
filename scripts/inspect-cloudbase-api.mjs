import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webPreview = process.argv.includes("--web-preview");
const envFile = resolve(repo, webPreview ? "backend/api/.env.cloudbase.partner" : "backend/api/.env.cloudbase.staging");
const cli = process.env.CLOUDBASE_CLI
  || "/private/tmp/talktalk-cloudbase-cli/node_modules/.bin/tcb";
const envId = "talk-and-talk-staging-d6d04a14b8";
const serviceName = webPreview ? "talk-and-talk-web-api" : "talk-and-talk-api";

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return [];
    const separator = line.indexOf("=");
    if (separator <= 0) return [];
    return [[line.slice(0, separator), line.slice(separator + 1)]];
  }));
}

const localValues = parseEnv(await readFile(envFile, "utf8"));
const result = spawnSync(cli, [
  "cloudrun", "detail",
  "-e", envId,
  "-s", serviceName,
  "--json"
], {
  cwd: repo,
  encoding: "utf8",
  env: process.env
});
if (result.status !== 0) {
  process.stderr.write("Unable to read CloudBase service detail\n");
  process.exit(result.status ?? 1);
}

const output = String(result.stdout || "").replace(/\u001b\[[0-9;]*m/g, "");
const start = output.indexOf("{");
if (start < 0) throw new Error("CloudBase CLI did not return JSON");
const response = JSON.parse(output.slice(start));
const detail = response.data || response;
const config = detail.ServerConfig || {};
const remoteValues = JSON.parse(config.EnvParams || "{}");
const localKeys = Object.keys(localValues).sort();
const remoteKeys = Object.keys(remoteValues).sort();
const envKeysMatch = JSON.stringify(localKeys) === JSON.stringify(remoteKeys)
  && localKeys.every((key) => localValues[key] === remoteValues[key]);

process.stdout.write(`${JSON.stringify({
  envId,
  serviceName,
  defaultDomain: detail.BaseInfo?.DefaultDomainName,
  status: detail.BaseInfo?.Status ?? null,
  accessTypes: detail.BaseInfo?.AccessTypes ?? [],
  onlineVersions: (detail.OnlineVersionInfos || []).map((item) => ({
    versionName: item.VersionName,
    flowRatio: item.FlowRatio
  })),
  config: {
    cpu: config.Cpu,
    memoryGiB: config.Mem,
    minInstances: config.MinNum,
    maxInstances: config.MaxNum,
    openAccessTypes: config.OpenAccessTypes,
    publicNetStatus: config.PublicNetConf?.PublicNetStatus ?? null,
    vpcConfigured: Boolean(config.VpcConf?.VpcId && config.VpcConf?.SubnetId),
    environmentKeyCount: remoteKeys.length,
    environmentMatchesLocal: envKeysMatch,
    databaseConnectionConfigured: ["PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD"]
      .every((key) => Boolean(remoteValues[key])),
    seedOnStartup: remoteValues.SEED_ON_STARTUP === "true",
    gatewayProtected: Boolean(remoteValues.WEB_GATEWAY_SECRET?.length >= 32),
    wechatHeaderAuth: remoteValues.WECHAT_CLOUDBASE_HEADER_AUTH_ENABLED === "true"
  }
})}\n`);
