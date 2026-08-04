#!/bin/sh
set -eu

# Migrations must run as a single release job before rolling replicas.
# Opt in only for disposable / legacy single-replica boots:
#   RUN_MIGRATE_ON_START=true
# Otherwise verify the schema is already applied (fail closed).
if [ "${RUN_MIGRATE_ON_START:-false}" = "true" ]; then
  echo "[entrypoint] RUN_MIGRATE_ON_START=true — running prisma migrate deploy..."
  ./node_modules/.bin/prisma migrate deploy
else
  echo "[entrypoint] Verifying prisma migrate status (set RUN_MIGRATE_ON_START=true to deploy)..."
  ./node_modules/.bin/prisma migrate status
fi

if [ "${SEED_ON_STARTUP:-false}" = "true" ]; then
  echo "[entrypoint] SEED_ON_STARTUP=true — running database seed..."
  node dist/src/database/seed.js
else
  echo "[entrypoint] Skipping database seed."
fi

exec node dist/src/main.js
