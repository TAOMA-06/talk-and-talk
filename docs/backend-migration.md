# Backend Migration

Talk&Talk has moved from the old local Node demo backend to the production NestJS backend in `services/api`. The old demo is deleted and must not be used as a runtime entrypoint.

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
| `POST /api/v1/moderation/check` | Standalone text moderation (JWT); RuleEngine + optional DeepSeek |
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
| `GET /api/v1/payments/status` | Payments module status (`active`) |
| `POST /api/v1/payments/wechat/notify` | WeChat notify (signature verify, idempotent, amount/status checks; activates conversation on first success) |
| `POST /api/v1/payments/wechat/mock-notify` | Dev/test only: simulate successful notify (JWT) |
| `GET /api/v1/admin/status` | Admin module skeleton status (`admin` only) |
| `GET /api/v1/notifications/status` | Notifications module status (`active`) |
| `GET /api/v1/notifications` | List notifications (JWT); optional `unreadOnly` |
| `GET /api/v1/notifications/unread-count` | Unread count (JWT) |
| `POST /api/v1/notifications/:id/read` | Mark one read (JWT) |
| `POST /api/v1/notifications/read-all` | Mark all read (JWT) |
| `POST /api/v1/me/deletion-request` | Account deletion request (JWT) → AuditLog |

Web 运营后台：`http://localhost:3000/admin/`（静态页，需 staff JWT）。详见 [admin-moderation-api.md](./admin-moderation-api.md)。

Every JSON response must use:

- Success: `{ data, meta: { requestId, timestamp } }`
- Error: `{ error: { code, message, details? }, meta }`

`x-request-id` must be copied into both the response header and `meta.requestId`. If the request header is missing, the backend generates a UUID.

## iOS Current Dependencies

Frozen contract: [packages/contracts/openapi/v1.yaml](../packages/contracts/openapi/v1.yaml).

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
3. Otherwise call **DeepSeek** when `DEEPSEEK_API_KEY` is set; on failure / timeout / missing key → **rule result fallback**.
4. Merge scores with `max(rule, ai)`; `usedAI` is true only when AI returns successfully.
5. Non-`allow` decisions create `ModerationCase` plus `ModerationEvidence` and `ModerationActionLog(action: created)`.

User-facing `safetyMessage` text stays generic (no rule IDs or raw AI dumps). Without an API key the service still starts and moderates with rules only.
