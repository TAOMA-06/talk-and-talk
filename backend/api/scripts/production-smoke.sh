#!/usr/bin/env bash
# Strict production smoke. It never uses mock SMS or mock payment fulfillment.
# Usage: ./scripts/production-smoke.sh https://api.talkandtalk.app
set -euo pipefail

BASE_URL="${1:-https://api.talkandtalk.app}"
API="$BASE_URL/api/v1"

echo "==> Health and dependencies"
HEALTH=$(curl -fsS "$API/health")
python3 - "$HEALTH" <<'PY'
import json, sys
data = json.loads(sys.argv[1])["data"]
assert data["status"] == "ok", data
assert data["dependencies"]["database"]["status"] == "ok", data
assert data["dependencies"]["redis"]["status"] == "ok", data
print(f"health ok: {data['service']} {data['version']}")
PY

echo "==> WeChat Mini Program configuration"
WECHAT_STATUS=$(curl -fsS "$API/auth/wechat/mini-program/status")
python3 - "$WECHAT_STATUS" <<'PY'
import json, sys
data = json.loads(sys.argv[1])["data"]
assert data == {"module": "wechatMiniProgram", "status": "configured", "configured": True}, data
print("Mini Program credentials are configured")
PY

echo "==> Real WeChat Pay provider"
PAYMENTS_STATUS=$(curl -fsS "$API/payments/status")
python3 - "$PAYMENTS_STATUS" <<'PY'
import json, sys
data = json.loads(sys.argv[1])["data"]
assert data["provider"] == "real", data
assert data["productionReady"] is True, data
assert data["status"] == "active", data
print("real WeChat Pay provider active")
PY

echo "==> Production SMS policy"
HTTP_CODE=$(curl -sS -o /tmp/tat-prod-sms.json -w "%{http_code}" \
  -X POST "$API/auth/sms/send-code" \
  -H 'Content-Type: application/json' \
  -d '{"phone":"13800138000"}' || true)
if [[ "$HTTP_CODE" != "503" ]]; then
  echo "expected SMS_UNAVAILABLE HTTP 503, got $HTTP_CODE" >&2
  cat /tmp/tat-prod-sms.json >&2 || true
  exit 1
fi
python3 - /tmp/tat-prod-sms.json <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)
assert payload["error"]["code"] == "SMS_UNAVAILABLE", payload
assert "devCode" not in json.dumps(payload), payload
PY

echo "==> Public legal pages"
curl -fsS "$BASE_URL/legal/privacy.html" >/dev/null
curl -fsS "$BASE_URL/legal/terms.html" >/dev/null

echo "==> Public metrics isolation"
METRICS_CODE=$(curl -sS -o /dev/null -w "%{http_code}" "$API/metrics" || true)
if [[ "$METRICS_CODE" == "200" && "${ALLOW_PUBLIC_METRICS:-false}" != "true" ]]; then
  echo "public metrics endpoint must be blocked (set ALLOW_PUBLIC_METRICS=true only for a private-network probe)" >&2
  exit 1
fi
echo "metrics HTTP $METRICS_CODE"

if [[ -n "${PRODUCTION_ACCESS_TOKEN:-}" ]]; then
  echo "==> Authenticated mock payment endpoint rejection"
  MOCK_CODE=$(curl -sS -o /tmp/tat-prod-mock.json -w "%{http_code}" \
    -X POST "$API/payments/wechat/mock-notify" \
    -H "Authorization: Bearer $PRODUCTION_ACCESS_TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{"outTradeNo":"T_probe"}' || true)
  [[ "$MOCK_CODE" == "403" ]] || {
    echo "expected MOCK_PAY_DISABLED HTTP 403, got $MOCK_CODE" >&2
    cat /tmp/tat-prod-mock.json >&2 || true
    exit 1
  }
else
  echo "Authenticated mock-notify probe skipped (set a short-lived PRODUCTION_ACCESS_TOKEN to enable)"
fi

echo "==> Production smoke OK"
