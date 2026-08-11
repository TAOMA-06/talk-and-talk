"use strict";

const { createHash } = require("node:crypto");

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const E2E_DATABASE_CONTROL_SCHEMA = "_talktalk_e2e_control";
const E2E_DATABASE_LEASE_TABLE = "ownership";
const E2E_LEASE_TTL_MS = 60 * 60 * 1_000;
const E2E_EXECUTION_AUTHORIZATION_EVIDENCE_PATTERN = /^E[A-Z0-9]*(?:-[A-Z0-9][A-Z0-9._-]*)+$/;

function requiredUrl(env, key, protocols) {
  const value = String(env[key] ?? "").trim();
  if (!value) {
    throw new Error(`${key} is required for isolated E2E tests`);
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid URL for isolated E2E tests`);
  }

  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`${key} must use ${protocols.join(" or ")} for isolated E2E tests`);
  }
  // Both Prisma/PostgreSQL and ioredis accept URL query options that can alter
  // the effective transport endpoint (for example `host=` or `path=`). The
  // E2E guard must validate the exact endpoint the process will use, so these
  // overrides are forbidden rather than merely checking the authority host.
  if (parsed.search || parsed.hash) {
    throw new Error(`${key} must not contain query parameters or a fragment for isolated E2E tests`);
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error(`${key} must use a loopback host for isolated E2E tests`);
  }

  return parsed;
}

function databaseName(parsed) {
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!/^[A-Za-z0-9_]+_e2e$/i.test(name)) {
    throw new Error("E2E PostgreSQL database name must end in _e2e");
  }
  return name;
}

function redisDatabaseIndex(parsed) {
  const path = parsed.pathname.replace(/^\//, "");
  if (!/^(?:0|[1-9][0-9]*)$/.test(path)) {
    throw new Error("E2E Redis must use an explicit dedicated database index from 1 to 15");
  }
  const index = Number(path);
  if (index < 1 || index > 15) {
    throw new Error("E2E Redis must use an explicit dedicated database index from 1 to 15");
  }
  return index;
}

function requiredRunId(env) {
  const runId = String(env.E2E_RUN_ID ?? "").trim();
  if (!/^[a-z0-9][a-z0-9_-]{11,127}$/.test(runId)) {
    throw new Error("E2E_RUN_ID must be a lowercase per-run identifier for isolated E2E tests");
  }
  return runId;
}

function requiredOwnershipToken(env) {
  const token = String(env.E2E_OWNERSHIP_TOKEN ?? "").trim();
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) {
    throw new Error("E2E_OWNERSHIP_TOKEN must be a high-entropy per-run token for isolated E2E tests");
  }
  return token;
}

// This is deliberately an Evidence ID reference rather than a secret or an
// authorization mechanism. The runner cannot independently prove that the
// referenced approval exists; requiring it makes the operator's authorization
// step explicit and gives the resulting evidence a non-secret audit handle.
function assertE2eExecutionAuthorization(env = process.env) {
  const evidence = String(env.E2E_EXECUTION_AUTHORIZATION_EVIDENCE ?? "").trim();
  if (!E2E_EXECUTION_AUTHORIZATION_EVIDENCE_PATTERN.test(evidence)) {
    throw new Error(
      "E2E_EXECUTION_AUTHORIZATION_EVIDENCE must be a canonical non-secret Evidence ID before isolated E2E may run"
    );
  }
  return evidence;
}

function ownershipTokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function e2eRedisLeaseKey(runId) {
  return `talk-and-talk:e2e:lease:${runId}`;
}

function networkIdentity(parsed, defaultPort, path = "") {
  return `${parsed.protocol}//${parsed.hostname}:${parsed.port || defaultPort}${path}`;
}

function sameRedisTransport(left, right) {
  return left.protocol === right.protocol
    && left.hostname === right.hostname
    && (left.port || "6379") === (right.port || "6379")
    && left.username === right.username
    && left.password === right.password;
}

function assertIssuerOwnsDatabase(env, runId, name) {
  if (name !== `talk_and_talk_${runId}_e2e`) {
    throw new Error("E2E PostgreSQL database name must exactly bind to E2E_RUN_ID");
  }
  const issuer = String(env.E2E_ENVIRONMENT_ISSUER ?? "").trim();
  if (issuer === "local-runner") {
    return issuer;
  }
  if (issuer === "github-actions" && env.GITHUB_ACTIONS === "true") {
    return issuer;
  }
  throw new Error("E2E environment must be issued by the local runner or GitHub Actions");
}

function assertDisposableE2eEnvironment(env = process.env) {
  const executionAuthorizationEvidence = assertE2eExecutionAuthorization(env);
  if (env.NODE_ENV !== "test") {
    throw new Error("NODE_ENV=test is required for isolated E2E tests");
  }
  if (env.E2E_DATABASE_RESET_ALLOWED !== "1") {
    throw new Error("E2E_DATABASE_RESET_ALLOWED=1 is required before an E2E test may reset PostgreSQL");
  }
  if (env.E2E_REDIS_FLUSH_ALLOWED !== "1") {
    throw new Error("E2E_REDIS_FLUSH_ALLOWED=1 is required before an E2E test may flush Redis");
  }

  const postgres = requiredUrl(env, "DATABASE_URL", ["postgres:", "postgresql:"]);
  const redis = requiredUrl(env, "REDIS_URL", ["redis:", "rediss:"]);
  const ownershipRedis = requiredUrl(env, "E2E_REDIS_OWNERSHIP_URL", ["redis:", "rediss:"]);
  const runId = requiredRunId(env);
  const token = requiredOwnershipToken(env);
  const name = databaseName(postgres);
  const redisDatabase = redisDatabaseIndex(redis);
  const ownershipRedisDatabase = redisDatabaseIndex(ownershipRedis);
  if (redisDatabase !== 15) {
    throw new Error("E2E Redis test data must use dedicated database index 15");
  }
  if (ownershipRedisDatabase !== 14 || !sameRedisTransport(redis, ownershipRedis)) {
    throw new Error("E2E Redis ownership marker must use the same transport on dedicated database index 14");
  }

  return {
    databaseName: name,
    databaseUrl: postgres.toString(),
    databaseIdentity: networkIdentity(postgres, "5432", `/${name}`),
    executionAuthorizationEvidence,
    issuer: assertIssuerOwnsDatabase(env, runId, name),
    redisDatabase,
    redisLeaseKey: e2eRedisLeaseKey(runId),
    redisIdentity: networkIdentity(redis, "6379"),
    redisOwnershipUrl: ownershipRedis.toString(),
    redisUrl: redis.toString(),
    runId,
    ownershipTokenHash: ownershipTokenHash(token)
  };
}

module.exports = {
  assertE2eExecutionAuthorization,
  assertDisposableE2eEnvironment,
  E2E_DATABASE_CONTROL_SCHEMA,
  E2E_DATABASE_LEASE_TABLE,
  E2E_LEASE_TTL_MS,
  e2eRedisLeaseKey,
  ownershipTokenHash
};

if (require.main === module) {
  assertDisposableE2eEnvironment();
  console.info("Disposable E2E environment accepted");
}
