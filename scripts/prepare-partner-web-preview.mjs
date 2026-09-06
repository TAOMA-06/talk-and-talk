import { randomBytes, createHash } from "node:crypto";
import { readFile, writeFile, chmod, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const apiRoot = resolve(repo, "backend/api");
const webRoot = resolve(repo, "frontend/web");
const envPath = resolve(apiRoot, ".env.cloudbase.partner");
const accessPath = resolve(apiRoot, ".env.partner-access");
const origin = "https://talk-and-talk-web-2026.mellow-brook-0610.chatgpt.site";
const backend = "https://talk-and-talk-web-api-308403-7-1428040864.sh.run.tcloudbase.com/api/v1";
const legal = "https://talk-and-talk-staging-d6d04a14b8-1428040864.tcloudbaseapp.com/legal";
const parse = (text) => Object.fromEntries(text.split(/\r?\n/).filter((line) => line && !line.startsWith("#") && line.includes("=")).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
const serialize = (values) => Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n";
const existing = await readFile(envPath, "utf8").then(parse).catch((error) => { if (error.code !== "ENOENT") throw error; return null; });
const values = existing || parse(await readFile(resolve(apiRoot, ".env.cloudbase.staging"), "utf8"));
let accessCode;
if (existing) {
  accessCode = parse(await readFile(accessPath, "utf8")).PARTNER_ACCESS_CODE;
} else {
  accessCode = randomBytes(24).toString("base64url");
  values.WEB_GATEWAY_SECRET = randomBytes(48).toString("base64url");
  values.PARTNER_ACCESS_CODE_SHA256 = createHash("sha256").update(accessCode).digest("hex");
  values.PARTNER_ACCESS_EXPIRES_AT = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
  values.WECHAT_CLOUDBASE_HEADER_AUTH_ENABLED = "false";
  values.WECHAT_MINIPROGRAM_APP_ID = "";
  values.CLOUDBASE_MINIAPP_ONLY = "false";
  values.SEED_ON_STARTUP = "false";
  values.CORS_ORIGINS = origin;
  await writeFile(accessPath, serialize({ PARTNER_ACCESS_CODE: accessCode }), { mode: 0o600 });
}
if (!accessCode || createHash("sha256").update(accessCode).digest("hex") !== values.PARTNER_ACCESS_CODE_SHA256) throw new Error("Partner access code does not match the configured hash");
await writeFile(envPath, serialize(values), { mode: 0o600 });
await chmod(envPath, 0o600);
const webValues = {
  WEB_PARTNER_PREVIEW: "true",
  TALKTALK_API_BASE_URL: backend,
  WEB_GATEWAY_SECRET: values.WEB_GATEWAY_SECRET,
  NEXT_PUBLIC_LEGAL_CONSENT_VERSION: values.LEGAL_CONSENT_VERSION,
  NEXT_PUBLIC_LEGAL_PRIVACY_URL: `${legal}/privacy.html`,
  NEXT_PUBLIC_LEGAL_TERMS_URL: `${legal}/terms.html`,
};
await writeFile(resolve(webRoot, ".env.partner-preview"), serialize(webValues), { mode: 0o600 });
await writeFile(resolve(webRoot, ".env.partner-site-payload.json"), JSON.stringify(webValues), { mode: 0o600 });
const devVarsPath = resolve(webRoot, ".dev.vars");
const devVars = await readFile(devVarsPath, "utf8").then(parse).catch((error) => { if (error.code !== "ENOENT") throw error; return {}; });
await writeFile(devVarsPath, serialize({ ...devVars, ...webValues }), { mode: 0o600 });
await mkdir(resolve(repo, "artifacts/delivery"), { recursive: true });
await writeFile(resolve(repo, "artifacts/delivery/partner-access.md"), [
  "# Talk&Talk 合伙人网页版", "",
  `网页地址：${origin}/login`, "",
  "网站当前访问范围以 Sites 设置为准。私有状态需要先被邀请并登录 ChatGPT；公开状态可直接打开。", "",
  `测试口令：${accessCode}`, "",
  `口令有效期至：${values.PARTNER_ACCESS_EXPIRES_AT}`, "",
  "用户 A、用户 B 与林屿（陪伴者）是三个共享测试账号。在不同设备选择不同账号即可测试预约与双向试聊。",
  "测试内容会保存到腾讯云测试数据库。试聊不收费；微信支付尚未接入。", "",
  "请只将此说明交给获准参加测试的合伙人。", ""
].join("\n"), { mode: 0o600 });
process.stdout.write(JSON.stringify({ prepared: true, origin, expiresAt: values.PARTNER_ACCESS_EXPIRES_AT, secretsPrinted: false }) + "\n");
