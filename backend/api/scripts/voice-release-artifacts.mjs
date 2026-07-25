#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TLS_SIG_PACKAGE = "tls-sig-api-v2";
export const TLS_SIG_VERSION = "1.0.2";
export const TRTC_MINIPROGRAM_PACKAGE = "trtc-wx-sdk";
export const TRTC_MINIPROGRAM_VERSION = "1.1.15";

function readJson(path, errors) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    errors.push(`${path} must be valid JSON and readable`);
    return null;
  }
}

function hasJavaScriptFile(directory) {
  try {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isFile() && entry.name.endsWith(".js")) return true;
      if (entry.isDirectory() && hasJavaScriptFile(entryPath)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function sourceRequiresTrtcSdk(path) {
  try {
    const source = readFileSync(path, "utf8");
    return source.includes('require("trtc-wx-sdk")') || source.includes("require('trtc-wx-sdk')");
  } catch {
    return false;
  }
}

/**
 * Checks artifacts that must exist before the production TRTC feature flag can
 * be enabled. It deliberately does not install packages or invoke the WeChat
 * Developer Tools: those actions need an approved dependency install and a
 * real Mini Program build environment.
 */
export function validateVoiceReleaseArtifacts(repositoryRoot) {
  const root = resolve(repositoryRoot ?? resolve(fileURLToPath(import.meta.url), "../../../.."));
  const errors = [];
  const backendRoot = join(root, "backend/api");
  const miniProgramRoot = join(root, "frontend/miniprogram");
  const backendPackagePath = join(backendRoot, "package.json");
  const packageLockPath = join(backendRoot, "package-lock.json");
  const miniProgramPackagePath = join(miniProgramRoot, "package.json");
  const miniProgramSdkPath = join(miniProgramRoot, "miniprogram_npm", TRTC_MINIPROGRAM_PACKAGE);
  const voicePagePath = join(miniProgramRoot, "pages/voice/index.ts");

  const backendPackage = readJson(backendPackagePath, errors);
  if (backendPackage?.dependencies?.[TLS_SIG_PACKAGE] !== TLS_SIG_VERSION) {
    errors.push(`${backendPackagePath} must declare ${TLS_SIG_PACKAGE}@${TLS_SIG_VERSION}`);
  }

  const packageLock = readJson(packageLockPath, errors);
  const lockedRootVersion = packageLock?.packages?.[""]?.dependencies?.[TLS_SIG_PACKAGE];
  const lockedPackageVersion = packageLock?.packages?.[`node_modules/${TLS_SIG_PACKAGE}`]?.version;
  if (lockedRootVersion !== TLS_SIG_VERSION || lockedPackageVersion !== TLS_SIG_VERSION) {
    errors.push(
      `${packageLockPath} must lock ${TLS_SIG_PACKAGE}@${TLS_SIG_VERSION}; run an approved install and commit the lockfile`
    );
  }

  try {
    createRequire(backendPackagePath).resolve(TLS_SIG_PACKAGE);
  } catch {
    errors.push(`${TLS_SIG_PACKAGE} is not resolvable from backend/api; install the locked production dependency`);
  }

  const miniProgramPackage = readJson(miniProgramPackagePath, errors);
  if (miniProgramPackage?.dependencies?.[TRTC_MINIPROGRAM_PACKAGE] !== TRTC_MINIPROGRAM_VERSION) {
    errors.push(`${miniProgramPackagePath} must declare ${TRTC_MINIPROGRAM_PACKAGE}@${TRTC_MINIPROGRAM_VERSION}`);
  }
  if (!existsSync(miniProgramSdkPath)) {
    errors.push(
      `${miniProgramSdkPath} is missing; install the Mini Program dependency and run 微信开发者工具“构建 npm”`
    );
  } else if (!hasJavaScriptFile(miniProgramSdkPath)) {
    errors.push(`${miniProgramSdkPath} must contain built JavaScript output from 微信开发者工具“构建 npm”`);
  }
  if (!sourceRequiresTrtcSdk(voicePagePath)) {
    errors.push(`${voicePagePath} must load ${TRTC_MINIPROGRAM_PACKAGE} for the real-time voice page`);
  }

  return errors;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const errors = validateVoiceReleaseArtifacts();
  if (errors.length) {
    console.error(`Voice release artifact gate failed with ${errors.length} issue(s):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log("Voice release artifact gate passed: backend signer and Mini Program RTC build output are present.");
  }
}
