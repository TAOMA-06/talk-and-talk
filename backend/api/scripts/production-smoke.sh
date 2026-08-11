#!/usr/bin/env bash
# Controlled production smoke. It is read-only: it never uses mock SMS or
# mock-payment fulfillment. A syntactically valid Evidence ID is only an
# auditable reference, not proof that an external authorization exists.
# Usage requires a separately approved per-action record; this script fails
# before its first HTTP request if that record's non-secret bindings are absent.
set -euo pipefail

BASE_URL="${1:-}"
if [[ -z "$BASE_URL" ]]; then
  echo "Usage: $0 <approved https API origin>" >&2
  exit 2
fi
BASE_URL="${BASE_URL%/}"
API="$BASE_URL/api/v1"
CURL_BIN="/usr/bin/curl"
PYTHON_BIN="/usr/bin/python3"

if [[ ! -x "$CURL_BIN" || ! -x "$PYTHON_BIN" ]]; then
  echo "controlled production smoke requires trusted system curl and python executables" >&2
  exit 2
fi
# Do not let a shell's ambient proxy configuration receive short-lived bearer
# tokens. An approved target must be contacted directly over HTTPS. Every curl
# call below begins with `-q`, which disables user-provided curl configuration
# before it can alter the method, destination, headers, or proxy behavior.
unset ALL_PROXY all_proxy HTTP_PROXY http_proxy HTTPS_PROXY https_proxy NO_PROXY no_proxy

: "${PRODUCTION_SMOKE_AUTHORIZATION_EVIDENCE:?Set the non-secret per-action Evidence ID}"
: "${PRODUCTION_SMOKE_AUTHORIZATION_EXPIRES_AT:?Set the UTC expiry from the approved action record}"
: "${PRODUCTION_SMOKE_ALLOWED_BASE_URL:?Set the exact approved API origin}"

if [[ ! "$PRODUCTION_SMOKE_AUTHORIZATION_EVIDENCE" =~ ^E[A-Z0-9]*(-[A-Z0-9][A-Z0-9._-]*)+$ ]]; then
  echo "PRODUCTION_SMOKE_AUTHORIZATION_EVIDENCE must be a canonical non-secret Evidence ID" >&2
  exit 2
fi
if [[ ! "$BASE_URL" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]]; then
  echo "approved production smoke target must be an HTTPS origin without path, query, credentials, or fragment" >&2
  exit 2
fi
if [[ "$BASE_URL" != "$PRODUCTION_SMOKE_ALLOWED_BASE_URL" ]]; then
  echo "production smoke target does not match the approved action record" >&2
  exit 2
fi
"$PYTHON_BIN" - "$PRODUCTION_SMOKE_AUTHORIZATION_EXPIRES_AT" <<'PY'
from datetime import datetime, timezone
import sys

value = sys.argv[1]
if not value.endswith("Z"):
    raise SystemExit("PRODUCTION_SMOKE_AUTHORIZATION_EXPIRES_AT must be RFC3339 UTC with Z")
try:
    expiry = datetime.fromisoformat(value.replace("Z", "+00:00"))
except ValueError as error:
    raise SystemExit(f"PRODUCTION_SMOKE_AUTHORIZATION_EXPIRES_AT must be RFC3339 UTC: {error}")
if expiry.tzinfo is None or expiry.utcoffset() is None:
    raise SystemExit("PRODUCTION_SMOKE_AUTHORIZATION_EXPIRES_AT must include an offset")
if expiry.astimezone(timezone.utc) <= datetime.now(timezone.utc):
    raise SystemExit("production smoke authorization is expired")
PY

: "${METRICS_TOKEN:?Set METRICS_TOKEN to the production metrics bearer token}"
: "${PRODUCTION_ADMIN_ACCESS_TOKEN:?Set a short-lived production admin access token}"

echo "==> Health liveness and authenticated readiness"
HEALTH=$("$CURL_BIN" -q --noproxy '*' -fsS "$API/health")
"$PYTHON_BIN" - "$HEALTH" <<'PY'
import json, sys
data = json.loads(sys.argv[1])["data"]
assert data["status"] == "ok", data
assert "dependencies" not in data, data
print(f"health liveness ok: {data['service']} {data['version']}")
PY

READY=$("$CURL_BIN" -q --noproxy '*' -fsS -H "Authorization: Bearer $METRICS_TOKEN" "$API/health/ready")
"$PYTHON_BIN" - "$READY" <<'PY'
import json, sys
data = json.loads(sys.argv[1])["data"]
assert data["status"] == "ok", data
assert data["dependencies"]["database"]["status"] == "ok", data
assert data["dependencies"]["redis"]["status"] == "ok", data
assert data.get("appEnv") == "production", data
print("health ready ok: env=production")
PY

echo "==> WeChat Mini Program configuration"
WECHAT_STATUS=$("$CURL_BIN" -q --noproxy '*' -fsS "$API/auth/wechat/mini-program/status")
"$PYTHON_BIN" - "$WECHAT_STATUS" <<'PY'
import json, sys
data = json.loads(sys.argv[1])["data"]
assert data == {"module": "wechatMiniProgram", "status": "configured", "configured": True}, data
print("Mini Program credentials are configured")
PY

echo "==> Real WeChat Pay provider"
PAYMENTS_STATUS=$("$CURL_BIN" -q --noproxy '*' -fsS "$API/payments/status")
"$PYTHON_BIN" - "$PAYMENTS_STATUS" <<'PY'
import json, sys
data = json.loads(sys.argv[1])["data"]
assert data["provider"] == "real", data
assert data["productionReady"] is True, data
assert data["status"] == "active", data
print("real WeChat Pay provider active")
PY

echo "==> Local-only user-content moderation privacy boundary"
MODERATION_STATUS=$("$CURL_BIN" -q --noproxy '*' -fsS "$API/moderation/status")
"$PYTHON_BIN" - "$MODERATION_STATUS" <<'PY'
import json, sys
data = json.loads(sys.argv[1])["data"]
assert data["status"] == "active", data
assert data["aiConfigured"] is False, data
assert data["externalProvider"] is None, data
assert data["externalUserContentTransmission"] is False, data
assert data["sensitiveContentProcessing"] == "local-rules-and-human-review", data
print("user-authored content remains on local rules and authorized human review")
PY

echo "==> Commercial operational readiness"
COMMERCIAL_READINESS=$("$CURL_BIN" -q --noproxy '*' -fsS \
  -H "Authorization: Bearer $PRODUCTION_ADMIN_ACCESS_TOKEN" \
  "$API/admin/commercial/readiness")
"$PYTHON_BIN" - "$COMMERCIAL_READINESS" <<'PY'
import json, sys
data = json.loads(sys.argv[1])["data"]
assert data["status"] == "clear", data
assert all(value == 0 for value in data["blockers"].values()), data
print("commercial operational readiness is clear")
PY

echo "==> Public legal pages"
PRIVACY_HTML=$("$CURL_BIN" -q --noproxy '*' -fsS "$API/legal/privacy")
TERMS_HTML=$("$CURL_BIN" -q --noproxy '*' -fsS "$API/legal/terms")
STATIC_PRIVACY_HTML=$("$CURL_BIN" -q --noproxy '*' -fsSL "$BASE_URL/legal/privacy.html")
STATIC_TERMS_HTML=$("$CURL_BIN" -q --noproxy '*' -fsSL "$BASE_URL/legal/terms.html")
printf '%s' "$PRIVACY_HTML" | grep -q "个人信息处理者"
printf '%s' "$TERMS_HTML" | grep -q "平台撮合"
printf '%s' "$STATIC_PRIVACY_HTML" | grep -q "个人信息处理者"
printf '%s' "$STATIC_TERMS_HTML" | grep -q "平台撮合"
"$CURL_BIN" -q --noproxy '*' -fsS "$API/legal/platform-rules" | grep -q "平台规则"
if [[ ! "$PRIVACY_HTML" =~ 版本[[:space:]]([A-Za-z0-9._-]+) ]]; then
  echo "could not determine the published legal document version" >&2
  exit 1
fi
LEGAL_VERSION="${BASH_REMATCH[1]}"
"$CURL_BIN" -q --noproxy '*' -fsS "$API/legal/privacy/versions/$LEGAL_VERSION" | grep -q "个人信息处理者"
"$CURL_BIN" -q --noproxy '*' -fsS "$API/legal/terms/versions/$LEGAL_VERSION" | grep -q "平台撮合"

echo "==> Metrics authentication"
METRICS_PUBLIC_CODE=$("$CURL_BIN" -q --noproxy '*' -sS -o /dev/null -w "%{http_code}" "$API/metrics" || true)
if [[ "$METRICS_PUBLIC_CODE" == "200" ]]; then
  echo "metrics must not be readable without a bearer token" >&2
  exit 1
fi
METRICS_AUTH_CODE=$("$CURL_BIN" -q --noproxy '*' -sS -o /tmp/tat-prod-metrics.txt -w "%{http_code}" \
  -H "Authorization: Bearer $METRICS_TOKEN" "$API/metrics" || true)
if [[ "$METRICS_AUTH_CODE" != "200" ]]; then
  echo "authenticated metrics probe failed (HTTP $METRICS_AUTH_CODE)" >&2
  exit 1
fi

echo "==> Controlled read-only production smoke OK"
