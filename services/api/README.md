# Talk&Talk API

This is the production NestJS backend for Talk&Talk. The old Node demo backend has been removed and is no longer a runtime entrypoint.

## Local Development

```bash
cd services/api
cp .env.example .env
npm install
npm run start:dev
```

The API listens on `http://localhost:3000` by default. The public prefix is `/api/v1`.

Health check:

```bash
curl -H 'x-request-id: day1-check' http://localhost:3000/api/v1/health
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

## Docker

```bash
docker compose up --build
```

Compose starts:

- `api` on port `3000`
- `postgres` on port `5432`
- `redis` on port `6379`

## Tests

```bash
npm run build
npm test
npm run test:e2e
```

## Current Capability

Completed in Day 1:

- NestJS application entrypoint under `services/api`
- Global `/api/v1` prefix
- Request ID middleware with `x-request-id` response header
- Success and error response envelopes
- Environment validation, including explicit production CORS origins
- CORS configured from `CORS_ORIGINS`
- `GET /api/v1/health` with Postgres and Redis dependency checks
- Module skeletons for auth, users, companions, conversations, moderation, orders, payments, admin, notifications, and health

Not implemented yet:

- Login, JWT issuance, refresh tokens, and user sessions
- Production chat and moderation endpoints
- Persistent conversations, messages, moderation cases, orders, payments, and notifications
- DeepSeek, SMS, WeChat Pay, and Apple Sign-In integrations

The iOS app currently points at this service for health checks and marks `c1`, `c2`, and `c3` as backend-capable. Until the Day 4 chat/moderation compatibility endpoints are implemented, the app falls back to local chat and local moderation when backend chat calls fail.
