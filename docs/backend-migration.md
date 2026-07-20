# Backend Migration

Talk&Talk has moved from the old local Node demo backend to the production NestJS backend in `backend/api`. The old demo is deleted and must not be used as a runtime entrypoint.

## Old Demo API

Recovered from git history:

| Old route | Purpose | Day 1 status |
|---|---|---|
| `GET /api/health` | Demo health and DeepSeek status | Replaced by `GET /api/v1/health` |
| `GET /api/admin/overview` | Demo admin dashboard summary | Replaced by `GET /api/v1/admin/moderation/overview` |
| `GET /api/conversations` | List demo conversations | Day 4 compatibility required |
| `GET /api/conversations/:id/messages` | List messages in demo conversation | Day 4 compatibility required |
| `POST /api/conversations/:id/messages` | Send chat message and run moderation | Day 4 compatibility required |
| `POST /api/moderate` | Standalone text moderation | Replaced by `POST /api/v1/moderation/check` |
| `GET /api/moderation-cases` | List moderation cases | Replaced by `GET /api/v1/admin/moderation/cases` (staff) |
| `POST /api/moderation-cases/:id/actions` | Resolve/escalate/dismiss case | Replaced by `POST /api/v1/admin/moderation/cases/:id/actions` |
| `GET /api/violation-examples` | Demo examples for admin UI | Dropped (use live queue + labels) |
| `POST /api/labels` | Demo training label creation | Replaced by `POST /api/v1/admin/moderation/labels` |
| `GET /api/labels/export` | Demo training label export | Replaced by `GET /api/v1/admin/moderation/labels/export` |
| `POST /api/reset` | Reset in-memory demo state | Removed |

## New Production API

Day 1 routes currently available:

| New route | Purpose |
|---|---|
| `GET /api/v1/health` | Service health, version, uptime, Postgres status, Redis status |
| `POST /api/v1/auth/sms/send-code` | Send phone verification code |
| `POST /api/v1/auth/phone/login` | Phone + code login |
| `POST /api/v1/auth/apple` | Apple Sign-In login |
| `POST /api/v1/auth/refresh` | Refresh JWT token pair |
| `POST /api/v1/auth/logout` | Revoke refresh token |
| `GET /api/v1/users/me` | Current authenticated user |
| `GET /api/v1/admin/status` | Admin status (requires `admin` role) |
| `GET /api/v1/companions/status` | Companions module skeleton status |
| `GET /api/v1/conversations/status` | Conversations module skeleton status |
| `GET /api/v1/moderation/status` | Moderation module status (`active`, includes `aiConfigured`) |
| `POST /api/v1/moderation/check` | Standalone text moderation (JWT); RuleEngine + production text-review provider |
| `POST /api/v1/moderation/reports` | User report → create `source=report` case (JWT user) |
| `GET /api/v1/moderation/cases` | List moderation cases (`moderator`/`admin` only) |
| `GET /api/v1/admin/moderation/overview` | Staff overview stats + queue |
| `GET /api/v1/admin/moderation/cases` | Staff case list with filters |
| `GET /api/v1/admin/moderation/cases/:id` | Case detail + evidences + action logs |
| `GET /api/v1/admin/moderation/cases/:id/conversation` | Session evidence messages |
| `POST /api/v1/admin/moderation/cases/:id/actions` | `confirmViolation` / `dismiss` / `escalate` |
| `POST /api/v1/admin/moderation/labels` | Create training label sample |
| `GET /api/v1/admin/moderation/labels/export` | Export label samples |
| `GET /api/v1/orders/status` | Orders module status (`active`) |
| `POST /api/v1/orders` | Create order (JWT): `{ companionId, themeId, durationMinutes }` → pending |
| `GET /api/v1/orders` | List current user orders (JWT) |
| `GET /api/v1/orders/:id` | Order detail (JWT, owner) |
| `POST /api/v1/orders/:id/cancel` | Cancel pending/paying order (JWT) |
| `POST /api/v1/orders/:id/prepay` | WeChat App prepay → paying (JWT); returns `wechatAppParams` + `mock` flag |
| `POST /api/v1/orders/:id/refund` | Refund skeleton (JWT): creates pending `RefundTransaction` |
| `GET /api/v1/payments/status` | Payment provider readiness：`real` / `mock` / `disabled` |
| `GET /api/v1/auth/wechat/mini-program/status` | 小程序 AppID/AppSecret 配置就绪状态（不返回凭证） |
| `POST /api/v1/payments/wechat/notify` | WeChat notify (signature verify, idempotent, amount/status checks; activates conversation on first success) |
| `POST /api/v1/payments/wechat/mock-notify` | Dev/test only: simulate successful notify (JWT) |
| `GET /api/v1/admin/status` | Admin module skeleton status (`admin` only) |
| `GET /api/v1/notifications/status` | Notifications module status (`active`) |
| `GET /api/v1/notifications` | List notifications (JWT); optional `unreadOnly` |
| `GET /api/v1/notifications/unread-count` | Unread count (JWT) |
| `POST /api/v1/notifications/:id/read` | Mark one read (JWT) |
| `POST /api/v1/notifications/read-all` | Mark all read (JWT) |
| `POST /api/v1/me/deletion-request` | Account deletion request (JWT) → AuditLog |
| `GET /api/v1/admin/account-deletions` | Admin queue; optional `status=pending\|processing`, `page`, `pageSize` |
| `POST /api/v1/admin/account-deletions/:id/start` | Atomically claim a pending deletion for processing |
| `POST /api/v1/admin/account-deletions/:id/complete` | Complete deletion with required `{ note }`; admin only |
| `POST /api/v1/admin/account-deletions/:id/orders/:orderId/payment/sync` | Admin-only provider query; safely closes only expired unpaid prepays |
| `POST /api/v1/admin/account-deletions/:id/orders/:orderId/refund/sync` | Admin-only provider query for an existing refund; never creates a refund |
| `POST /api/v1/admin/account-deletions/:id/orders/:orderId/refund/initiate` | Deletion-only full original-route refund with fixed reason code |

Web 运营后台：`http://localhost:3000/admin/`（静态页，需 staff JWT）。详见 [admin-moderation-api.md](./admin-moderation-api.md)。

Every JSON response must use:

- Success: `{ data, meta: { requestId, timestamp } }`
- Error: `{ error: { code, message, details? }, meta }`

`x-request-id` must be copied into both the response header and `meta.requestId`. If the request header is missing, the backend generates a UUID.

### Account deletion operations

Process each request in order: list the queue, start it, settle any active order/refund obligations, then complete it with an operator note. Start immediately restricts the account and revokes refresh tokens so the user cannot begin another order/payment mutation. If a payment/refund callback is missing, use the admin sync routes above. Payment sync may close and cancel only an unpaid prepay whose provider expiry has elapsed; refund sync only reconciles an already-existing refund. If payment sync confirms a missed successful payment, the deletion-only refund route may create one full original-route refund with the fixed reason `ACCOUNT_DELETION_SETTLEMENT`. That route only accepts an order belonging to the `processing` deletion request, reuses the existing Order→Payment→Refund locking/idempotency rules, cannot choose a partial amount or arbitrary reason, and writes exactly one admin-initiation audit. None of these routes can create a prepay or a new payment. Start and complete are idempotent: retries do not repeat state changes or audit events. Completion has a 60-second settlement window after start, then is rejected with `DELETION_HAS_ACTIVE_FINANCIAL_OBLIGATIONS` while an order is `paying`, `paid`, or `inService`, or a refund is `pendingReview`, `pending`, or `processing`.

Successful completion runs in one database transaction. It revokes refresh tokens, removes login identities and staff credentials, clears identifiable `UserProfile` fields, marks the retained user record `banned`, updates the request to `completed`, and records the operator audit. It deliberately retains the `User` primary key plus orders, payments, refunds, and audit logs for reconciliation and statutory retention. Operators must not delete the user row or use cascade deletion as part of this workflow. The generic admin status endpoint cannot reactivate either a processing or completed deletion; a completed user also cannot submit a second deletion request.

## iOS Current Dependencies

Frozen contract: [shared/contracts/openapi/v1.yaml](../shared/contracts/openapi/v1.yaml).

| Client | Route | Status |
|---|---|---|
| `AuthSession` / `BackendAuthClient` | Auth endpoints | Active — login required before main app |
| `BackendClient.health()` | `GET /api/v1/health` | Active |
| Companions / orders / payments / notifications | `/companions`, `/orders`, `/payments`, `/notifications` | Active |
| `BackendClient.fetchMessages` / `sendMessage` | `/conversations/*` | Active for `c1`–`c3`; Release 失败不覆盖服务端决策；DEBUG 可本地兜底 |
| Reports | `POST /moderation/reports` | Active |
| `BackendClient.fetchModerationCases()` | `GET /api/v1/moderation/cases` | Staff only |

Auth details: [docs/auth-api.md](./auth-api.md).

`BackendConfig.supportedCompanionIds` is `["c1", "c2", "c3"]`. Community square remains largely local (see [NEXT_PHASE.md](../NEXT_PHASE.md)).

## Compatibility shapes (implemented)

| Route | Request | Response data shape used by iOS |
|---|---|---|
| `GET /api/v1/conversations` | none | conversations list |
| `GET /api/v1/conversations/:id/messages` | path `id` | conversation + messages |
| `POST /api/v1/conversations/:id/messages` | `{ content, senderId? }` | moderation + message + safety/companion fields |
| `POST /api/v1/moderation/check` | `{ text, source?, conversationId? }` | moderation |
| `GET /api/v1/moderation/cases` | staff JWT | cases |

DTO fields (stable for v1):

- Message: `id`, `conversationId`, `senderId`, `senderName?`, `content`, `type`, `timestamp`
- Moderation: `decision`, `riskLevel`, `score`, `reasons`, `matchedRules`, `usedAI`
- Case: `id`, `title`, `category`, `riskLevel`, `status`, `source`, `content`, `targetId?`, `aiScore`, `aiReason`, `decision`, `matchedRules`, `usedAI`, `resolvedAt?`

Conversations, messages, and moderation cases persist in Postgres.

## Moderation pipeline

Chat send (`POST /conversations/:id/messages`) and `POST /moderation/check` share the same pipeline:

1. **RuleEngine** — private contact, offline meetup, transfers, privacy asks, ads, harassment (with normalization for spaces / `vx` / `加v` / 谐音).
2. If rule result is `block` + `high` risk → **skip AI**.
3. Otherwise call the configured **DeepSeek-compatible text review provider**. Development/staging can fall back to rules; production requires credentials and fails closed: chat/community become pending human review, while non-durable public-profile writes return retryable `503 CONTENT_MODERATION_UNAVAILABLE`.
4. Merge scores with `max(rule, ai)`; `usedAI` is true only when AI returns successfully.
5. Non-`allow` decisions create `ModerationCase` plus `ModerationEvidence` and `ModerationActionLog(action: created)`.

User-facing `safetyMessage` text stays generic (no rule IDs or raw AI dumps). Development and staging may start without an API key and use rules only; production refuses to start without real moderation credentials.
