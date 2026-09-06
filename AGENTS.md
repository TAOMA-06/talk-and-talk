# AGENTS.md

## Cursor Cloud specific instructions

This repo is a monorepo for **Talk&Talk** (a WeChat-miniprogram + NestJS companionship service). The current release scope is the WeChat Mini Program and the NestJS backend; `frontend/web` is a runnable responsive web client used here to exercise the product end to end, and `frontend/ios` is historical/out of scope.

Standard setup, run, test, and migration commands are already documented — see the root `README.md` ("快速开始", "测试"), `backend/api/README.md`, `frontend/web/README.md`, and `frontend/miniprogram/README.md`. The notes below are only the non-obvious, cloud-environment caveats.

### Services and how they run
- **Backend API** (`backend/api`, NestJS) — the required core. Dev: `npm run start:dev` (listens on `http://127.0.0.1:3000`, all API routes under `/api/v1`). Needs PostgreSQL + Redis reachable.
- **Web client** (`frontend/web`, Next 16 / vinext on the Cloudflare Workers runtime) — dev: `npm run dev`. It is a server-side BFF: the browser never holds tokens; the worker proxies to the backend using `TALKTALK_API_BASE_URL` from `.dev.vars`.
- **Mini Program** (`frontend/miniprogram`, native TS) — no HTTP dev server; interactive runs need WeChat DevTools. Validate headlessly with `scripts/validate.mjs`, `scripts/smoke.mjs`, and `backend/api/node_modules/.bin/tsc -p frontend/miniprogram/tsconfig.json --noEmit` (the miniprogram has no local `tsc`; it reuses the backend's).

### Postgres & Redis are system services (not systemd-managed here)
The update script does NOT start databases. Postgres 16 and Redis are installed into the image. On a fresh VM they are usually not running yet — start them before running the backend:
```bash
sudo pg_ctlcluster 16 main start
sudo redis-server /etc/redis/redis.conf --daemonize yes
```
The dev DB is `talk_and_talk` owned by role `talk`/`talk` (matches `backend/api/.env.example`). The `talk` role has `CREATEDB` (needed so `prisma migrate dev` can create its shadow database). If the DB/role is ever missing, recreate with:
```bash
sudo -u postgres psql -c "CREATE ROLE talk LOGIN PASSWORD 'talk' CREATEDB;"
sudo -u postgres createdb -O talk talk_and_talk
```

### Backend env + DB init
Copy `backend/api/.env.example` to `backend/api/.env` (gitignored). It already points at `localhost:5432` / `localhost:6379`, uses `SMS_PROVIDER=mock` and `APP_ENV=development`. Then apply migrations and seed:
```bash
cd backend/api && npx prisma migrate deploy && npm run prisma:seed
```
Prefer `prisma migrate deploy` for a fresh clone. `npm run prisma:migrate` (`prisma migrate dev`) can hang non-interactively; if you kill it, its `schema-engine` child may keep a Postgres advisory lock — kill lingering `prisma`/`schema-engine` PIDs before retrying.

### Web client → local backend
The web BFF defaults to the production API. To point it at the local backend, set `TALKTALK_API_BASE_URL=http://127.0.0.1:3000/api/v1` in `frontend/web/.dev.vars` (copy from `.dev.vars.example`, which uses port `3101`). Also copy `.env.example` → `.env.local`. Port note: `vinext dev` wants port 3000 first; since the backend already uses 3000, the web dev server auto-shifts to **http://localhost:3001**.

### Mock SMS login (dev)
There are no real SMS codes. `POST /api/v1/auth/sms/send-code` (or the web BFF `POST /api/session/send-code`) returns the one-time code as `data.devCode` in development; the backend log masks it. Codes are valid ~300s and keyed by phone in Redis, so you can send via curl and enter the code in the browser.

### Booking requires adult-eligibility
Creating an order fails with "A current adult eligibility verification is required" until the logged-in customer has a current adult-eligibility record. In the web client this is completed via the `/verify-adult` page before booking.

### Known pre-existing issues (not environment problems, do not "fix" as setup)
- `npm run test:preflight` has 1 failing case: `OpenAPI covers every Nest route` reports `missing OpenAPI operation: get /health/ready` — the controller exposes `/health/ready` but `shared/contracts/openapi/v1.yaml` doesn't declare it. This is a committed source/contract mismatch on `main`.
- `backend/api/scripts/acceptance-smoke.sh` asserts `dependencies` on the public `GET /health`, but the current code only returns dependency detail on `GET /health/ready` (public `/health` is status-only). The script fails at the first health assertion against current code.
