#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8787}"
BASE_URL="http://127.0.0.1:${PORT}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "== Talk&Talk BackendDemo 演示前自检 =="
echo

# Node version
NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])')"
if [[ "${NODE_MAJOR}" -lt 22 ]]; then
  echo "✗ Node.js 需要 >= 22，当前: $(node -v)"
  exit 1
fi
echo "✓ Node.js $(node -v)"

# .env check
if [[ -f "${ROOT_DIR}/.env" ]]; then
  if grep -q '^DEEPSEEK_API_KEY=.\+' "${ROOT_DIR}/.env" 2>/dev/null; then
    echo "✓ DEEPSEEK_API_KEY 已配置 (.env)"
  else
    echo "⚠ DEEPSEEK_API_KEY 未配置，将仅使用规则引擎"
  fi
else
  echo "⚠ 未找到 .env，请 cp .env.example .env 并填入 DEEPSEEK_API_KEY"
fi

# Health check
if ! curl -sf "${BASE_URL}/api/health" > /dev/null 2>&1; then
  echo "✗ 服务未响应: ${BASE_URL}/api/health"
  echo
  echo "请先在另一个终端启动服务："
  echo "  cd BackendDemo"
  echo "  npm start"
  exit 1
fi

HEALTH_JSON="$(curl -sf "${BASE_URL}/api/health")"
PARSED="$(node -e "
  const body = JSON.parse(process.argv[1]);
  const data = body.data || {};
  const mod = data.moderation || {};
  console.log([
    data.status ?? 'unknown',
    mod.connected ? 'ai' : 'rules',
    mod.model ?? 'n/a'
  ].join('|'));
" "${HEALTH_JSON}")"

IFS='|' read -r STATUS MODE MODEL <<< "${PARSED}"

if [[ "${STATUS}" != "ok" ]]; then
  echo "✗ 健康检查异常，status=${STATUS}"
  exit 1
fi
echo "✓ 服务健康 (${BASE_URL})"

if [[ "${MODE}" == "ai" ]]; then
  echo "✓ DeepSeek 已连接 (${MODEL})"
else
  echo "⚠ 当前为规则引擎兜底（DeepSeek 未连接）"
fi

echo
echo "准备就绪。请："
echo "  1. 浏览器打开 ${BASE_URL}"
echo "  2. 点击右上角「重置演示数据」"
echo "  3. 按 DEMO.md 开始演示"
