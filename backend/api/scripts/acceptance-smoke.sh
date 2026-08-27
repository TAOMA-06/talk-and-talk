#!/usr/bin/env bash
#
# Local development acceptance test. It deliberately uses mock SMS and the
# mock WeChat provider; it is not a staging/production command and refuses any
# non-loopback target before its first HTTP request.
#
# Prerequisites:
#   - APP_ENV=development
#   - SMS_PROVIDER=mock
#   - a seeded database (`npm run db:seed`), including c1 and its owner
#   - a running API, PostgreSQL, and Redis
#
# The Mini Program payment channel requires a real, server-verified WeChat
# openid.  This script therefore exercises the same server-side order/payment
# lifecycle through the mock App channel, without fabricating WeChat identity.
# While IDENTITY-R01/R02 freezes every grant, the script proves the exact 403
# and stops before any order/payment write instead of bypassing the product gate.

set -euo pipefail
umask 077

BASE_URL="${1:-${BASE_URL:-http://127.0.0.1:3000}}"
BASE_URL="${BASE_URL%/}"
if [[ "${ACCEPTANCE_SMOKE_LOCAL_EXECUTION:-}" != "1" ]]; then
  printf 'Refusing acceptance smoke without ACCEPTANCE_SMOKE_LOCAL_EXECUTION=1. This mock script is development/loopback only.\n' >&2
  exit 2
fi
if [[ ! "$BASE_URL" =~ ^http://127\.0\.0\.1(:[0-9]{1,5})?$ ]]; then
  printf 'Refusing non-127.0.0.1 acceptance smoke target (%s). This mock script is development/local only.\n' "$BASE_URL" >&2
  exit 2
fi
CURL_BIN="/usr/bin/curl"
if [[ ! -x "$CURL_BIN" ]]; then
  printf 'Local acceptance smoke requires the trusted system curl executable.\n' >&2
  exit 2
fi
# A numeric loopback URL check is not sufficient on its own: a shell's proxy or
# curl config can redirect an otherwise local mock request. Every call below
# begins with `-q` and bypasses proxies, so user curl configuration cannot turn
# this local-only harness into an external write path.
unset ALL_PROXY all_proxy HTTP_PROXY http_proxy HTTPS_PROXY https_proxy NO_PROXY no_proxy
API_PREFIX="${API_PREFIX:-api/v1}"
API_PREFIX="${API_PREFIX#/}"
API_PREFIX="${API_PREFIX%/}"
API="$BASE_URL/$API_PREFIX"

# Use a fresh customer by default so repeat runs do not conflict with mock-SMS
# rate limits or prior orders. The companion/owner pair comes from seed.ts.
CUSTOMER_PHONE="${CUSTOMER_PHONE:-139$(date +%s | cut -c 3-10)}"
COMPANION_ID="${COMPANION_ID:-c1}"
COMPANION_OWNER_PHONE="${COMPANION_OWNER_PHONE:-13800000101}"
PAYMENT_CHANNEL="${PAYMENT_CHANNEL:-app}"
CHECK_CANCELLATION="${CHECK_CANCELLATION:-1}"
CHECK_REFUND="${CHECK_REFUND:-1}"
MOCK_SMS_RETRY_INTERVAL_SECONDS="${MOCK_SMS_RETRY_INTERVAL_SECONDS:-5}"
MOCK_SMS_MAX_ATTEMPTS="${MOCK_SMS_MAX_ATTEMPTS:-13}"

# These must match the server environment. Defaults match configuration.ts.
LEGAL_CONSENT_VERSION="${LEGAL_CONSENT_VERSION:-2.2-2026-08-01}"
LEGAL_PRIVACY_URL="${LEGAL_PRIVACY_URL:-https://api.talkandtalk.app/legal/privacy.html}"
LEGAL_TERMS_URL="${LEGAL_TERMS_URL:-https://api.talkandtalk.app/legal/terms.html}"

case "$PAYMENT_CHANNEL" in
  app|miniProgram) ;;
  *)
    printf 'PAYMENT_CHANNEL must be app or miniProgram\n' >&2
    exit 2
    ;;
esac

if [[ ! "$CUSTOMER_PHONE" =~ ^1[3-9][0-9]{9}$ ]] || [[ ! "$COMPANION_OWNER_PHONE" =~ ^1[3-9][0-9]{9}$ ]]; then
  printf 'CUSTOMER_PHONE and COMPANION_OWNER_PHONE must be valid mainland China mobile numbers\n' >&2
  exit 2
fi

if [[ ! "$COMPANION_ID" =~ ^[A-Za-z0-9_-]+$ ]]; then
  printf 'COMPANION_ID may contain only letters, digits, underscores, and hyphens\n' >&2
  exit 2
fi

if [[ ! "$MOCK_SMS_RETRY_INTERVAL_SECONDS" =~ ^[1-9][0-9]*$ ]] || [[ ! "$MOCK_SMS_MAX_ATTEMPTS" =~ ^[1-9][0-9]*$ ]]; then
  printf 'MOCK_SMS_RETRY_INTERVAL_SECONDS and MOCK_SMS_MAX_ATTEMPTS must be positive integers\n' >&2
  exit 2
fi
if (( (MOCK_SMS_MAX_ATTEMPTS - 1) * MOCK_SMS_RETRY_INTERVAL_SECONDS > 60 )); then
  printf 'Mock SMS retries must wait no more than 60 seconds in total\n' >&2
  exit 2
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/talk-and-talk-acceptance.XXXXXX")"
trap 'rm -f "$TMP_DIR"/*; rmdir "$TMP_DIR" 2>/dev/null || true' EXIT

say() {
  printf '==> %s\n' "$1"
}

# Writes responses only to a mode-0700 temp directory. Do not echo tokens,
# SMS codes, IDs, or raw API payloads to stdout.
api_request() {
  local name="$1"
  local method="$2"
  local path="$3"
  local token="${4:-}"
  local body="${5:-}"
  local allowed_error_code="${6:-}"
  local output="$TMP_DIR/$name.json"
  local status_file="$TMP_DIR/$name.status"
  local status
  local -a args=(-q --noproxy '*' --silent --show-error --connect-timeout 5 --max-time 30 --request "$method" "$API$path" --output "$output" --write-out '%{http_code}')

  if [[ -n "$token" ]]; then
    args+=(--header "Authorization: Bearer $token")
  fi
  if [[ -n "$body" ]]; then
    args+=(--header 'Content-Type: application/json' --data "$body")
  fi

  if ! status="$("$CURL_BIN" "${args[@]}")"; then
    printf 'Request failed: %s %s\n' "$method" "$path" >&2
    return 1
  fi
  printf '%s' "$status" > "$status_file"
  if [[ ! "$status" =~ ^2[0-9][0-9]$ ]]; then
    if [[ -n "$allowed_error_code" ]] && python3 - "$output" "$allowed_error_code" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    payload = json.load(source)
raise SystemExit(0 if payload.get("error", {}).get("code") == sys.argv[2] else 1)
PY
    then
      printf '%s\n' "$output"
      return 0
    fi
    printf 'Request failed: %s %s (HTTP %s)\n' "$method" "$path" "$status" >&2
    python3 - "$output" <<'PY' >&2 || true
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as source:
        payload = json.load(source)
    error = payload.get("error", {})
    code = error.get("code")
    message = error.get("message")
    if code or message:
        print(f"  {code or 'REQUEST_ERROR'}: {message or 'No public error message'}")
except (OSError, ValueError, TypeError):
    pass
PY
    return 1
  fi
  printf '%s\n' "$output"
}

# Read a dotted field below the API response envelope's data property.
json_data() {
  python3 - "$1" "$2" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    payload = json.load(source)

value = payload["data"]
for part in sys.argv[2].split("."):
    if not isinstance(value, dict) or part not in value:
        raise SystemExit(f"Missing response field: data.{sys.argv[2]}")
    value = value[part]

if value is None:
    print("")
elif isinstance(value, bool):
    print("true" if value else "false")
elif isinstance(value, (dict, list)):
    print(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
else:
    print(value)
PY
}

assert_health() {
  python3 - "$1" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    health = json.load(source)["data"]

assert health["status"] == "ok", health
assert health["dependencies"]["database"]["status"] == "ok", health
assert health["dependencies"]["redis"]["status"] == "ok", health
PY
}

make_consent_body() {
  python3 - "$LEGAL_CONSENT_VERSION" "$LEGAL_PRIVACY_URL" "$LEGAL_TERMS_URL" <<'PY'
import json
import sys
from datetime import datetime, timedelta, timezone

print(json.dumps({
    "version": sys.argv[1],
    "acceptedAt": (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat().replace("+00:00", "Z"),
    "privacyAccepted": True,
    "termsAccepted": True,
    "adultConfirmed": True,
    "privacyUrl": sys.argv[2],
    "termsUrl": sys.argv[3],
    "source": "wechatMiniProgram",
}, separators=(",", ":")))
PY
}

assert_consent_receipt() {
  python3 - "$1" "$2" "$LEGAL_CONSENT_VERSION" "$LEGAL_PRIVACY_URL" "$LEGAL_TERMS_URL" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    receipt = json.load(source)["data"]["receipt"]

assert receipt["userId"] == sys.argv[2], receipt
assert receipt["version"] == sys.argv[3], receipt
assert receipt["privacyUrl"] == sys.argv[4], receipt
assert receipt["termsUrl"] == sys.argv[5], receipt
assert receipt["privacyAccepted"] is True, receipt
assert receipt["termsAccepted"] is True, receipt
assert receipt["adultConfirmed"] is True, receipt
assert receipt["withdrawnAt"] is None, receipt
assert receipt["source"] == "wechatMiniProgram", receipt
PY
}

login_with_mock_sms() {
  local label="$1"
  local phone="$2"
  local sms_json login_json code status attempt=1

  while true; do
    if sms_json="$(api_request "$label-sms" POST '/auth/sms/send-code' '' "{\"phone\":\"$phone\"}" 2>/dev/null)"; then
      break
    fi
    status=''
    if [[ -f "$TMP_DIR/$label-sms.status" ]]; then
      status="$(<"$TMP_DIR/$label-sms.status")"
    fi
    if [[ "$status" != '429' || "$attempt" -ge "$MOCK_SMS_MAX_ATTEMPTS" ]]; then
      printf 'Mock SMS request failed for %s identity (HTTP %s).\n' "$label" "${status:-transport error}" >&2
      return 1
    fi
    say "Mock SMS rate limit for $label identity; retrying in ${MOCK_SMS_RETRY_INTERVAL_SECONDS}s ($attempt/$MOCK_SMS_MAX_ATTEMPTS)"
    sleep "$MOCK_SMS_RETRY_INTERVAL_SECONDS"
    attempt=$((attempt + 1))
  done
  code="$(json_data "$sms_json" 'devCode')"
  if [[ -z "$code" ]]; then
    printf 'Mock SMS did not return devCode. Start the API with APP_ENV=development and SMS_PROVIDER=mock.\n' >&2
    return 1
  fi

  login_json="$(api_request "$label-login" POST '/auth/phone/login' '' "{\"phone\":\"$phone\",\"code\":\"$code\"}")"
  AUTH_TOKEN="$(json_data "$login_json" 'accessToken')"
  AUTH_USER_ID="$(json_data "$login_json" 'user.id')"
  if [[ -z "$AUTH_TOKEN" || -z "$AUTH_USER_ID" ]]; then
    printf 'Mock phone login response did not contain a usable session.\n' >&2
    return 1
  fi
}

record_legal_consent() {
  local label="$1"
  local token="$2"
  local user_id="$3"
  local result
  result="$(api_request "$label-consent" POST '/users/me/legal-consents' "$token" "$(make_consent_body)")"
  assert_consent_receipt "$result" "$user_id"
}

make_order_body() {
  local scheduled_at="$1"
  python3 - "$COMPANION_ID" "$scheduled_at" <<'PY'
import json
import sys

print(json.dumps({
    "companionId": sys.argv[1],
    "themeId": "local-acceptance-smoke",
    "durationMinutes": 30,
    "scheduledAt": sys.argv[2],
}, separators=(",", ":")))
PY
}

future_schedule() {
  local days="$1"
  python3 - "$days" <<'PY'
import secrets
import sys
from datetime import datetime, timedelta, timezone

# Small randomized offset avoids overlap with records from a concurrent smoke run.
when = datetime.now(timezone.utc) + timedelta(days=int(sys.argv[1]), minutes=secrets.randbelow(240) + 1)
print(when.isoformat().replace("+00:00", "Z"))
PY
}

near_future_schedule() {
  python3 <<'PY'
import secrets
from datetime import datetime, timedelta, timezone

# Order intake reserves ten minutes for the companion response and five more
# for payment. Schedule just beyond that boundary, then let the test wait a few
# seconds for the default 15-minute paid-chat window to open.
when = datetime.now(timezone.utc) + timedelta(minutes=15, seconds=4 + secrets.randbelow(2))
print(when.isoformat().replace("+00:00", "Z"))
PY
}

assert_order_confirmed() {
  python3 - "$1" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    order = json.load(source)["data"]

assert order["status"] == "pending", order
assert order["companionConfirmedAt"], order
PY
}

assert_mock_prepay() {
  python3 - "$1" "$PAYMENT_CHANNEL" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    payment = json.load(source)["data"]["payment"]

assert payment["mock"] is True, payment
assert payment["channel"] == sys.argv[2], payment
assert payment["outTradeNo"], payment
if payment["channel"] == "app":
    assert payment["wechatAppParams"], payment
else:
    assert payment["wechatMiniProgramParams"], payment
PY
}

assert_payment_paid() {
  python3 - "$1" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    result = json.load(source)["data"]

assert result["code"] == "SUCCESS", result
assert result["data"]["orderStatus"] == "paid", result
PY
}

conversation_id_for_owner() {
  python3 - "$1" "$COMPANION_ID" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    conversations = json.load(source)["data"]["conversations"]

for conversation in conversations:
    if conversation.get("companionId") == sys.argv[2] and conversation.get("viewerRole") == "companion":
        print(conversation["id"])
        break
else:
    raise SystemExit("Owner cannot see the paid order conversation")
PY
}

assert_customer_conversation() {
  python3 - "$1" "$COMPANION_ID" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    conversations = json.load(source)["data"]["conversations"]

assert any(
    item.get("id") == sys.argv[2]
    and item.get("companionId") == sys.argv[2]
    and item.get("viewerRole") == "customer"
    for item in conversations
), conversations
PY
}

make_message_body() {
  python3 - "$1" <<'PY'
import json
import sys
print(json.dumps({"content": sys.argv[1]}, separators=(",", ":")))
PY
}

assert_message_response() {
  python3 - "$1" "$2" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    result = json.load(source)["data"]

assert result["moderation"]["decision"] == "allow", result
assert result["message"]["content"] == sys.argv[2], result
PY
}

assert_message_blocked() {
  python3 - "$1" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    result = json.load(source)["data"]

assert result["moderation"]["decision"] == "block", result
assert result["message"] is None, result
assert result["safetyMessage"] is not None, result
PY
}

assert_conversation_messages() {
  python3 - "$1" "$2" "$3" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    messages = json.load(source)["data"]["messages"]

contents = {message.get("content") for message in messages}
assert sys.argv[2] in contents, messages
assert sys.argv[3] in contents, messages
PY
}

assert_refund_success() {
  python3 - "$1" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    result = json.load(source)["data"]

assert result["refund"]["status"] == "success", result
assert result["order"]["status"] == "refunded", result
PY
}

assert_cancelled() {
  python3 - "$1" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    order = json.load(source)["data"]

assert order["status"] == "cancelled", order
assert order["cancelledAt"], order
PY
}

say 'Health: API, PostgreSQL, and Redis'
HEALTH_JSON="$(api_request health GET '/health')"
assert_health "$HEALTH_JSON"
APP_ENV="$(json_data "$HEALTH_JSON" 'appEnv')"
if [[ "$APP_ENV" == 'production' ]]; then
  printf 'Refusing to run acceptance smoke against APP_ENV=production.\n' >&2
  exit 1
fi
if [[ "$APP_ENV" != 'development' ]]; then
  printf 'Refusing non-development environment (%s). This mock script is development/loopback only.\n' "$APP_ENV" >&2
  exit 1
fi

say 'Seeded published companion is reachable'
COMPANION_JSON="$(api_request companion GET "/companions/$COMPANION_ID")"
if [[ "$(json_data "$COMPANION_JSON" 'isPublished')" != 'true' ]]; then
  printf 'Companion %s is not published. Run npm run db:seed or configure COMPANION_ID/COMPANION_OWNER_PHONE for a prepared development pair.\n' "$COMPANION_ID" >&2
  exit 1
fi

say 'Customer mock SMS login and legal-consent receipt'
login_with_mock_sms customer "$CUSTOMER_PHONE"
CUSTOMER_TOKEN="$AUTH_TOKEN"
CUSTOMER_ID="$AUTH_USER_ID"
record_legal_consent customer "$CUSTOMER_TOKEN" "$CUSTOMER_ID"

say 'Companion-owner mock SMS login and legal-consent receipt'
login_with_mock_sms owner "$COMPANION_OWNER_PHONE"
OWNER_TOKEN="$AUTH_TOKEN"
OWNER_ID="$AUTH_USER_ID"
record_legal_consent owner "$OWNER_TOKEN" "$OWNER_ID"

say 'Customer creates a future service order'
ORDER_JSON="$(api_request order-create POST '/orders' "$CUSTOMER_TOKEN" "$(make_order_body "$(near_future_schedule)")" 'PUBLIC_INTERACTION_IDENTITY_REQUIRED')"
if [[ "$(<"$TMP_DIR/order-create.status")" == "403" ]]; then
  say 'PASS: approved identity authority is absent; order and payment writes failed closed before creation'
  say 'Downstream mock transaction coverage remains in isolated tests behind an explicitly labelled test adapter; this run is not commercial acceptance'
  exit 0
fi
ORDER_ID="$(json_data "$ORDER_JSON" 'id')"

say 'Companion owner confirms the service order'
CONFIRM_JSON="$(api_request order-confirm POST "/orders/service/$ORDER_ID/confirm" "$OWNER_TOKEN")"
assert_order_confirmed "$CONFIRM_JSON"

say "Mock $PAYMENT_CHANNEL prepay and payment fulfillment"
PREPAY_JSON="$(api_request order-prepay POST "/orders/$ORDER_ID/prepay" "$CUSTOMER_TOKEN" "{\"channel\":\"$PAYMENT_CHANNEL\"}")"
assert_mock_prepay "$PREPAY_JSON"
OUT_TRADE_NO="$(json_data "$PREPAY_JSON" 'payment.outTradeNo')"
PAYMENT_JSON="$(api_request payment-notify POST '/payments/wechat/mock-notify' "$CUSTOMER_TOKEN" "{\"outTradeNo\":\"$OUT_TRADE_NO\"}")"
assert_payment_paid "$PAYMENT_JSON"
PAYMENT_SYNC_JSON="$(api_request payment-sync POST "/orders/$ORDER_ID/payment/sync" "$CUSTOMER_TOKEN")"
assert_payment_paid "$PAYMENT_SYNC_JSON"

# The order is intentionally scheduled just outside the intake cutoff above.
# This bounded wait exercises the real default chat boundary instead of
# weakening it through a test-only server configuration.
sleep 6

RUN_TAG="$(date +%s)-$$"
CUSTOMER_MESSAGE="本地验收客户消息-$RUN_TAG"
OWNER_MESSAGE="本地验收陪伴者回复-$RUN_TAG"

say 'Paid-order chat: customer can send and read'
CUSTOMER_CONVERSATIONS_JSON="$(api_request customer-conversations GET '/conversations' "$CUSTOMER_TOKEN")"
assert_customer_conversation "$CUSTOMER_CONVERSATIONS_JSON"
CUSTOMER_SEND_JSON="$(api_request customer-message POST "/conversations/$COMPANION_ID/messages" "$CUSTOMER_TOKEN" "$(make_message_body "$CUSTOMER_MESSAGE")")"
assert_message_response "$CUSTOMER_SEND_JSON" "$CUSTOMER_MESSAGE"

say 'Paid-order chat: companion owner can reply and read'
OWNER_CONVERSATIONS_JSON="$(api_request owner-conversations GET '/conversations' "$OWNER_TOKEN")"
OWNER_CONVERSATION_ID="$(conversation_id_for_owner "$OWNER_CONVERSATIONS_JSON")"
OWNER_SEND_JSON="$(api_request owner-message POST "/conversations/$OWNER_CONVERSATION_ID/messages" "$OWNER_TOKEN" "$(make_message_body "$OWNER_MESSAGE")")"
assert_message_response "$OWNER_SEND_JSON" "$OWNER_MESSAGE"
CUSTOMER_MESSAGES_JSON="$(api_request customer-messages GET "/conversations/$COMPANION_ID/messages" "$CUSTOMER_TOKEN")"
assert_conversation_messages "$CUSTOMER_MESSAGES_JSON" "$CUSTOMER_MESSAGE" "$OWNER_MESSAGE"
OWNER_MESSAGES_JSON="$(api_request owner-messages GET "/conversations/$OWNER_CONVERSATION_ID/messages" "$OWNER_TOKEN")"
assert_conversation_messages "$OWNER_MESSAGES_JSON" "$CUSTOMER_MESSAGE" "$OWNER_MESSAGE"

say 'Chat safety: off-platform contact is blocked'
BLOCKED_MESSAGE_JSON="$(api_request blocked-message POST "/conversations/$COMPANION_ID/messages" "$CUSTOMER_TOKEN" "$(make_message_body '加微信私下聊')")"
assert_message_blocked "$BLOCKED_MESSAGE_JSON"

if [[ "$CHECK_REFUND" == '1' ]]; then
  say 'Mock full refund and refund synchronization'
  REFUND_JSON="$(api_request refund POST "/orders/$ORDER_ID/refund" "$CUSTOMER_TOKEN" '{"reason":"LOCAL_ACCEPTANCE_SMOKE"}')"
  assert_refund_success "$REFUND_JSON"
  REFUND_SYNC_JSON="$(api_request refund-sync POST "/orders/$ORDER_ID/refund/sync" "$CUSTOMER_TOKEN")"
  assert_refund_success "$REFUND_SYNC_JSON"
fi

if [[ "$CHECK_CANCELLATION" == '1' ]]; then
  say 'Confirmed unpaid order cancellation'
  CANCEL_ORDER_JSON="$(api_request cancel-order-create POST '/orders' "$CUSTOMER_TOKEN" "$(make_order_body "$(future_schedule 3)")")"
  CANCEL_ORDER_ID="$(json_data "$CANCEL_ORDER_JSON" 'id')"
  CANCEL_CONFIRM_JSON="$(api_request cancel-order-confirm POST "/orders/service/$CANCEL_ORDER_ID/confirm" "$OWNER_TOKEN")"
  assert_order_confirmed "$CANCEL_CONFIRM_JSON"
  CANCEL_JSON="$(api_request order-cancel POST "/orders/$CANCEL_ORDER_ID/cancel" "$CUSTOMER_TOKEN")"
  assert_cancelled "$CANCEL_JSON"
fi

printf 'Acceptance smoke passed against %s (APP_ENV=%s; mock local business flow).\n' "$BASE_URL" "$APP_ENV"
