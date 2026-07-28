# Review Department API

审核 API 与用户 API 分离。普通 `User`、旧 `moderator` / `admin` JWT 都不能读取审核案件；审核网页使用独立的 `ReviewStaff` 身份。

详细账号与安全操作见 [review-department.md](./review-department.md)。独立接口契约见 [review-v1.yaml](../shared/contracts/openapi/review-v1.yaml)。

## 身份与角色

| 审核部门角色 | 权限 |
|---|---|
| `reviewer` | 队列、案件、证据、样本标注、放行/驳回/升级/申诉裁决 |
| `lead` | reviewer 的全部权限，另可创建或解除聊天限言 |

所有请求使用审核部门 access token；它由 `POST /api/v1/review/auth/login` 以用户名、强密码和 TOTP 签发，不能与 `/api/v1/auth/*` 用户令牌互换。

## 审核接口

| Method | Path | 说明 |
|---|---|---|
| `POST` | `/api/v1/review/auth/login` | 审核员密码 + TOTP 登录 |
| `POST` | `/api/v1/review/auth/refresh` | 单次使用的审核刷新会话轮换 |
| `POST` | `/api/v1/review/auth/logout` | 撤销当前审核员刷新会话 |
| `GET` | `/api/v1/review/auth/me` | 当前审核员身份 |
| `GET` | `/api/v1/review/overview` | 审核概览和优先队列 |
| `GET` | `/api/v1/review/cases` | 列表；支持 `status`、`riskLevel`、`priority`、`source`、`keyword`、`from`、`to`、`page`、`pageSize` |
| `GET` | `/api/v1/review/cases/:id` | 案件、证据、申诉、动作和限言轨迹 |
| `GET` | `/api/v1/review/cases/:id/conversation` | 判断所需的受控会话上下文 |
| `POST` | `/api/v1/review/cases/:id/actions` | 提交审核判断 |
| `POST` | `/api/v1/review/labels` | 新建标注样本 |
| `GET` | `/api/v1/review/labels/export` | 导出标注样本 |

## 处置规则

`confirmViolation`、`rejectMessage`、`restrict24h`、`restrict7d`、`upholdAppeal`、`overturnAppeal` 必须提供 `note`。限言动作仅允许 `lead`。每次处置在同一事务中写入：

1. `ModerationActionLog`（标明 `reviewerId`）
2. 通用 `AuditLog`（元数据标明 `actorKind: reviewStaff`）
3. `ReviewAuditLog`（审核部门自己的可追溯记录）

旧 `/api/v1/admin/moderation/*` 不再注册；`GET /api/v1/moderation/cases` 与 `POST /api/v1/moderation/check` 返回 `REVIEW_DEPARTMENT_MOVED`，防止用户体系重新成为审核入口。

## 审核网页

启动 API 后访问：

```text
http://localhost:3000/review/
```

网页静态资源位于 `backend/api/public/review/`。它只调用 `/api/v1/review/*`，不引用用户短信登录或旧 staff 登录接口。
