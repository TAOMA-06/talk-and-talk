#!/bin/zsh
set -euo pipefail

TOOLS_DIR=${0:A:h}
ROOT_DIR=${TOOLS_DIR:h}
STATE="$ROOT_DIR/run/recording-state.json"
FORCE=0

while (( $# > 0 )); do
  case "$1" in
    --state) STATE="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --help|-h) echo "Usage: stop-recording.sh [--state path.json] [--force]"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

[[ "$STATE" = /* && -f "$STATE" ]] || { echo "Recording state not found: $STATE" >&2; exit 1; }
PID=$(/usr/bin/plutil -extract pid raw -o - "$STATE")
OUTPUT=$(/usr/bin/plutil -extract output raw -o - "$STATE")
[[ "$PID" == <-> ]] || { echo "Invalid recording PID" >&2; exit 1; }

if kill -0 "$PID" 2>/dev/null; then
  COMMAND=$(ps -p "$PID" -o comm= 2>/dev/null || true)
  [[ "$COMMAND" == */screencapture || "$COMMAND" == screencapture ]] || { echo "PID $PID is not screencapture: $COMMAND" >&2; exit 1; }
  kill -INT "$PID"
  for _ in {1..80}; do
    kill -0 "$PID" 2>/dev/null || break
    sleep 0.25
  done
  if kill -0 "$PID" 2>/dev/null; then
    if (( FORCE == 0 )); then
      echo "Graceful stop timed out; inspect the recorder and rerun with --force only if safe" >&2
      exit 2
    fi
    kill -TERM "$PID"
  fi
fi

for _ in {1..40}; do
  [[ -s "$OUTPUT" ]] && break
  sleep 0.25
done
[[ -s "$OUTPUT" ]] || { echo "Raw MOV is missing or empty: $OUTPUT" >&2; exit 1; }
/usr/bin/avmediainfo "$OUTPUT" --brief >/dev/null
/usr/bin/python3 - "$STATE" <<'PY'
import json, sys
from datetime import datetime, timezone
path = sys.argv[1]
with open(path, encoding="utf-8") as handle: state = json.load(handle)
state["status"] = "stopped"
state["stoppedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
with open(path, "w", encoding="utf-8") as handle: json.dump(state, handle, ensure_ascii=False, indent=2)
PY
echo "stopped_pid=$PID"
echo "raw_mov=$OUTPUT"
