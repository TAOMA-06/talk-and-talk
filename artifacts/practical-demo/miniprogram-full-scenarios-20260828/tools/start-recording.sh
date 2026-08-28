#!/bin/zsh
set -euo pipefail

TOOLS_DIR=${0:A:h}
ROOT_DIR=${TOOLS_DIR:h}
CONFIG="$ROOT_DIR/capture-config.json"
OUTPUT=""
STATE=""
WINDOW_ID=""
RECT=""
MAX_SECONDS=""
TRIAL=0
PRIVACY_ACK=0

while (( $# > 0 )); do
  case "$1" in
    --config) CONFIG="$2"; shift 2 ;;
    --output) OUTPUT="$2"; shift 2 ;;
    --state) STATE="$2"; shift 2 ;;
    --window-id) WINDOW_ID="$2"; shift 2 ;;
    --rect) RECT="$2"; shift 2 ;;
    --max-seconds) MAX_SECONDS="$2"; shift 2 ;;
    --trial) TRIAL=1; shift ;;
    --ack-privacy-reviewed) PRIVACY_ACK=1; shift ;;
    --help|-h)
      echo "Usage: start-recording.sh [--config path] [--window-id id | --rect x,y,w,h] [--output path.mov] [--state path.json] [--max-seconds n] [--trial] --ack-privacy-reviewed"
      exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

[[ "$CONFIG" = /* && -f "$CONFIG" ]] || { echo "Config must be an existing absolute path" >&2; exit 1; }
(( PRIVACY_ACK == 1 )) || { echo "Refusing to record without --ack-privacy-reviewed" >&2; exit 1; }

json_value() { /usr/bin/plutil -extract "$1" raw -o - "$CONFIG"; }
MODE=$(json_value capture.mode)
CONFIG_REVIEWED=$(json_value privacy.reviewed)
RECT_APPROVED=$(json_value privacy.rectVisuallyApproved)
OWNER=$(json_value target.ownerContains)
DISPLAY=$(json_value capture.display)
SHOW_CLICKS=$(json_value capture.showClicks)
INCLUDE_CURSOR=$(json_value capture.includeCursor)

if (( TRIAL == 0 )) && [[ "$CONFIG_REVIEWED" != "true" ]]; then
  echo "capture-config.json privacy.reviewed must be true before a final recording" >&2
  exit 1
fi

[[ -x "$TOOLS_DIR/bin/inspect-capture" ]] || { echo "Run tools/build-tools.sh first" >&2; exit 1; }
"$TOOLS_DIR/bin/inspect-capture" --owner-contains "$OWNER" --require-permission >/dev/null

if [[ -n "$RECT" ]]; then MODE=rect; fi
if [[ -n "$WINDOW_ID" ]]; then MODE=window; fi

if [[ "$MODE" == "window" ]]; then
  [[ -n "$WINDOW_ID" ]] || WINDOW_ID=$(json_value capture.windowId)
  [[ "$WINDOW_ID" == <-> && "$WINDOW_ID" -gt 0 ]] || { echo "A current positive --window-id is required" >&2; exit 1; }
  if (( TRIAL == 0 )); then
    "$TOOLS_DIR/bin/inspect-capture" --owner-contains "$OWNER" --require-permission --require-window-id "$WINDOW_ID" >/dev/null
  fi
elif [[ "$MODE" == "rect" ]]; then
  if [[ -z "$RECT" ]]; then
    RECT="$(json_value capture.rect.x),$(json_value capture.rect.y),$(json_value capture.rect.width),$(json_value capture.rect.height)"
  fi
  [[ "$RECT" == <->,<->,<->,<-> ]] || { echo "Rect must be x,y,width,height with non-negative integers" >&2; exit 1; }
  if (( TRIAL == 0 )) && [[ "$RECT_APPROVED" != "true" ]]; then
    echo "Rect capture requires privacy.rectVisuallyApproved=true" >&2
    exit 1
  fi
else
  echo "Unsupported capture mode: $MODE" >&2
  exit 1
fi

if [[ -z "$MAX_SECONDS" ]]; then MAX_SECONDS=$(json_value capture.maxSeconds); fi
[[ "$MAX_SECONDS" == <-> ]] || { echo "maxSeconds must be a non-negative integer" >&2; exit 1; }

if [[ -z "$OUTPUT" ]]; then
  RAW_DIR=$(json_value output.rawDirectory)
  mkdir -p "$RAW_DIR"
  OUTPUT="$RAW_DIR/miniprogram-full-session-$(date -u +%Y%m%dT%H%M%SZ).mov"
fi
[[ "$OUTPUT" = /* && "$OUTPUT" == *.mov ]] || { echo "Output must be an absolute .mov path" >&2; exit 1; }
[[ ! -e "$OUTPUT" ]] || { echo "Output already exists: $OUTPUT" >&2; exit 1; }
mkdir -p "${OUTPUT:h}"

if [[ -z "$STATE" ]]; then
  if (( TRIAL == 1 )); then STATE="${OUTPUT:r}.state.json"; else STATE=$(json_value output.stateFile); fi
fi
[[ "$STATE" = /* ]] || { echo "State path must be absolute" >&2; exit 1; }
mkdir -p "${STATE:h}"
if [[ -f "$STATE" ]]; then
  OLD_PID=$(/usr/bin/plutil -extract pid raw -o - "$STATE" 2>/dev/null || true)
  if [[ "$OLD_PID" == <-> ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "A recording is already active with PID $OLD_PID" >&2
    exit 1
  fi
fi

args=(-x -v)
[[ "$SHOW_CLICKS" == "true" ]] && args+=(-k)
[[ "$INCLUDE_CURSOR" == "true" ]] && args+=(-C)
if [[ "$MODE" == "window" ]]; then args+=("-l$WINDOW_ID"); else args+=("-D$DISPLAY" "-R$RECT"); fi
(( MAX_SECONDS > 0 )) && args+=("-V$MAX_SECONDS")

LOG="${STATE:r}.log"
/usr/sbin/screencapture "${args[@]}" "$OUTPUT" >"$LOG" 2>&1 &
PID=$!
sleep 0.6
kill -0 "$PID" 2>/dev/null || { echo "screencapture exited early; see $LOG" >&2; exit 1; }

/usr/bin/python3 - "$STATE" "$PID" "$MODE" "$OUTPUT" "$LOG" "$WINDOW_ID" "$RECT" <<'PY'
import json, sys
from datetime import datetime, timezone
path, pid, mode, output, log, window_id, rect = sys.argv[1:]
state = {
    "pid": int(pid), "status": "recording", "mode": mode,
    "output": output, "startedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "log": log,
}
if mode == "window": state["windowId"] = int(window_id)
if mode == "rect": state["rect"] = rect
with open(path, "w", encoding="utf-8") as handle:
    json.dump(state, handle, ensure_ascii=False, indent=2)
PY

echo "recording_pid=$PID"
echo "raw_mov=$OUTPUT"
echo "state=$STATE"
