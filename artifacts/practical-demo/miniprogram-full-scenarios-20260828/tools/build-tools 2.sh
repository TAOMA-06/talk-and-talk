#!/bin/zsh
set -euo pipefail
TOOLS_DIR=${0:A:h}
mkdir -p "$TOOLS_DIR/bin"
/usr/bin/swiftc -warnings-as-errors -O "$TOOLS_DIR/inspect-capture.swift" -o "$TOOLS_DIR/bin/inspect-capture"
/usr/bin/swiftc -warnings-as-errors -parse-as-library -O "$TOOLS_DIR/transcode-recording.swift" -o "$TOOLS_DIR/bin/transcode-recording"
/usr/bin/swiftc -warnings-as-errors -parse-as-library -O "/Users/taoma/Documents/talk and talk/artifacts/practical-demo/support-ticket-20260827/tools/verify-video.swift" -o "$TOOLS_DIR/bin/verify-video"
echo "Built capture tools in $TOOLS_DIR/bin"
