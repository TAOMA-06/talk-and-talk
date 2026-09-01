import { access, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const entrypoint = await readFile("docker-entrypoint.sh", "utf8");
const dockerfile = await readFile("Dockerfile", "utf8");
const dockerignore = await readFile(".dockerignore", "utf8");
const productionCompose = await readFile(
  "../../infra/docker-compose.prod.yml",
  "utf8"
);
const mainSource = await readFile("src/main.ts", "utf8");
const reviewHtml = await readFile("public/review/index.html", "utf8");
const reviewScript = await readFile("public/review/assets/app.js", "utf8");
const adminHtml = await readFile("public/admin/index.html", "utf8");
const adminScript = await readFile("public/admin/assets/app.js", "utf8");
const adminModule = await readFile("src/admin/admin.module.ts", "utf8");
const productionEnvExample = await readFile(".env.production.example", "utf8");
const deploymentPreflight = await readFile("scripts/deployment-preflight.mjs", "utf8");

const expectedPackageScripts = {
  start: "node dist/src/main.js",
  "start:prod": "node dist/src/main.js"
};

for (const [name, expected] of Object.entries(expectedPackageScripts)) {
  if (packageJson.scripts[name] !== expected) {
    throw new Error(`package.json script ${name} must be: ${expected}`);
  }
}

for (const runtimeDependency of ["dotenv", "prisma"]) {
  if (!packageJson.dependencies?.[runtimeDependency]) {
    throw new Error(`${runtimeDependency} must remain a production dependency`);
  }
}

const expectedEntrypointCommands = [
  "prisma migrate status",
  "RUN_MIGRATE_ON_START",
  "node dist/src/database/seed.js",
  "exec node dist/src/main.js"
];

for (const command of expectedEntrypointCommands) {
  if (!entrypoint.includes(command)) {
    throw new Error(`docker-entrypoint.sh must contain: ${command}`);
  }
}
if (!entrypoint.includes("prisma migrate deploy")) {
  throw new Error("docker-entrypoint.sh must retain opt-in prisma migrate deploy");
}
if (!/RUN_MIGRATE_ON_START:-false/.test(entrypoint)) {
  throw new Error("docker-entrypoint.sh must default RUN_MIGRATE_ON_START to false");
}
if (!mainSource.includes("enableShutdownHooks")) {
  throw new Error("main.ts must enable Nest shutdown hooks for worker lease release");
}

const staticAssetsCopy = "COPY --from=build /app/public ./dist/public";
if (!dockerfile.includes(staticAssetsCopy)) {
  throw new Error(`Dockerfile must contain: ${staticAssetsCopy}`);
}
if (!/^USER node$/m.test(dockerfile)) {
  throw new Error("Docker runtime must switch to the non-root node user");
}
for (const requiredOciLabel of [
  "org.opencontainers.image.revision",
  "io.talkandtalk.source-tree-sha256",
  "io.talkandtalk.artifact-provenance-sha256",
  "io.talkandtalk.provenance-kind"
]) {
  if (!dockerfile.includes(requiredOciLabel)) {
    throw new Error(`Dockerfile must define immutable-candidate provenance label: ${requiredOciLabel}`);
  }
}
if (!dockerfile.includes("approved-candidate") || !dockerfile.includes("OCI_PROVENANCE_KIND")) {
  throw new Error("Dockerfile must fail closed when an approved-candidate image lacks provenance inputs");
}

for (const ignored of [".env.*", "node_modules", "dist", "backups", "*.pem", "*.key"]) {
  if (!dockerignore.split(/\r?\n/).includes(ignored)) {
    throw new Error(`.dockerignore must exclude: ${ignored}`);
  }
}

const requiredSecretExpressions = [
  "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}",
  "${REDIS_PASSWORD:?REDIS_PASSWORD must be set}",
  "${WECHAT_PAY_PRIVATE_KEY_HOST_PATH:?WECHAT_PAY_PRIVATE_KEY_HOST_PATH must be set}"
];

for (const expression of requiredSecretExpressions) {
  if (!productionCompose.includes(expression)) {
    throw new Error(`docker-compose.prod.yml must fail fast with: ${expression}`);
  }
}

for (const hardening of ["read_only: true", "no-new-privileges:true", "pids_limit:", "max-size:"]) {
  if (!productionCompose.includes(hardening)) {
    throw new Error(`docker-compose.prod.yml must include runtime hardening: ${hardening}`);
  }
}

const insecureSecretDefaults = [
  "POSTGRES_PASSWORD:-",
  "REDIS_PASSWORD:-"
];

for (const insecureDefault of insecureSecretDefaults) {
  if (productionCompose.includes(insecureDefault)) {
    throw new Error(
      `docker-compose.prod.yml must not define a production secret default: ${insecureDefault}`
    );
  }
}

const artifacts = [
  "dist/src/main.js",
  "dist/src/database/seed.js",
  "dist/src/database/bootstrap-staff.js",
  "dist/src/database/bootstrap-review-staff.js",
  "dist/config/transactional-template-manifest.js"
];

if (!mainSource.includes('scriptSrc: ["\'self\'"]')) {
  throw new Error("Review workbench must allow only same-origin scripts");
}
if (
  !reviewScript.includes('/api/v1/review/auth/login')
  || reviewHtml.includes('/auth/staff/login')
  || reviewScript.includes('/auth/staff/login')
) {
  throw new Error("Review workbench must use the separate review password + TOTP login endpoint");
}
if (
  !adminScript.includes('/auth/staff/login')
  || adminScript.includes('/review/auth/login')
  || adminHtml.includes('/admin/moderation')
) {
  throw new Error("Commercial admin must use staff login and must not retain a user-role review entrypoint");
}
if (
  !mainSource.includes('router.get("/admin/"')
  || !mainSource.includes('join(publicRoot, "admin", "index.html")')
  || !mainSource.includes('router.get("/review/"')
  || !mainSource.includes('join(publicRoot, "review", "index.html")')
) {
  throw new Error("/admin and /review must remain separate same-origin static applications");
}
for (const requiredAdminContract of [
  "/admin/commercial/readiness",
  "/admin/commercial/funnel",
  "/admin/operations/orders",
  "/admin/operations/support/orders",
  "/admin/commercial/support/claimable",
  "/admin/commercial/support/tickets/${encodeURIComponent(item.id)}/claim",
  "/payments/refunds/review-queue",
  "/admin/commercial/companion-lifecycle/review-due",
  "/admin/commercial/companion-lifecycle/companions/${encodeURIComponent(companionId)}/voice-intro-read",
  "/admin/users/${encodeURIComponent(item.ownerUserId)}/verification",
  "/admin/identity-verification-requests?status=",
  "/admin/identity-verification-requests/${encodeURIComponent(item.id)}/${decision}",
  "/admin/account-governance/data-rights",
  "/admin/account-governance/data-rights/claimable",
  "/admin/account-governance/data-rights/${encodeURIComponent(item.id)}/claim",
  "/admin/account-governance/invoice-requests",
  "/admin/account-deletions"
]) {
  if (!adminScript.includes(requiredAdminContract)) {
    throw new Error(`Commercial admin must retain real API contract: ${requiredAdminContract}`);
  }
}
for (const [blockerKey, blockerLabel] of [
  ["overdueUserAccountAppeals", "普通用户账号申诉复核超时"],
  ["overdueCompanionAccountAppeals", "陪伴者账号申诉复核超时"],
  ["accountDeletionRetentionPolicyUnapproved", "账号注销保留政策未获外部法律批准"]
]) {
  if (!adminScript.includes(blockerKey) || !adminScript.includes(blockerLabel)) {
    throw new Error(`Commercial readiness workbench must label blocker: ${blockerKey}`);
  }
}
if (adminModule.includes("AdminModerationController")) {
  throw new Error("AdminModule must not register the review department controller");
}
for (const retentionApprovalConfig of [
  "ACCOUNT_DELETION_RETENTION_POLICY_APPROVED",
  "ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE",
  "AUTH_IDENTITY_TOMBSTONE_HMAC_KEYS",
  "AUTH_IDENTITY_TOMBSTONE_ACTIVE_KEY_ID",
  "AUTH_IDENTITY_REREGISTRATION_POLICY"
]) {
  if (!productionEnvExample.includes(`${retentionApprovalConfig}=`)) {
    throw new Error(`Production environment template must document: ${retentionApprovalConfig}`);
  }
  if (!deploymentPreflight.includes(retentionApprovalConfig)) {
    throw new Error(`Deployment preflight must validate: ${retentionApprovalConfig}`);
  }
}
if (!/^ACCOUNT_DELETION_RETENTION_POLICY_APPROVED=false$/m.test(productionEnvExample)) {
  throw new Error("Production environment template must default retention-policy approval to explicit No-Go");
}
for (const voiceEvidenceConfig of [
  "COMPANION_VOICE_EVIDENCE_VIEWER_URL",
  "COMPANION_VOICE_EVIDENCE_SIGNING_SECRET",
  "COMPANION_VOICE_EVIDENCE_URL_TTL_SECONDS",
  "TRTC_CALLBACK_SIGNING_KEY"
]) {
  if (!productionEnvExample.includes(`${voiceEvidenceConfig}=`)) {
    throw new Error(`Production environment template must document: ${voiceEvidenceConfig}`);
  }
  if (!deploymentPreflight.includes(voiceEvidenceConfig)) {
    throw new Error(`Deployment preflight must validate: ${voiceEvidenceConfig}`);
  }
}

const staticAssets = [
  "config/transactional-template-manifest.js",
  "public/ops-foundation.css",
  "public/admin/index.html",
  "public/admin/assets/app.js",
  "public/admin/assets/styles.css",
  "public/review/index.html",
  "public/review/assets/app.js",
  "public/review/assets/styles.css",
  "public/legal/privacy.html",
  "public/legal/terms.html"
];

for (const staticAsset of staticAssets) {
  await access(staticAsset);
  await access(`dist/${staticAsset}`);
  const [sourceBytes, builtBytes] = await Promise.all([
    readFile(staticAsset),
    readFile(`dist/${staticAsset}`)
  ]);
  if (!sourceBytes.equals(builtBytes)) {
    throw new Error(`Built static asset does not match source: ${staticAsset}`);
  }
}

for (const script of [
  "public/admin/assets/app.js",
  "public/review/assets/app.js",
  "dist/public/admin/assets/app.js",
  "dist/public/review/assets/app.js"
]) {
  const syntaxCheck = spawnSync(process.execPath, ["--check", script], {
    stdio: "inherit"
  });
  if (syntaxCheck.status !== 0) {
    throw new Error(`Static application failed syntax validation: ${script}`);
  }
}

for (const artifact of artifacts) {
  await access(artifact);
  const syntaxCheck = spawnSync(process.execPath, ["--check", artifact], {
    stdio: "inherit"
  });

  if (syntaxCheck.status !== 0) {
    throw new Error(`Production artifact failed syntax validation: ${artifact}`);
  }
}

const configurationLoad = spawnSync(
  process.execPath,
  ["-e", "require('./dist/src/config/configuration.js')"],
  { stdio: "inherit" }
);
if (configurationLoad.status !== 0) {
  throw new Error("Compiled configuration and its runtime manifest must load from dist");
}

console.log("Production entrypoints and compiled artifacts are valid.");
