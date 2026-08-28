#!/bin/zsh
set -euo pipefail

repo_root="${0:A:h:h:h:h:h}"
api_root="$repo_root/backend/api"
db_name="${DEMO_DB_NAME:?DEMO_DB_NAME is required}"
redis_db="${DEMO_REDIS_DB:?DEMO_REDIS_DB is required}"
log_path="${DEMO_API_LOG:?DEMO_API_LOG is required}"

cd "$api_root"
set -a
source .env
set +a
export DATABASE_URL="${DATABASE_URL%/*}/$db_name"
export REDIS_URL="redis://127.0.0.1:6379/$redis_db"
export MOCK_WECHAT_NOTIFY_SECRET="${DEMO_MOCK_WECHAT_NOTIFY_SECRET:?DEMO_MOCK_WECHAT_NOTIFY_SECRET is required}"

exec npm run start > >(tee "$log_path") 2>&1
