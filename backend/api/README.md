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
npm run test:preflight:static # zero-skip static preflight
# test:preflight 的 PostgreSQL 部分和 test:e2e/test:integration 必须由获授权的 sealed runner 创建目标
```

E2E/integration tests require a dedicated disposable Postgres database and
Redis instance. They refuse to run unless `NODE_ENV=test`, both explicit reset
grants, a canonical non-secret `E2E_EXECUTION_AUTHORIZATION_EVIDENCE` reference,
loopback transports, a per-run ID/token, and a PostgreSQL database named
exactly `talk_and_talk_<run-id>_e2e` are present. The Evidence ID is an audit
handle for an operator or CI authorization; the repository only validates its
format and must not be treated as proof that the referenced approval exists.
Test data is fixed to Redis DB `15`; the matching ownership marker lives on the
same Redis transport in DB `14`, so a test flush cannot erase its own proof of
ownership. Both the PostgreSQL and Redis markers must match the current run ID,
token hash, and resource identities before a migration, `deleteMany`, or Redis
flush can run.
Run the regression suite without connecting to a service:

```bash
npm run test:e2e:guard
```

`npm run assert:e2e:environment` validates the current variables without
connecting (including rejection of `?host=`/`?path=` overrides). `npm run
verify:e2e:ownership` reads the two matching markers. Before either marker is
written, the low-level claim command re-parses the raw environment and rejects
any PostgreSQL target with user objects and any Redis DB `15` with data, so a
name/token or caller-constructed target alone cannot authorize cleanup of a
pre-existing test target. The low-level marker commands are runner/CI plumbing,
not a manual environment-provisioning workflow.

```bash
npm run assert:e2e:environment
```

For local E2E, use the runner instead of the shared development compose stack.
This is an externally authorized action, not a developer convenience command.
Before any Docker activity, the approved record must bind a fresh local target,
the exact candidate SHA and canonical source-tree SHA-256, a protected-environment
approval reference, a trusted absolute Node executable, immutable PostgreSQL/Redis
`@sha256` inputs already present on the local daemon, their infrastructure-custody
Evidence ID, and one new external receipt path. The per-run execution Evidence ID
must either equal the protected approval reference or extend it as
`<approval-reference>-CI-<nonempty-evidence-suffix>`; it is still an audit handle,
not proof that the external approval exists. The following is an input shape only;
do not execute it without that approval:

```bash
E2E_CANDIDATE_SHA=<40-lowercase-hex> \
E2E_CANDIDATE_SOURCE_TREE_SHA256=<64-lowercase-hex> \
E2E_ENVIRONMENT_APPROVAL_REFERENCE=E1-LOCAL-E2E-APPROVED \
E2E_EXECUTION_AUTHORIZATION_EVIDENCE=E1-LOCAL-E2E-APPROVED-CI-API-E2E-1 \
E2E_INFRA_IMAGES_EVIDENCE=E1-INFRA-IMAGES-CUSTODY \
E2E_POSTGRES_IMAGE=postgres@sha256:<approved-digest> \
E2E_REDIS_IMAGE=redis@sha256:<approved-digest> \
E2E_RUNNER_NODE_EXECUTABLE=/absolute/path/to/trusted/node \
E2E_RECEIPT_OUT=/absolute/external-evidence-directory/e2e-receipt.json \
E2E_RUNNER_SUITE=e2e \
DOCKER_HOST=unix:///path/to/docker.sock \
/bin/sh backend/api/scripts/run-isolated-e2e.sh
```

It creates a randomly named Docker Compose project with a new loopback-only
PostgreSQL database and Redis instance, creates and verifies its matching
ownership markers, runs committed migrations and E2E, then removes only that
project and its volumes. It rejects a mutable/missing image, verifies exact
local RepoDigests before and after, and invokes Compose with `--pull never`
and `--no-build`. It requires an explicit Unix-socket address; remote,
tunnelable TCP, mutable Docker contexts, and Windows/npipe transports are
rejected. A Unix socket is only a local transport constraint; it does not prove
the daemon itself is not a deliberately configured proxy. The POSIX launcher
rejects `NODE_OPTIONS` and `NODE_PATH` before it starts the runner's Node
process, and it requires the operator or controlled CI job to supply an audited
absolute Node executable rather than looking one up through `PATH` or npm. The
runner then uses sealed per-run HOME/TMP/Docker config plus canonical absolute
Docker/Node/npm paths. `SIGINT` and `SIGTERM` stop the active command tree and
then run the same one-time cleanup. The runner uses a sealed test-only
application environment; inherited provider credentials, worker switches,
`.env` values, and Prisma shadow targets are not passed through. Do not invoke
`run-isolated-e2e.mjs` directly or use an npm package script as the secure
launcher. Before the runner resolves Docker, reserves a port, creates a workspace,
or starts a child command, it verifies a clean detached checkout, candidate input
policy, `HEAD`, and the canonical source-tree hash against those sealed candidate
inputs; it repeats the checkout verification after the test stage. Its redacted
schema-v2 receipt records `candidate.sha`, `candidate.sourceTreeSha256`,
`authorization.approvalReference`, and `authorization.executionEvidence`, but never
the target URL, ownership token, or Docker host.
Do not point `npm run test:e2e` at a development, staging, production, or
shared database/Redis target.
The ordinary `npm test` command deliberately excludes `test/*.e2e-spec.ts`;
those destructive specs only run through `npm run test:e2e`, which loads the
environment guard before test cleanup.

### Forward-migration compatibility harness

`/bin/sh scripts/run-migration-compatibility.sh` is a separate,
**local-operator-only**, future runner for a narrowly scoped fresh-schema
forward-migration check. It is **not** part of `npm run test:e2e`, candidate
capture, a staging deployment, a rollback drill, the future external control
plane, or OCI builder/custody evidence. Do not invoke its `.mjs` entrypoint or
create a convenience npm script that bypasses the POSIX launcher. The marker
that catches a bare direct Node invocation is a misuse guard, not a substitute
for the separately required external execution authorization.

Run it only after a separately recorded authorization covers one new local,
disposable Docker target and after all of the following non-secret references
are available:

- an absolute trusted Node path plus its exact non-secret SHA-256 in
  `MIGRATION_COMPATIBILITY_RUNNER_NODE_SHA256`, and an explicit local Unix
  `DOCKER_HOST`;
- matching `MIGRATION_COMPATIBILITY_EXECUTION_AUTHORIZATION_EVIDENCE` and
  `MIGRATION_COMPATIBILITY_ENVIRONMENT_APPROVAL_REFERENCE` values, plus
  `MIGRATION_COMPATIBILITY_TARGET_KIND=local-disposable`;
- distinct prior/candidate Git SHA and source-tree SHA-256 values, immutable
  prior/candidate OCI `@sha256` images, and their artifact Evidence IDs and
  provenance SHA-256 values;
- already-local digest-pinned PostgreSQL/Redis images and their infrastructure
  evidence reference; and
- a new absolute `MIGRATION_COMPATIBILITY_RECEIPT_OUT` path outside the
  candidate checkout, reserved for one non-secret, owner-readable **local
  operation record**. The runner never creates a directory or overwrites a
  receipt.

The Evidence IDs are auditable handles only; repository code can validate their
format and equality but cannot establish that an external approval exists. The
launcher rejects preload/module-path variables, Node execution arguments, host
DB/Redis/Compose overrides, and Docker contexts before it starts Node. It hashes
the explicit Node executable, and the runner rechecks the canonical executable
before creating a workspace or touching Docker. The runner then requires a clean,
detached candidate checkout; checks prior ancestry; accepts only local Unix
Docker; uses absolute Docker/Git/Node paths and a sealed temp HOME/Docker config;
and refuses any image that is absent locally, uses a floating tag, lacks the
expected approved digest, or lacks the required OCI provenance labels including
`io.talkandtalk.provenance-kind=approved-candidate`. A generic local/CI image
is deliberately not eligible: an external artifact builder, immutable registry
digest, provenance manifest, and custody receipt are still required before a
real run can be authorized. The local runner cannot produce or validate those
external facts; its output remains a local operation record.

On an approved run it creates no host database port. It starts a fresh internal
PostgreSQL/Redis pair, proves PostgreSQL plus Redis ownership DB `14` **and**
application-data DB `15` are empty, writes and rechecks paired ownership
markers, runs previous migrations, starts the previous artifact through its
normal entrypoint, runs candidate migrations/status, and rechecks the still-
running previous replica. It then stops that replica, separately checks the
previous compiled binary (with only its expected old-entrypoint migration-status
guard bypassed), stops it, and only then starts the candidate artifact. Every API
readiness probe and Compose healthcheck authenticates with a temporary
in-container `METRICS_TOKEN`; the token is never written to the receipt. Before
`down --volumes`, the runner verifies every discovered container/network/volume
belongs to the exact random Compose project, run ID, and ownership marker. It
never builds, pulls, tags, logs into, or deploys images. It emits a redacted
local operation record only after its cleanup phase, and a failed record is
never success evidence.

This demonstrates only forward compatibility of approved immutable artifacts on
a fresh disposable schema. It does not accept a fixture and does not prove
historical-data migration semantics. It does not prove a previous production
entrypoint will accept a newer migration directory, does not prove rollback,
backup/restore, RTO/RPO, staging, or production readiness.

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

Run the static contract test as part of `npm run test:preflight:static`. The
PostgreSQL-dependent preflight set is deliberately separate and must run only
through the sealed disposable runner with `E2E_RUNNER_SUITE=postgres-preflight`.
The protected candidate-CI `api-preflight-postgres` job invokes only
`backend/api/scripts/run-isolated-e2e.sh`; it supplies the sealed candidate SHA,
source-tree SHA-256, protected-environment approval reference, per-run execution
Evidence ID, infrastructure custody inputs, and new external receipt path. That
runner registers the real PostgreSQL cases only after its disposable-target and
checkout admission checks pass. A standalone `node --test
scripts/order-refund-policy-snapshots.test.mjs` command is static-only and is never
PostgreSQL-runtime evidence; passing
`REFUND_POLICY_MIGRATION_TEST_DATABASE_URL` alone cannot authorize or create a
runtime preflight.

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

The finance migration contract can be checked without a database; this command
covers only its static branch:

```bash
node --test scripts/finance-terminal-audit-controls.test.mjs
```

Real PostgreSQL row-lock and approval/append-race coverage belongs only to the
same protected candidate-CI `api-preflight-postgres` route above. It uses the
sealed `backend/api/scripts/run-isolated-e2e.sh` launcher with
`E2E_RUNNER_SUITE=postgres-preflight`, never a standalone database URL or direct
Node test command. Passing `FINANCE_MIGRATION_TEST_DATABASE_URL` alone is not
runtime evidence and must not be recorded as such.

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
