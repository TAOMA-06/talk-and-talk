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
- Auth: phone SMS login (mock provider), Apple login, JWT refresh/logout, `GET /users/me` / `/me`
- RBAC: `admin` for companions management; `moderator`/`admin` for moderation ops
- Chat send with RuleEngine + production-required DeepSeek-compatible review; provider outages fail closed into human review
- Admin Moderation API: overview, filtered queue, detail, conversation evidence, actions, labels export
- User reports: `POST /moderation/reports`
- Orders + WeChat API v3 App/JSAPI prepay, notify verification/decryption, refund; mock only on staging/dev when real credentials are absent
- Notifications + account deletion request
- Web ops console at `/admin/` (static)
- Legal pages: `/legal/privacy.html`, `/legal/terms.html`

Deployment:

- `APP_ENV`：`development` / `staging` / `production`（控制 mock 支付、SMS、seed）
- `GET /api/v1/health` 含依赖状态与运行时 metrics
- `GET /api/v1/metrics` Prometheus 文本格式
- `docker compose -f ../../infra/docker-compose.prod.yml` + `infra/nginx/` 示例
- `scripts/db-backup.sh`、`scripts/acceptance-smoke.sh`、`scripts/production-smoke.sh`、deployment preflight
- Production checklist: [docs/production-checklist.md](../../docs/production-checklist.md)

Not implemented yet (see [NEXT_PHASE.md](../../NEXT_PHASE.md)):

- Real SMS (Aliyun/Tencent) production providers
- Real WeChat merchant/account verification on the target CloudBase environment
- WeChat certificate/private-key secret mount automation for the selected hosting account

Web 审核后台：启动后打开 `http://localhost:3000/admin/`。Seed 账号见 [docs/admin-moderation-api.md](../../docs/admin-moderation-api.md)。

Auth API details: [docs/auth-api.md](../../docs/auth-api.md)
