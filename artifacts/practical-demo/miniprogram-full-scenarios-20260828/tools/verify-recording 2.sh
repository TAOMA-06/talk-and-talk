#!/bin/zsh
set -euo pipefail
TOOLS_DIR=${0:A:h}
INPUT=""
CHAPTERS=""
OUTPUT_DIR=""
OVERWRITE=0
while (( $# > 0 )); do
  case "$1" in
    --input) INPUT="$2"; shift 2 ;;
    --chapters) CHAPTERS="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    --overwrite) OVERWRITE=1; shift ;;
    --help|-h) echo "Usage: verify-recording.sh --input final.mp4 --chapters chapters.json --output-dir dir [--overwrite]"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done
[[ "$INPUT" = /* && -f "$INPUT" && "$CHAPTERS" = /* && -f "$CHAPTERS" && "$OUTPUT_DIR" = /* ]] || { echo "Absolute input, chapters and output-dir are required" >&2; exit 1; }
[[ -x "$TOOLS_DIR/bin/verify-video" ]] || { echo "Run tools/build-tools.sh first" >&2; exit 1; }
mkdir -p "$OUTPUT_DIR"
TIMES=$(/usr/bin/python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(",".join(str(x["seconds"]) for x in d["chapters"]))' "$CHAPTERS")
args=(--input "$INPUT" --report "$OUTPUT_DIR/video-report.json" --contact-sheet "$OUTPUT_DIR/chapter-contact-sheet.png" --times "$TIMES")
(( OVERWRITE == 1 )) && args+=(--overwrite)
"$TOOLS_DIR/bin/verify-video" "${args[@]}"
/usr/bin/avmediainfo "$INPUT" --brief --metadata track > "$OUTPUT_DIR/avmediainfo.txt"
echo "report=$OUTPUT_DIR/video-report.json"
echo "contact_sheet=$OUTPUT_DIR/chapter-contact-sheet.png"
