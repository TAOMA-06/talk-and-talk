#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:3000}"
PHONE="${PHONE:-13800138999}"
API="$BASE_URL/api/v1"

echo "==> Health"
curl -fsS "$API/health" | tee /tmp/tat-health.json
grep -q '"status":"ok"' /tmp/tat-health.json || grep -q '"status":"degraded"' /tmp/tat-health.json

echo "==> Send SMS"
SEND_JSON=$(curl -fsS -X POST "$API/auth/sms/send-code" \
  -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$PHONE\"}")
CODE=$(python3 - "$SEND_JSON" <<'PY'
import json, sys
data = json.loads(sys.argv[1])["data"]
print(data.get("devCode") or "")
PY
)
if [[ -z "$CODE" ]]; then
  echo "devCode missing from send-code response; requires APP_ENV!=production and SMS_PROVIDER=mock" >&2
  exit 1
fi

echo "==> Phone login"
LOGIN_JSON=$(curl -fsS -X POST "$API/auth/phone/login" \
  -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$PHONE\",\"code\":\"$CODE\"}")
TOKEN=$(python3 - "$LOGIN_JSON" <<'PY'
import json, sys
print(json.loads(sys.argv[1])["data"]["accessToken"])
PY
)

echo "==> Companions"
curl -fsS -H "Authorization: Bearer $TOKEN" "$API/companions" >/dev/null

echo "==> Create order + prepay"
SCHEDULED_AT=$(python3 - <<'PY'
from datetime import datetime, timedelta, timezone
print((datetime.now(timezone.utc) + timedelta(hours=1)).isoformat().replace("+00:00", "Z"))
PY
)
ORDER_JSON=$(curl -fsS -X POST "$API/orders" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"companionId\":\"c1\",\"themeId\":\"t1\",\"durationMinutes\":30,\"scheduledAt\":\"$SCHEDULED_AT\"}")
ORDER_ID=$(python3 - "$ORDER_JSON" <<'PY'
import json, sys
print(json.loads(sys.argv[1])["data"]["id"])
PY
)
PREPAY_JSON=$(curl -fsS -X POST "$API/orders/$ORDER_ID/prepay" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{}')
OUT_TRADE_NO=$(python3 - "$PREPAY_JSON" <<'PY'
import json, sys
print(json.loads(sys.argv[1])["data"]["payment"]["outTradeNo"])
PY
)

echo "==> Mock notify"
curl -fsS -X POST "$API/payments/wechat/mock-notify" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"outTradeNo\":\"$OUT_TRADE_NO\"}" >/dev/null

echo "==> Chat allow"
curl -fsS -X POST "$API/conversations/c1/messages" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"content":"今天想聊聊工作压力","senderId":"smoke-user"}' >/dev/null

echo "==> Chat block"
BLOCK_JSON=$(curl -fsS -X POST "$API/conversations/c1/messages" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"content":"加微信私下聊","senderId":"smoke-user"}')
python3 - "$BLOCK_JSON" <<'PY'
import json, sys
data = json.loads(sys.argv[1])["data"]
assert data["moderation"]["decision"] == "block", data
print("block ok")
PY

echo "==> Metrics"
curl -fsS "$API/metrics" | grep -q talk_http_requests_total

echo "Acceptance smoke passed against $BASE_URL"
