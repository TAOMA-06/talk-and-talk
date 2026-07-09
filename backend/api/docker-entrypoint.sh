#!/bin/sh
set -eu

echo "[entrypoint] Running prisma migrate deploy..."
npx prisma migrate deploy

if [ "${SEED_ON_STARTUP:-false}" = "true" ]; then
  echo "[entrypoint] SEED_ON_STARTUP=true — running database seed..."
  node dist/database/seed.js
else
  echo "[entrypoint] Skipping database seed."
fi

exec node dist/main.js