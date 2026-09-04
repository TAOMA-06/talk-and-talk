"use strict";

const POSTGRES_FALLBACK_KEYS = [
  "PGHOST",
  "PGPORT",
  "PGDATABASE",
  "PGUSER",
  "PGPASSWORD"
];

/**
 * Resolves a PostgreSQL connection URL without ever including credential
 * values in validation errors. DATABASE_URL remains authoritative; the PG*
 * fallback exists for platforms such as CloudBase that inject libpq-style
 * variables separately.
 */
function resolveDatabaseUrl(environment, fallback = "") {
  const explicit = stringValue(environment.DATABASE_URL);
  if (explicit) return explicit;

  const values = Object.fromEntries(
    POSTGRES_FALLBACK_KEYS.map((key) => [
      key,
      key === "PGPASSWORD" ? passwordValue(environment[key]) : stringValue(environment[key])
    ])
  );
  const configuredKeys = POSTGRES_FALLBACK_KEYS.filter((key) => values[key]);
  if (configuredKeys.length === 0) return fallback;

  const missingKeys = POSTGRES_FALLBACK_KEYS.filter((key) => !values[key]);
  if (missingKeys.length > 0) {
    throw new Error(
      `DATABASE_URL fallback requires all PostgreSQL variables; missing: ${missingKeys.join(", ")}`
    );
  }

  const port = Number(values.PGPORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PGPORT must be an integer between 1 and 65535");
  }
  const host = normalizeHost(values.PGHOST);
  return `postgresql://${encodeURIComponent(values.PGUSER)}:${encodeURIComponent(values.PGPASSWORD)}`
    + `@${host}:${port}/${encodeURIComponent(values.PGDATABASE)}`;
}

function normalizeHost(value) {
  if (/^[A-Za-z0-9.-]+$/.test(value)) return value;
  const unwrapped = value.startsWith("[") && value.endsWith("]")
    ? value.slice(1, -1)
    : value;
  if (/^[0-9A-Fa-f:]+$/.test(unwrapped) && unwrapped.includes(":")) {
    return `[${unwrapped}]`;
  }
  throw new Error("PGHOST must be a hostname or IP address");
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function passwordValue(value) {
  return typeof value === "string" && value.length > 0 ? value : "";
}

module.exports = {
  POSTGRES_FALLBACK_KEYS,
  resolveDatabaseUrl
};
