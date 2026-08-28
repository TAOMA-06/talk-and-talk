#!/bin/zsh
set -euo pipefail

if [[ -n "${DEMO_SETUP_LOG:-}" ]]; then
  exec > >(tee "$DEMO_SETUP_LOG") 2>&1
fi

repo_root="${0:A:h:h:h:h:h}"
api_root="$repo_root/backend/api"
db_name="${DEMO_DB_NAME:?DEMO_DB_NAME is required}"
redis_db="${DEMO_REDIS_DB:?DEMO_REDIS_DB is required}"

cd "$api_root"
set -a
source .env
set +a

if [[ "$(redis-cli -h 127.0.0.1 -p 6379 -n "$redis_db" DBSIZE)" != "0" ]]; then
  print -u2 "Refusing to use non-empty Redis DB $redis_db"
  exit 1
fi

if [[ "$(psql -d postgres -X -A -t -c "SELECT 1 FROM pg_database WHERE datname = '$db_name'")" == "1" ]]; then
  print -u2 "Refusing to reuse existing PostgreSQL database $db_name"
  exit 1
fi

createdb --owner=talk "$db_name"
export DATABASE_URL="${DATABASE_URL%/*}/$db_name"
export REDIS_URL="redis://127.0.0.1:6379/$redis_db"

print "Created isolated PostgreSQL database: $db_name"
print "Allocated empty Redis DB: $redis_db"
npm run prisma:deploy
npm run prisma:seed
npm run build
npm run staff:bootstrap
print "Isolated demo backend prepared"
