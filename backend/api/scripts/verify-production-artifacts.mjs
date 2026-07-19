import { access, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const entrypoint = await readFile("docker-entrypoint.sh", "utf8");
const dockerfile = await readFile("Dockerfile", "utf8");
const dockerignore = await readFile(".dockerignore", "utf8");
const productionCompose = await readFile(
  "../../infra/docker-compose.prod.yml",
  "utf8"
);
const mainSource = await readFile("src/main.ts", "utf8");
const adminHtml = await readFile("public/admin/index.html", "utf8");

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
  "./node_modules/.bin/prisma migrate deploy",
  "node dist/src/database/seed.js",
  "exec node dist/src/main.js"
];

for (const command of expectedEntrypointCommands) {
  if (!entrypoint.includes(command)) {
    throw new Error(`docker-entrypoint.sh must contain: ${command}`);
  }
}

const staticAssetsCopy = "COPY --from=build /app/public ./dist/public";
if (!dockerfile.includes(staticAssetsCopy)) {
  throw new Error(`Dockerfile must contain: ${staticAssetsCopy}`);
}
if (!/^USER node$/m.test(dockerfile)) {
  throw new Error("Docker runtime must switch to the non-root node user");
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
  "dist/src/database/bootstrap-staff.js"
];

const inlineAdminScript = adminHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!inlineAdminScript) {
  throw new Error("Admin console script was not found");
}
const adminScriptHash = createHash("sha256").update(inlineAdminScript).digest("base64");
if (!mainSource.includes(`'sha256-${adminScriptHash}'`)) {
  throw new Error("Helmet CSP does not authorize the current admin console script hash");
}
if (!adminHtml.includes('/auth/staff/login') || adminHtml.includes('/auth/sms/send-code')) {
  throw new Error("Admin console must use the staff password + TOTP login endpoint");
}

const staticAssets = [
  "public/admin/index.html",
  "public/legal/privacy.html",
  "public/legal/terms.html"
];

for (const staticAsset of staticAssets) {
  await access(staticAsset);
  await access(`dist/${staticAsset}`);
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

console.log("Production entrypoints and compiled artifacts are valid.");
