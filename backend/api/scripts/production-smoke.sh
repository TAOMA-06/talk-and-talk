#!/usr/bin/env bash
# Strict production smoke. It never uses mock SMS or mock payment fulfillment.
# Usage: ./scripts/production-smoke.sh https://api.talkandtalk.app
set -euo pipefail

BASE_URL="${1:-https://api.talkandtalk.app}"
API="$BASE_URL/api/v1"
: "${METRICS_TOKEN:?Set METRICS_TOKEN to the production metrics bearer token}"
: "${PRODUCTION_ADMIN_ACCESS_TOKEN:?Set a short-lived production admin access token}"

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

echo "==> Real content moderation provider"
MODERATION_STATUS=$(curl -fsS "$API/moderation/status")
python3 - "$MODERATION_STATUS" <<'PY'
import json, sys
data = json.loads(sys.argv[1])["data"]
assert data["status"] == "active", data
assert data["aiConfigured"] is True, data
PY
MODERATION_CHECK=$(curl -fsS \
  -X POST "$API/moderation/check" \
  -H "Authorization: Bearer $PRODUCTION_ADMIN_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"text":"生产发布审核提供方连通性检查，不包含用户数据。","source":"profile"}')
python3 - "$MODERATION_CHECK" <<'PY'
import json, sys
data = json.loads(sys.argv[1])["data"]["moderation"]
assert data["usedAI"] is True, data
print("production content moderation provider responded with a valid schema")
PY

echo "==> Commercial operational readiness"
COMMERCIAL_READINESS=$(curl -fsS \
  -H "Authorization: Bearer $PRODUCTION_ADMIN_ACCESS_TOKEN" \
  "$API/admin/commercial/readiness")
python3 - "$COMMERCIAL_READINESS" <<'PY'
import json, sys
data = json.loads(sys.argv[1])["data"]
assert data["status"] == "clear", data
assert all(value == 0 for value in data["blockers"].values()), data
print("commercial operational readiness is clear")
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
PRIVACY_HTML=$(curl -fsS "$API/legal/privacy")
TERMS_HTML=$(curl -fsS "$API/legal/terms")
STATIC_PRIVACY_HTML=$(curl -fsSL "$BASE_URL/legal/privacy.html")
STATIC_TERMS_HTML=$(curl -fsSL "$BASE_URL/legal/terms.html")
printf '%s' "$PRIVACY_HTML" | grep -q "个人信息处理者"
printf '%s' "$TERMS_HTML" | grep -q "平台撮合"
printf '%s' "$STATIC_PRIVACY_HTML" | grep -q "个人信息处理者"
printf '%s' "$STATIC_TERMS_HTML" | grep -q "平台撮合"
curl -fsS "$API/legal/platform-rules" | grep -q "平台规则"
if [[ ! "$PRIVACY_HTML" =~ 版本[[:space:]]([A-Za-z0-9._-]+) ]]; then
  echo "could not determine the published legal document version" >&2
  exit 1
fi
LEGAL_VERSION="${BASH_REMATCH[1]}"
curl -fsS "$API/legal/privacy/versions/$LEGAL_VERSION" | grep -q "个人信息处理者"
curl -fsS "$API/legal/terms/versions/$LEGAL_VERSION" | grep -q "平台撮合"

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
