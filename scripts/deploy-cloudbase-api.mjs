import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiRoot = resolve(repo, "backend/api");
const webPreview = process.argv.includes("--web-preview");
const envFile = resolve(apiRoot, webPreview ? ".env.cloudbase.partner" : ".env.cloudbase.staging");
const cli = process.env.CLOUDBASE_CLI
  || "/private/tmp/talktalk-cloudbase-cli/node_modules/.bin/tcb";
const mode = process.argv[2];
const envId = "talk-and-talk-staging-d6d04a14b8";
const serviceName = webPreview ? "talk-and-talk-web-api" : "talk-and-talk-api";
const vpc = {
  VpcId: "vpc-lks7f36s",
  VpcCIDR: "172.17.0.0/16",
  SubnetId: "subnet-jha2s7j1",
  SubnetCIDR: "172.17.0.0/20"
};

if (!new Set(["initial", "update", "retry-image", "lock-miniapp"]).has(mode)) {
  throw new Error("Usage: node scripts/deploy-cloudbase-api.mjs <initial|update|retry-image|lock-miniapp>");
}

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return [];
    const separator = line.indexOf("=");
    if (separator <= 0) return [];
    return [[line.slice(0, separator), line.slice(separator + 1)]];
  }));
}

const values = parseEnv(await readFile(envFile, "utf8"));
if (values.CLOUDBASE_ENV_ID !== envId || (!webPreview && values.CLOUDBASE_MINIAPP_ONLY !== "true")) {
  throw new Error("CloudBase environment file is not bound to the expected Mini Program-only target");
}
if (webPreview && (values.APP_ENV !== "staging" || values.WECHAT_CLOUDBASE_HEADER_AUTH_ENABLED !== "false"
  || values.CLOUDBASE_MINIAPP_ONLY !== "false" || (values.WEB_GATEWAY_SECRET?.length || 0) < 32
  || !/^[a-f0-9]{64}$/.test(values.PARTNER_ACCESS_CODE_SHA256 || ""))) {
  throw new Error("Web preview requires staging, gateway protection, partner authentication, and disabled WeChat header auth");
}
const accessTypes = webPreview ? ["PUBLIC"] : ["MINIAPP"];
const publicNetStatus = webPreview ? "ENABLE" : "DISABLE";
for (const [key, value] of Object.entries(values)) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(key) || value.includes("&") || value.includes("\n")) {
    throw new Error(`Unsupported CloudBase environment value: ${key}`);
  }
}

const serviceItems = [
  { Key: "Port", IntValue: 3000 },
  { Key: "Dockerfile", Value: "Dockerfile" },
  { Key: "BuildDir", Value: "" },
  { Key: "HasDockerfile", BoolValue: true },
  { Key: "AccessTypes", ArrayValue: accessTypes },
  { Key: "PublicNetConf", PublicNetConf: { PublicNetStatus: publicNetStatus } },
  { Key: "VpcConf", VpcConf: vpc },
  { Key: "InternalAccess", Value: "close" },
  { Key: "CpuSpecs", FloatValue: 0.5 },
  { Key: "MemSpecs", FloatValue: 1 },
  { Key: "MinNum", IntValue: 0 },
  { Key: "MaxNum", IntValue: 1 },
  { Key: "PolicyDetails", PolicyDetails: [{ PolicyType: "cpu", PolicyThreshold: 60 }] },
  { Key: "LogPath", Value: "stdout" },
  { Key: "OperationMode", Value: "condScale" },
  { Key: "EnvParam", Value: JSON.stringify(values) }
];

function sanitized(output) {
  let result = String(output || "");
  for (const value of Object.values(values).sort((left, right) => right.length - left.length)) {
    if (value.length >= 16) result = result.split(value).join("[REDACTED]");
  }
  return result;
}

function run(args) {
  const result = spawnSync(cli, args, {
    cwd: repo,
    encoding: "utf8",
    env: process.env
  });
  process.stdout.write(sanitized(result.stdout));
  process.stderr.write(sanitized(result.stderr));
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function callJson(args) {
  const result = spawnSync(cli, args, {
    cwd: repo,
    encoding: "utf8",
    env: process.env
  });
  if (result.status !== 0) {
    process.stderr.write(sanitized(result.stderr || result.stdout));
    process.exit(result.status ?? 1);
  }
  const output = String(result.stdout || "").replace(/\u001b\[[0-9;]*m/g, "");
  const start = output.indexOf("{");
  if (start < 0) throw new Error("CloudBase CLI did not return JSON");
  return JSON.parse(output.slice(start));
}

if (mode === "initial" || mode === "update") {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "talktalk-cloudbase-source-"));
  const archive = resolve(temporaryRoot, "backend-api.zip");
  try {
    const zip = spawnSync("zip", [
      "-X", "-q", "-r", archive, ".",
      "-x", "node_modules/*", "dist/*", "generated/*", ".env", ".env.*",
      "coverage/*", "backups/*", "*.log", "*.pem", "*.key"
    ], { cwd: apiRoot, encoding: "utf8" });
    if (zip.status !== 0) throw new Error(zip.stderr || "Unable to package CloudBase source");

    const uploadRequest = callJson([
      "api", "tcb", "DescribeCloudBaseBuildService",
      "--api-version", "2018-06-08",
      "--body", JSON.stringify({ EnvId: envId, ServiceName: serviceName }),
      "--json"
    ]);
    const upload = uploadRequest.data || uploadRequest;
    if (!upload.UploadUrl || !upload.PackageName || !upload.PackageVersion) {
      throw new Error("CloudBase build service did not return a complete upload target");
    }
    const uploadHeaders = Object.fromEntries(
      (upload.UploadHeaders || []).map((item) => [item.Key, item.Value])
    );
    const response = await fetch(upload.UploadUrl, {
      method: "PUT",
      headers: uploadHeaders,
      body: await readFile(archive)
    });
    if (!response.ok) throw new Error(`CloudBase source upload failed with HTTP ${response.status}`);

    const deployRequest = callJson([
      "api", "tcbr", mode === "initial" ? "CreateCloudRunServer" : "UpdateCloudRunServer",
      "--api-version", "2022-02-17",
      "--body", JSON.stringify({
        EnvId: envId,
        ServerName: serviceName,
        DeployInfo: {
          DeployType: "package",
          PackageName: upload.PackageName,
          PackageVersion: upload.PackageVersion,
          DeployRemark: "TalkAndTalk-v1.0-cloudbase",
          ReleaseType: "FULL"
        },
        Items: serviceItems,
        ...(mode === "initial" ? {
          VpcInfo: {
            VpcId: vpc.VpcId,
            CreateType: 2,
            SubnetIds: [vpc.SubnetId]
          }
        } : {})
      }),
      "--json"
    ]);
    const deployed = deployRequest.data || deployRequest;
    process.stdout.write(`${JSON.stringify({
      mode,
      serviceName,
      envId,
      taskId: deployed.TaskId ?? null,
      requestId: deployed.RequestId ?? null,
      accessTypes,
      publicNetStatus
    })}\n`);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
} else if (mode === "retry-image") {
  const recordRequest = callJson([
    "api", "tcbr", "DescribeCloudRunDeployRecord",
    "--api-version", "2022-02-17",
    "--body", JSON.stringify({ EnvId: envId, ServerName: serviceName }),
    "--json"
  ]);
  const records = (recordRequest.data || recordRequest).DeployRecords || [];
  const imageUrl = [...records].sort((a, b) => Date.parse(b.DeployTime) - Date.parse(a.DeployTime))
    .find((record) => typeof record.ImageUrl === "string" && record.ImageUrl)?.ImageUrl;
  if (!imageUrl) throw new Error("No previously built CloudBase image is available for retry");
  const deployRequest = callJson([
    "api", "tcbr", "UpdateCloudRunServer",
    "--api-version", "2022-02-17",
    "--body", JSON.stringify({
      EnvId: envId,
      ServerName: serviceName,
      DeployInfo: {
        DeployType: "image",
        ImageUrl: imageUrl,
        DeployRemark: "TalkAndTalk-v1.0-cloudbase-retry",
        ReleaseType: "FULL"
      },
      Items: serviceItems
    }),
    "--json"
  ]);
  const deployed = deployRequest.data || deployRequest;
  process.stdout.write(`${JSON.stringify({
    mode,
    serviceName,
    envId,
    taskId: deployed.TaskId ?? null,
    requestId: deployed.RequestId ?? null,
    accessTypes,
    publicNetStatus
  })}\n`);
} else {
  const body = JSON.stringify({
    EnvId: envId,
    ServerName: serviceName,
    Items: serviceItems
  });
  run([
    "api", "tcbr", "SubmitServerConfigChangeDiff",
    "--api-version", "2022-02-17",
    "--body", body,
    "--json"
  ]);
}
