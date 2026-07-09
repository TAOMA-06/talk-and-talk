# Admin Moderation API

正式审核后台 API 与 Web 运营工具说明。

## 角色

| 角色 | 权限 |
|------|------|
| `user` | 可 `POST /moderation/reports`；**不能**访问审核后台 |
| `moderator` | 审核概览、工单、处置、样本标注/导出 |
| `admin` | 同 moderator，另含 `GET /admin/status` 与 companions 管理 |

开发 seed 账号（`npm run prisma:seed`）：

| 手机号 | 角色 |
|--------|------|
| `13800000001` | admin |
| `13800000002` | moderator |

`SMS_PROVIDER=mock` 时验证码输出到 API 日志。

## Staff API（`moderator` / `admin` + JWT）

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/api/v1/admin/moderation/overview` | 统计 + 最近队列 |
| `GET` | `/api/v1/admin/moderation/cases` | 列表；query：`status` `riskLevel` `source` `keyword` `from` `to` `page` `pageSize` |
| `GET` | `/api/v1/admin/moderation/cases/:id` | 详情 + evidences + actionLog |
| `GET` | `/api/v1/admin/moderation/cases/:id/conversation` | 会话证据消息 |
| `POST` | `/api/v1/admin/moderation/cases/:id/actions` | 处置：`{ action, note? }` |
| `POST` | `/api/v1/admin/moderation/labels` | 样本标注 |
| `GET` | `/api/v1/admin/moderation/labels/export` | 样本导出 |

### 处置动作

| action | 结果 status |
|--------|-------------|
| `confirmViolation` | `resolved` |
| `dismiss` | `dismissed` |
| `escalate` | `humanReview` |

每次处置会写入：

1. `ModerationActionLog`
2. `AuditLog`（`resourceType: moderation_case`）

### 列表筛选示例

```http
GET /api/v1/admin/moderation/cases?status=pending&riskLevel=high&source=chat&keyword=微信&page=1&pageSize=50
Authorization: Bearer <token>
```

### 处置示例

```http
POST /api/v1/admin/moderation/cases/{id}/actions
Authorization: Bearer <token>
Content-Type: application/json

{ "action": "confirmViolation", "note": "确认私联" }
```

响应 `data` 含 `{ case, action, overview }`。

## 用户举报

```http
POST /api/v1/moderation/reports
Authorization: Bearer <user-token>
Content-Type: application/json

{
  "reason": "对方索要联系方式",
  "conversationId": "c1",
  "recentContext": "加我微信吧"
}
```

始终创建 `source=report` 工单（即使自动审核为 allow）。

## 兼容路由

| Path | 说明 |
|------|------|
| `GET /api/v1/moderation/cases` | 仍可用，需 `moderator`/`admin` |
| `POST /api/v1/moderation/check` | 任意登录用户试审文本 |

## Web 运营后台

启动 API 后打开：

```text
http://localhost:3000/admin/
```

静态页位于 `backend/api/public/admin/index.html`。

能力：登录、概览、队列筛选、详情处置、会话证据、样本标注与导出。

## 测试

```bash
cd backend/api
npm test
npm run test:e2e
```

e2e 覆盖：普通用户 403、moderator 处置、统计更新、举报入库、labels 导出。
