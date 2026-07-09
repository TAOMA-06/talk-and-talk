# Talk&Talk API

This is the production NestJS backend for Talk&Talk. The old Node demo backend has been removed and is no longer a runtime entrypoint.

## Local Development

```bash
cd services/api
cp .env.example .env
npm install
npx prisma migrate deploy
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
npm run prisma:deploy    # prod/docker: apply migrations
```

## Docker

```bash
docker compose up --build
```

Compose starts:

- `api` on port `3000` (runs `prisma migrate deploy` on startup)
- `postgres` on port `5432`
- `redis` on port `6379`

## Tests

```bash
npm run build
npm test
npm run test:e2e
```

E2E auth tests require Postgres and Redis. Start dependencies with `docker compose up postgres redis` before running `npm run test:e2e`.

## Current Capability

Completed:

- NestJS application entrypoint under `services/api`
- Global `/api/v1` prefix, request ID, response envelopes
- Environment validation, including JWT secrets in production
- `GET /api/v1/health` with Postgres and Redis dependency checks
- Prisma: users/auth, companions, conversations/messages, moderation cases/evidence/action logs, audit logs, labels
- Auth: phone SMS login (mock provider), Apple login, JWT refresh/logout, `GET /users/me`
- RBAC: `admin` for companions management; `moderator`/`admin` for moderation ops
- Chat send with RuleEngine + optional DeepSeek; case creation on non-allow
- Admin Moderation API: overview, filtered queue, detail, conversation evidence, actions, labels export
- User reports: `POST /moderation/reports`
- Web ops console at `/admin/` (static)

Not implemented yet:

- Orders, payments, notifications product APIs
- Real SMS (Aliyun/Tencent), WeChat Pay production wiring

Web 审核后台：启动后打开 `http://localhost:3000/admin/`。Seed 账号见 [docs/admin-moderation-api.md](../../docs/admin-moderation-api.md)。

Auth API details: [docs/auth-api.md](../../docs/auth-api.md)
