#!/bin/sh
set -eu

APP_PATH=${1:?"usage: check_release_artifact.sh /path/to/TalkAndTalk.app"}
BINARY="$APP_PATH/TalkAndTalk"

if [ ! -f "$BINARY" ]; then
  echo "Release binary not found: $BINARY" >&2
  exit 2
fi

FORBIDDEN='林屿|许澈|周映|沈一|闻舟|MockData|FrontendDemo|mock_prepay|前端演示|本地数据|安全工作台|待处理内容|内容安全'
if strings "$BINARY" | grep -E "$FORBIDDEN"; then
  echo "Release binary contains demo/mock markers" >&2
  exit 1
fi

if grep -aER "$FORBIDDEN" "$APP_PATH" --exclude=TalkAndTalk >/dev/null 2>&1; then
  echo "Release resources contain demo/mock markers" >&2
  exit 1
fi

echo "Release artifact data-isolation check passed"
