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
- Prisma schema: `User`, `AuthIdentity`, `UserProfile`, `VerificationCode`, `RefreshToken`
- Auth: phone SMS login (mock provider), Apple login, JWT refresh/logout, `GET /users/me`
- RBAC guards with `admin` example on `GET /admin/status`

Not implemented yet:

- Production chat and moderation endpoints
- Persistent conversations, messages, moderation cases, orders, payments, and notifications
- Real SMS (Aliyun/Tencent), WeChat Pay, DeepSeek integrations

The iOS app requires login before entering the main UI. It uses this service for auth and health checks, and marks `c1`, `c2`, and `c3` as backend-capable for chat. Until Day 4 chat/moderation compatibility endpoints are implemented, the app falls back to local chat and local moderation when backend chat calls fail.

Auth API details: [docs/auth-api.md](../../docs/auth-api.md)
