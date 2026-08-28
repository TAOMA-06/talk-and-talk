#!/bin/zsh
set -euo pipefail
TOOLS_DIR=${0:A:h}
[[ -x "$TOOLS_DIR/bin/transcode-recording" ]] || { echo "Run tools/build-tools.sh first" >&2; exit 1; }
exec "$TOOLS_DIR/bin/transcode-recording" "$@"
