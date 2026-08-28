#!/bin/zsh
set -euo pipefail

db_name="talk_and_talk_miniprogram_full_20260828_ea11230f_01"
redis_db="11"
api_port="32028"
temp_root="/private/tmp/talktalk-miniprogram-full-20260828-ea11230f"
local_project="/var/folders/pz/sz1jvfhx5m3fsqc7j3f63rwm0000gn/T/talktalk-miniprogram-full-20260828-ea11230f-project"
pid_file="$temp_root/runtime/api.pid"

[[ "$db_name" == talk_and_talk_miniprogram_full_20260828_ea11230f_01 ]] || exit 2
[[ "$temp_root" == /private/tmp/talktalk-miniprogram-full-20260828-ea11230f ]] || exit 2
[[ "$local_project" == /var/folders/pz/sz1jvfhx5m3fsqc7j3f63rwm0000gn/T/talktalk-miniprogram-full-20260828-ea11230f-project ]] || exit 2

if [[ -f "$pid_file" ]]; then
  pid="$(<"$pid_file")"
  if [[ "$pid" == <1-> ]]; then
    kill -TERM "$pid" 2>/dev/null || true
  fi
fi
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  /usr/sbin/lsof -nP -iTCP:"$api_port" -sTCP:LISTEN >/dev/null 2>&1 || break
  sleep 0.25
done
dropdb --if-exists "$db_name"
redis-cli -h 127.0.0.1 -p 6379 -n "$redis_db" FLUSHDB >/dev/null
rm -rf "$temp_root"
rm -rf "$local_project"
print "Removed isolated API runtime, database, Redis DB $redis_db, and temporary local project"
