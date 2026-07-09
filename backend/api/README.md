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
npm run test:e2e         # integration-level HTTP tests (alias: test:integration)
npm run test:integration
```

E2E/integration tests require Postgres and Redis. Start dependencies with `docker compose -f infra/docker-compose.yml up postgres redis` (from repo root) before running them.

Acceptance smoke:

```bash
./scripts/acceptance-smoke.sh http://127.0.0.1:3000
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
- Chat send with RuleEngine + optional DeepSeek; case creation on non-allow
- Admin Moderation API: overview, filtered queue, detail, conversation evidence, actions, labels export
- User reports: `POST /moderation/reports`
- Orders + WeChat prepay path (mock on staging/dev)
- Notifications + account deletion request
- Web ops console at `/admin/` (static)
- Legal pages: `/legal/privacy.html`, `/legal/terms.html`

Deployment:

- `APP_ENV`：`development` / `staging` / `production`（控制 mock 支付、SMS、seed）
- `GET /api/v1/health` 含依赖状态与运行时 metrics
- `GET /api/v1/metrics` Prometheus 文本格式
- `docker compose -f ../../infra/docker-compose.prod.yml` + `infra/nginx/` 示例
- `scripts/db-backup.sh`、`scripts/acceptance-smoke.sh`
- Production checklist: [docs/production-checklist.md](../../docs/production-checklist.md)

Not implemented yet (see [NEXT_PHASE.md](../../NEXT_PHASE.md)):

- Real SMS (Aliyun/Tencent) production providers
- WeChat Pay production prepay + platform-cert verification end-to-end
- WeChat cert automation mount in compose

Web 审核后台：启动后打开 `http://localhost:3000/admin/`。Seed 账号见 [docs/admin-moderation-api.md](../../docs/admin-moderation-api.md)。

Auth API details: [docs/auth-api.md](../../docs/auth-api.md)
