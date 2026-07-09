# Backend Migration

Talk&Talk has moved from the old local Node demo backend to the production NestJS backend in `services/api`. The old demo is deleted and must not be used as a runtime entrypoint.

## Old Demo API

Recovered from git history:

| Old route | Purpose | Day 1 status |
|---|---|---|
| `GET /api/health` | Demo health and DeepSeek status | Replaced by `GET /api/v1/health` |
| `GET /api/admin/overview` | Demo admin dashboard summary | Not migrated |
| `GET /api/conversations` | List demo conversations | Day 4 compatibility required |
| `GET /api/conversations/:id/messages` | List messages in demo conversation | Day 4 compatibility required |
| `POST /api/conversations/:id/messages` | Send chat message and run moderation | Day 4 compatibility required |
| `POST /api/moderate` | Standalone text moderation | Replaced by planned `POST /api/v1/moderation/check` |
| `GET /api/moderation-cases` | List moderation cases | Replaced by planned `GET /api/v1/moderation/cases` |
| `POST /api/moderation-cases/:id/actions` | Resolve/escalate/dismiss case | Not migrated |
| `GET /api/violation-examples` | Demo examples for admin UI | Not migrated |
| `POST /api/labels` | Demo training label creation | Not migrated |
| `GET /api/labels/export` | Demo training label export | Not migrated |
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
| `GET /api/v1/moderation/status` | Moderation module skeleton status |
| `GET /api/v1/orders/status` | Orders module skeleton status |
| `GET /api/v1/payments/status` | Payments module skeleton status |
| `GET /api/v1/admin/status` | Admin module skeleton status |
| `GET /api/v1/notifications/status` | Notifications module skeleton status |

Every JSON response must use:

- Success: `{ data, meta: { requestId, timestamp } }`
- Error: `{ error: { code, message, details? }, meta }`

`x-request-id` must be copied into both the response header and `meta.requestId`. If the request header is missing, the backend generates a UUID.

## iOS Current Dependencies

The iOS app currently depends on:

| Client | Route | Status |
|---|---|---|
| `AuthSession` / `BackendAuthClient` | Auth endpoints | Active — login required before main app |
| `BackendClient.health()` | `GET /api/v1/health` | Active |
| `BackendClient.fetchMessages(conversationId:)` | `GET /api/v1/conversations/:id/messages` | Backend may 404; App falls back locally |
| `BackendClient.sendMessage(...)` | `POST /api/v1/conversations/:id/messages` | Backend may 404; App falls back locally |
| `BackendClient.fetchModerationCases()` | `GET /api/v1/moderation/cases` | Planned |

Auth details: see [docs/auth-api.md](./auth-api.md).

`BackendConfig.supportedCompanionIds` is `["c1", "c2", "c3"]`. These IDs are backend-capable from the iOS point of view, but local fallback remains required until compatibility routes exist.

## Day 4 Compatibility Target

Implement these before removing iOS local chat fallback:

| Route | Request | Response data shape required by iOS |
|---|---|---|
| `GET /api/v1/conversations` | none | `{ conversations: [...] }` |
| `GET /api/v1/conversations/:id/messages` | path `id` | `{ conversation, messages: BackendMessageDTO[] }` |
| `POST /api/v1/conversations/:id/messages` | `{ content: string, senderId: string }` | `{ moderation, message, safetyMessage, companionReply, moderationCase, conversation }` |
| `POST /api/v1/moderation/check` | `{ text: string, source?: string, conversationId?: string }` | `{ moderation }` |
| `GET /api/v1/moderation/cases` | none | `{ cases: BackendModerationCaseDTO[] }` |

Required DTO compatibility:

- Message fields: `id`, `conversationId`, `senderId`, `senderName?`, `content`, `type`, `timestamp`
- Moderation fields: `decision`, `riskLevel`, `score`, `reasons`, `matchedRules`, `usedAI`
- Case fields: `id`, `title`, `category`, `riskLevel`, `status`, `source`, `content`, `targetId?`, `aiScore`, `aiReason`, `decision`, `matchedRules`, `usedAI`, `resolvedAt?`

The old demo used in-memory state. The production version must persist conversations, messages, and moderation cases in Postgres.
