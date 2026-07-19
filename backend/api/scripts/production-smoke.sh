#!/usr/bin/env bash
# Production smoke — does NOT use mock SMS or mock-notify.
# Usage: ./scripts/production-smoke.sh https://api.talkandtalk.app
set -euo pipefail

BASE_URL="${1:-https://api.talkandtalk.app}"
API="$BASE_URL/api/v1"
: "${METRICS_TOKEN:?Set METRICS_TOKEN to the production metrics bearer token}"

echo "==> Health"
HEALTH=$(curl -fsS "$API/health")
echo "$HEALTH" | tee /tmp/tat-prod-health.json
echo "$HEALTH" | grep -Eq '"status":"(ok|degraded)"' || {
  echo "health status not ok/degraded" >&2
  exit 1
}

echo "==> Public legal documents"
curl -fsS "$BASE_URL/legal/privacy.html" >/dev/null
curl -fsS "$BASE_URL/legal/terms.html" >/dev/null

echo "==> SMS send-code must be unavailable (production uses WeChat Mini Program login)"
HTTP_CODE=$(curl -sS -o /tmp/tat-prod-sms.json -w "%{http_code}" \
  -X POST "$API/auth/sms/send-code" \
  -H 'Content-Type: application/json' \
  -d '{"phone":"13800138000"}' || true)
if [[ "$HTTP_CODE" != "503" && "$HTTP_CODE" != "400" && "$HTTP_CODE" != "403" ]]; then
  # 503 SMS_UNAVAILABLE expected; other 4xx also acceptable if blocked at edge
  echo "expected SMS unavailable HTTP 503/4xx, got $HTTP_CODE" >&2
  cat /tmp/tat-prod-sms.json >&2 || true
  exit 1
fi
if grep -q 'devCode' /tmp/tat-prod-sms.json 2>/dev/null; then
  echo "production must never return devCode" >&2
  exit 1
fi
echo "SMS blocked as expected (HTTP $HTTP_CODE)"

echo "==> Mock-notify must be disabled"
# Without JWT → 401; with production APP_ENV even authenticated calls return 403 MOCK_PAY_DISABLED
MOCK_CODE=$(curl -sS -o /tmp/tat-prod-mock.json -w "%{http_code}" \
  -X POST "$API/payments/wechat/mock-notify" \
  -H 'Content-Type: application/json' \
  -d '{"outTradeNo":"T_probe"}' || true)
if [[ "$MOCK_CODE" == "200" ]]; then
  echo "mock-notify must not succeed in production" >&2
  exit 1
fi
echo "mock-notify rejected as expected (HTTP $MOCK_CODE)"

echo "==> Metrics authentication"
METRICS_PUBLIC_CODE=$(curl -sS -o /dev/null -w "%{http_code}" "$API/metrics" || true)
if [[ "$METRICS_PUBLIC_CODE" == "200" ]]; then
  echo "metrics must not be readable without a bearer token" >&2
  exit 1
fi
METRICS_AUTH_CODE=$(curl -sS -o /tmp/tat-prod-metrics.txt -w "%{http_code}" \
  -H "Authorization: Bearer $METRICS_TOKEN" "$API/metrics" || true)
if [[ "$METRICS_AUTH_CODE" != "200" ]]; then
  echo "authenticated metrics probe failed (HTTP $METRICS_AUTH_CODE)" >&2
  exit 1
fi

echo "==> Production smoke OK"
