# Admin Moderation API

正式审核后台 API 与 Web 运营工具说明。

## 角色

| 角色 | 权限 |
|------|------|
| `user` | 可 `POST /moderation/reports`；**不能**访问审核后台 |
| `moderator` | 审核概览、工单、处置、样本标注/导出 |
| `admin` | 同 moderator，另含退款复核、账号注销结算、账号状态/实名与陪伴者审核/上架 |

开发 seed phone 身份（只用于 API 测试，不是 Web 审核后台凭据）：

| 手机号 | 角色 |
|--------|------|
| `13800000001` | admin |
| `13800000002` | moderator |

Web `/admin/` 使用 `POST /auth/staff/login` 的独立用户名、密码与 TOTP。按 [staff-operations.md](./staff-operations.md) 初始化；生产不允许共享或 seed 员工凭据。

## Staff API（`moderator` / `admin` + JWT）

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/api/v1/admin/moderation/overview` | 统计 + 最近队列 |
| `GET` | `/api/v1/admin/moderation/cases` | 列表；query：`status` `riskLevel` `priority` `source` `keyword` `from` `to` `page` `pageSize` |
| `GET` | `/api/v1/admin/moderation/cases/:id` | 详情 + evidences + actionLog + 申诉 / 限言轨迹 |
| `GET` | `/api/v1/admin/moderation/cases/:id/conversation` | 会话证据消息、受权签名媒体预览、OCR / 转写与模型证据 |
| `POST` | `/api/v1/admin/moderation/cases/:id/actions` | 处置：`{ action, note? }` |
| `POST` | `/api/v1/admin/moderation/labels` | 样本标注 |
| `GET` | `/api/v1/admin/moderation/labels/export` | 样本导出 |

### 处置动作

| action | 结果 status |
|--------|-------------|
| `confirmViolation` / `rejectMessage` | `resolved`；未送达消息保持 `blocked`，已送达后确认违规的消息标记为 `removed`，仅发送者可见 |
| `dismiss` / `approveMessage` | `dismissed`；关联暂缓消息发布给会话参与者 |
| `escalate` | `humanReview` |
| `restrict24h` / `restrict7d` | 创建仅发送聊天限言；不自动影响既有全局账号状态 |
| `liftRestriction` | 解除当前案件关联限言 |
| `upholdAppeal` | 驳回待处理申诉 |
| `overturnAppeal` | 申诉成立；放行关联消息并撤销关联聊天限言 |

两次高风险拦截（24 小时滚动窗口）会自动产生 24 小时聊天限言。30 天内累计三次人工 `confirmViolation` 会把最新案件升级为 `critical` / `humanReview`，由审核员决定是否使用既有全局账号处置；系统不会自动全局封禁。

每次处置会写入：

1. `ModerationActionLog`
2. `AuditLog`（`resourceType: moderation_case`）

### 列表筛选示例

```http
GET /api/v1/admin/moderation/cases?status=pending&priority=critical&riskLevel=high&source=chat&keyword=微信&page=1&pageSize=50
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
  "messageId": "message-id"
}
```

始终创建 `source=report` 工单（即使自动审核为 allow）。服务端自行校验消息归属并截取最近会话证据；兼容字段 `recentContext` 会被忽略，不能作为证据。

## 聊天审核 v2

消息投递状态为 `queued`、`pendingReview`、`published`、`blocked`、`removed`。只有 `published` 且 `visibility=participants` 的消息会返回给接收方；发送者能看到自己的暂缓或拦截状态，但拿不到未获批准媒体的读取 URL。

| 用户端接口 | 用途 |
|---|---|
| `GET /api/v1/conversations/:id/status` | 已启用媒体能力与聊天限言倒计时 |
| `POST /api/v1/conversations/:id/media-uploads` | 预留短时、受限的直传凭证 |
| `POST /api/v1/conversations/:id/media-uploads/:assetId/complete` | 服务端验证上传完成后才能附加 |
| `POST /api/v1/conversations/:id/messages` | 兼容旧 `content`；可附加 `attachmentIds`（最多 3 个） |
| `POST /api/v1/moderation/appeals` | 严重拦截或限言的一次申诉 |

图片由图像风险识别与 OCR 审核；语音先转写再融合文本规则/模型。媒体服务失败时保持 `queued`，按 30 秒、2 分钟、10 分钟退避重试三次，之后升级人工队列且绝不自动放行。普通媒体 30 天清理；案件关联媒体按 180 天证据留存，过期后客户端显示占位。

`MEDIA_FEATURE_ENABLED=false` 为默认安全状态。仅当真实存储、图像/OCR 与语音转写适配器均已注册、能够验证直传完整性并满足证据加密留存要求时，才允许在对应环境开启媒体入口；内置 `mock` 仅用于开发/测试。

## 兼容路由

| Path | 说明 |
|------|------|
| `GET /api/v1/moderation/cases` | 仍可用，需 `moderator`/`admin` |
| `POST /api/v1/moderation/check` | 需 `moderator`/`admin`；返回内部审核详情 |

用户端 `POST /moderation/reports` 只返回举报回执，不返回审核案件、规则命中或 AI 判断详情。

## Web 运营后台

启动 API 后打开：

```text
http://localhost:3000/admin/
```

静态页位于 `backend/api/public/admin/index.html`。

能力：登录、概览、队列筛选、详情处置、会话证据、样本标注与导出；`moderator` 可复核退款，`admin` 还可处理账号注销资金结算、账号状态/实名和陪伴者审核/上架。所有运营动作通过受权 API 写入退款、审核或审计日志。

## 测试

```bash
cd backend/api
npm test
npm run test:e2e
```

e2e 覆盖：普通用户 403、moderator 处置、统计更新、举报入库、labels 导出。
