#!/bin/sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  DATABASE_URL="$(node -e '
    const { resolveDatabaseUrl } = require("./config/database-url.js");
    try {
      const value = resolveDatabaseUrl(process.env);
      if (!value) throw new Error("DATABASE_URL or complete PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD is required");
      process.stdout.write(value);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Unable to resolve DATABASE_URL");
      process.exit(1);
    }
  ')"
  export DATABASE_URL
fi

# Migrations must run as a single release job before rolling replicas.
# Opt in only for disposable / legacy single-replica boots:
#   RUN_MIGRATE_ON_START=true
# Otherwise verify the schema is already applied (fail closed).
case "${CLOUDBASE_MANAGED_MIGRATIONS:-false}" in
  true)
    echo "[entrypoint] CLOUDBASE_MANAGED_MIGRATIONS=true — skipping Prisma migrate/status; apply tracked DDL through CloudBase tcb db pg migration or ExecutePGSql."
    ;;
  false)
    if [ "${RUN_MIGRATE_ON_START:-false}" = "true" ]; then
      echo "[entrypoint] RUN_MIGRATE_ON_START=true — running prisma migrate deploy..."
      ./node_modules/.bin/prisma migrate deploy
    else
      echo "[entrypoint] Verifying prisma migrate status (set RUN_MIGRATE_ON_START=true to deploy)..."
      ./node_modules/.bin/prisma migrate status
    fi
    ;;
  *)
    echo "[entrypoint] CLOUDBASE_MANAGED_MIGRATIONS must be true or false." >&2
    exit 64
    ;;
esac

if [ "${SEED_ON_STARTUP:-false}" = "true" ]; then
  echo "[entrypoint] SEED_ON_STARTUP=true — running database seed..."
  node dist/src/database/seed.js
else
  echo "[entrypoint] Skipping database seed."
fi

exec node dist/src/main.js
