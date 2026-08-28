#!/bin/zsh
set -euo pipefail
umask 077

repo_root="${0:A:h:h:h:h:h}"
artifact_root="${0:A:h:h}"
api_root="$repo_root/backend/api"
db_name="${DEMO_DB_NAME:?DEMO_DB_NAME is required}"
redis_db="${DEMO_REDIS_DB:?DEMO_REDIS_DB is required}"
api_port="${DEMO_API_PORT:?DEMO_API_PORT is required}"
temp_root="${DEMO_TEMP_ROOT:?DEMO_TEMP_ROOT is required}"
local_project="${DEMO_LOCAL_PROJECT:?DEMO_LOCAL_PROJECT is required}"
setup_log="$artifact_root/logs/setup.log"
system_tmp="$(node -p 'require("node:os").tmpdir()')"

[[ "$db_name" == talk_and_talk_miniprogram_full_20260828_* ]] || { print -u2 "Unexpected database name"; exit 2; }
[[ "$redis_db" == <0-15> ]] || { print -u2 "Redis DB must be 0-15"; exit 2; }
[[ "$api_port" == <1024-65535> ]] || { print -u2 "API port is invalid"; exit 2; }
[[ "$temp_root" == /private/tmp/talktalk-miniprogram-full-20260828-* ]] || { print -u2 "Unexpected temporary root"; exit 2; }
[[ "$local_project" == "$system_tmp"/talktalk-miniprogram-full-20260828-* ]] || { print -u2 "Local project must be inside Node's system temporary directory"; exit 2; }

mkdir -p "$artifact_root/logs" "$artifact_root/verification" "$temp_root/runtime"
chmod 700 "$temp_root" "$temp_root/runtime"
exec > >(tee "$setup_log") 2>&1

cd "$api_root"
set -a
source .env
set +a

if [[ "$(redis-cli -h 127.0.0.1 -p 6379 -n "$redis_db" DBSIZE)" != "0" ]]; then
  print -u2 "Refusing non-empty Redis DB $redis_db"
  exit 1
fi
if [[ "$(psql -d postgres -X -A -t -c "SELECT 1 FROM pg_database WHERE datname = '$db_name'")" == "1" ]]; then
  print -u2 "Refusing existing PostgreSQL database $db_name"
  exit 1
fi
if /usr/sbin/lsof -nP -iTCP:"$api_port" -sTCP:LISTEN >/dev/null 2>&1; then
  print -u2 "Refusing occupied API port $api_port"
  exit 1
fi

createdb --owner=talk "$db_name"
export DATABASE_URL="${DATABASE_URL%/*}/$db_name"
export REDIS_URL="redis://127.0.0.1:6379/$redis_db"

print "Created isolated PostgreSQL database: $db_name"
print "Reserved empty Redis DB: $redis_db"
print "Reserved loopback API port: $api_port"
npm run prisma:generate
npm run prisma:deploy
npm run prisma:seed
npm run build

cd "$repo_root"
node frontend/miniprogram/scripts/create-local-copy.mjs \
  --api-base-url "http://127.0.0.1:$api_port/api/v1" \
  --output "$local_project"

print "Generated isolated Mini Program project: $local_project"
print "Environment preparation complete"
