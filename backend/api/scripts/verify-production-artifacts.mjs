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
const legacyAdminHtml = await readFile("public/admin/index.html", "utf8");
const adminModule = await readFile("src/admin/admin.module.ts", "utf8");

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
  "dist/src/database/bootstrap-staff.js",
  "dist/src/database/bootstrap-review-staff.js"
];

if (!mainSource.includes('scriptSrc: ["\'self\'"]')) {
  throw new Error("Review workbench must allow only same-origin scripts");
}
if (!reviewScript.includes('/api/v1/review/auth/login') || reviewHtml.includes('/auth/staff/login')) {
  throw new Error("Review workbench must use the separate review password + TOTP login endpoint");
}
if (legacyAdminHtml.includes('/auth/staff/login') || legacyAdminHtml.includes('/admin/moderation')) {
  throw new Error("Legacy /admin page must not retain a user-role review entrypoint");
}
if (adminModule.includes("AdminModerationController")) {
  throw new Error("AdminModule must not register the review department controller");
}

const staticAssets = [
  "public/review/index.html",
  "public/review/assets/app.js",
  "public/review/assets/styles.css",
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
