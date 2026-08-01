# Talk&Talk API

This is the production NestJS backend for Talk&Talk. The old Node demo backend has been removed and is no longer a runtime entrypoint.

## Local Development

```bash
cd backend/api
cp .env.example .env
npm install
# Postgres + Redis must be reachable (e.g. docker compose -f ../../infra/docker-compose.yml up -d postgres redis)
npm run prisma:migrate
npm run start:dev
```

The API listens on `http://localhost:3000` by default. The public prefix is `/api/v1`.

Health check:

```bash
curl -H 'x-request-id: day1-check' http://localhost:3000/api/v1/health
```

Auth smoke test (mock SMS logs code to server output):

```bash
curl -X POST http://localhost:3000/api/v1/auth/sms/send-code \
  -H 'Content-Type: application/json' \
  -d '{"phone":"13800138000"}'
```

All JSON responses use the same envelope:

```json
{
  "data": {},
  "meta": {
    "requestId": "day1-check",
    "timestamp": "2026-07-09T00:00:00.000Z"
  }
}
```

Errors use:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Cannot GET /api/v1/missing"
  },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-07-09T00:00:00.000Z"
  }
}
```

## Prisma

```bash
npm run prisma:generate
npm run prisma:migrate   # dev: create/apply migrations
npm run prisma:deploy    # prod/docker: apply committed migrations only
```

## Docker

From repo root:

```bash
docker compose -f infra/docker-compose.yml up --build
```

Compose starts:

- `api` on port `3000` (runs `prisma migrate deploy` on startup)
- `postgres` on port `5432`
- `redis` on port `6379`

## Tests

```bash
npm run build
npm test                 # unit
npm run test:preflight   # deployment preflight validator tests
npm run test:e2e         # integration-level HTTP tests (alias: test:integration)
npm run test:integration
```

E2E/integration tests require Postgres and Redis. Start dependencies with `docker compose -f infra/docker-compose.yml up postgres redis` (from repo root) before running them.

Acceptance smoke:

```bash
./scripts/acceptance-smoke.sh http://127.0.0.1:3000
```

This is a **development-only** closed-loop business-flow check. It requires a
healthy PostgreSQL/Redis pair, `SMS_PROVIDER=mock`, mock WeChat payment, and
the local seed data (`npm run db:seed`). It logs in an isolated customer and
the seeded `c1` companion owner (`13800000101`), records both legal-consent
receipts, creates and confirms an order, completes mock payment, verifies
two-way chat, then verifies refund and cancellation. It leaves those clearly
labelled test records in the development database.

The script intentionally uses the mock **App** payment channel by default:
Mini Program prepay correctly requires a real server-verified WeChat OpenID
and must be exercised separately with genuine WeChat authorization. Override
the non-secret test settings only when needed, for example
`COMPANION_ID`, `COMPANION_OWNER_PHONE`, `LEGAL_CONSENT_VERSION`, or
`CHECK_REFUND=0`. The seeded companion owner's fixed phone is protected by the
normal 60-second mock-SMS throttle; an immediate rerun waits and retries in
bounded five-second intervals instead of clearing Redis or weakening the
backend rate limit. Those controls only cover the per-phone throttle. The
separate SMS IP protection permits five sends per IP per hour, so more than two
full runs from the same local API process can still return `429`. For repeated
local acceptance runs, start a temporary API instance with a dedicated local
Redis logical database (for example `redis://127.0.0.1:6379/14`) and point the
script at that instance; do not clear the shared Redis database or lower the
production limit. `MOCK_SMS_RETRY_INTERVAL_SECONDS` and
`MOCK_SMS_MAX_ATTEMPTS` remain bounded to a combined 60 seconds.

Before a staging/production release, validate the filled environment file without printing secret values:

```bash
npm run preflight:deployment -- .env.production
```

## Immutable order refund policy snapshots

Every newly created order stores `refundPolicyVersionSnapshot` and
`refundRequestWindowHoursSnapshot`. Order completion derives
`refundRequestDeadlineAt` only from that immutable snapshot; refund and payout
eligibility fail closed if the snapshot is absent, invalid, or inconsistent with
the exact deadline. A repeated `clientRequestId` returns the original order and
its original snapshot even after the configured policy changes.

Commercial mode requires an externally approved `REFUND_POLICY_VERSION`,
`REFUND_POLICY_APPROVED=true`, a non-secret `REFUND_POLICY_APPROVAL_REFERENCE`,
and a bounded `REFUND_REQUEST_WINDOW_HOURS` from 1 through 720. The production
example intentionally remains unapproved. The Mini Program must show the exact
order snapshot, support boundary, and terms link before payment; it blocks payment
when the snapshot is malformed. Migration `20260801007500_order_refund_policy_snapshots`
labels deterministic legacy rows explicitly and does not turn those labels into
commercial approval evidence.

Run the static contract test as part of `npm run test:preflight`. To replay all
earlier migrations and exercise the backfill, constraints, and immutability trigger
against a disposable PostgreSQL database, use:

```bash
REFUND_POLICY_MIGRATION_TEST_DATABASE_URL=postgresql://... \
  node --test scripts/order-refund-policy-snapshots.test.mjs
```

## WeChat daily financial reconciliation

Commercial traffic requires explicit, approved T+1 reconciliation configuration. Set
`WECHAT_DAILY_BILL_RECONCILIATION_START_DATE=YYYY-MM-DD` to the finance-approved first
coverage date together with the enabled flag, approval flag, non-secret approval
reference, Shanghai availability hour, and batch size. The worker schedules every
fetchable date × `tradeAll`, `fundBasic`, `fundOperation`, and `fundFees`; its automatic
provider catch-up is bounded to the latest 90 days, while older configured gaps remain
visible blockers and are never silently discarded.

The release gate stays closed for any missing/incomplete run, any historical open or
investigating issue, a pending independent resolution review, or a successful WeChat
payment/refund missing its immutable provider event times. Refund application/acceptance
(`providerRefundAcceptedAt`) and success (`providerRefundSucceededAt`) are separate facts;
success cannot predate acceptance and local timestamps are never substituted. Fund rows preserve business
name/type and fail closed on unknown or fee semantics; BASIC account payments/refunds are
checked in both directions for binding, account, direction, amount, and local settlement.
An assigned finance operator may only submit an evidence reference plus SHA-256 proposal;
a different reviewer must approve it, and only a different admin may approve an accepted
exception. Local timestamps and direct issue closure are not release evidence.

For dates older than the signed API 90-day window, finance may submit an official WeChat
merchant-platform export through the bounded merchant-import routes. The date must remain
within the platform's five-year history window. Only one Shanghai bill day is accepted even
though the platform can export up to 31 merged days; the text route accepts at most 20 MiB.
The server recomputes both content and normalized SHA-256 values, persists normalized facts
only, and requires a different reviewer. Raw CSV content is not stored, returned, or audited.

Successful payments and refunds append an immutable `CashLedgerEntry` with
`accountType=UNCLASSIFIED`. Provider reference, source, direction, and amount cannot be
edited. One finance/admin operator proposes the WeChat account and expected statement date;
a second operator approves or rejects it. Pending bill imports and unclassified cash entries
are explicit release-gate blockers.

The finance migration contract can be checked without a database:

```bash
node --test scripts/finance-terminal-audit-controls.test.mjs
```

To exercise real PostgreSQL row locks and approval/append races, point the same test at a
disposable database. It creates and drops only a random schema and applies migrations through
`20260731239000_finance_terminal_audit_controls` inside that schema:

```bash
FINANCE_MIGRATION_TEST_DATABASE_URL=postgresql://... \
  node --test scripts/finance-terminal-audit-controls.test.mjs
```

## API contract (frozen v1)

Machine-readable OpenAPI: [shared/contracts/openapi/v1.yaml](../../shared/contracts/openapi/v1.yaml)  
Rules: [shared/contracts/README.md](../../shared/contracts/README.md)

## Current Capability

Completed (v0.1 ship scope):

- NestJS application entrypoint under `backend/api`
- Global `/api/v1` prefix, request ID, response envelopes
- Environment validation, including JWT secrets in production
- `GET /api/v1/health` with Postgres and Redis dependency checks
- Prisma: users/auth, companions, conversations/messages, moderation cases/evidence/action logs, audit logs, labels
- Auth: WeChat Mini Program login for the current release, development/staging phone SMS, historical Apple login, JWT refresh/logout, legal consent and locked-account recovery routes
- RBAC: commercial staff roles (`support`, `finance`, `supply`, `operations`, `admin`) are separate from independent `ReviewStaff` (`reviewer`, `lead`); neither token family is accepted by the other workbench
- Chat send with local RuleEngine + authorized human review; user-authored content is not transmitted to DeepSeek or another external generative-AI service
- Independent Review Department API: `/api/v1/review/*` overview, filtered queue, detail, controlled evidence, actions, appeals, labels and snapshot-paginated export
- User reports: `POST /moderation/reports`
- Orders + WeChat API v3 App/JSAPI/Native QR prepay, notify verification/decryption, refund; mock only on staging/dev when real credentials are absent
- Durable in-app/WeChat transactional notifications, bounded multi-replica delivery claims, user channel status, and a separately gated availability-reminder pipeline that never auto-resends an uncertain one-time message
- Account deletion request/status, two-person approval, bounded phased erasure, retention ledger, lease/retry recovery and audited operations retry
- Companion self-service onboarding, services, recurring/one-off availability, today schedule, earnings/restrictions workbench, explainable recommendations, and the gated order-level TRTC code path
- Commercial operations console at `/admin/` and independent review workbench at `/review/` (static shells backed by protected APIs)
- Legal pages: `/legal/privacy.html`, `/legal/terms.html`

Deployment:

- `APP_ENV`：`development` / `staging` / `production`（控制 mock 支付、SMS、seed）
- `GET /api/v1/health` 含依赖状态与运行时 metrics
- `GET /api/v1/metrics` Prometheus 文本格式
- `docker compose -f ../../infra/docker-compose.prod.yml` + `infra/nginx/` 示例
- `scripts/db-backup.sh`、`scripts/acceptance-smoke.sh`、`scripts/production-smoke.sh`、deployment preflight
- Production checklist: [docs/production-checklist.md](../../docs/production-checklist.md)

External release gates and later adapters (see [NEXT_PHASE.md](../../NEXT_PHASE.md)):

- Real SMS (Aliyun/Tencent) production providers
- Real WeChat merchant/account verification on the target CloudBase environment
- WeChat certificate/private-key secret mount automation for the selected hosting account

商业运营后台：启动后打开 `http://localhost:3000/admin/`；独立审核工作台打开 `http://localhost:3000/review/`。审核员使用独立密码 + TOTP，不复用用户或商业员工 seed 身份，初始化见 [docs/review-department.md](../../docs/review-department.md)。

Auth API details: [docs/auth-api.md](../../docs/auth-api.md)
