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
api_log="$artifact_root/logs/api.log"
pid_file="$temp_root/runtime/api.pid"

[[ "$db_name" == talk_and_talk_miniprogram_full_20260828_* ]] || { print -u2 "Unexpected database name"; exit 2; }
[[ "$temp_root" == /private/tmp/talktalk-miniprogram-full-20260828-* ]] || { print -u2 "Unexpected temporary root"; exit 2; }
if /usr/sbin/lsof -nP -iTCP:"$api_port" -sTCP:LISTEN >/dev/null 2>&1; then
  print -u2 "API port $api_port is already occupied"
  exit 1
fi

cd "$api_root"
set -a
source .env
set +a
export NODE_ENV=development
export APP_ENV=development
export HOST=127.0.0.1
export PORT="$api_port"
export DATABASE_URL="${DATABASE_URL%/*}/$db_name"
export REDIS_URL="redis://127.0.0.1:6379/$redis_db"
export SMS_PROVIDER=mock
export NOTIFICATION_DELIVERY_ENABLED=false
export MOCK_WECHAT_NOTIFY_SECRET="miniprogram-full-20260828-local-only-secret"
unset DEEPSEEK_API_KEY

print -r -- "$$" > "$pid_file"
exec node dist/src/main.js >> "$api_log" 2>&1
