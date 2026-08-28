#!/bin/zsh
set -euo pipefail
OUTPUT=""
FILES=()
while (( $# > 0 )); do
  case "$1" in
    --output) OUTPUT="$2"; shift 2 ;;
    --file) FILES+=("$2"); shift 2 ;;
    --help|-h) echo "Usage: checksums.sh --output checksums.sha256 --file path [--file path ...]"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done
[[ "$OUTPUT" = /* && ${#FILES[@]} -gt 0 ]] || { echo "Absolute --output and at least one --file are required" >&2; exit 1; }
mkdir -p "${OUTPUT:h}"
TMP="${OUTPUT}.tmp.$$"
: > "$TMP"
for FILE in "${FILES[@]}"; do
  [[ "$FILE" = /* && -f "$FILE" ]] || { echo "Missing file: $FILE" >&2; rm -f "$TMP"; exit 1; }
  /usr/bin/shasum -a 256 "$FILE" >> "$TMP"
done
mv "$TMP" "$OUTPUT"
cat "$OUTPUT"
