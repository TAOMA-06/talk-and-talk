# 独立审核部门

审核部门是 Talk&Talk 的内部判断边界，不是用户、陪伴者或运营账号的一种角色。

## 边界

| 范围 | 用户业务系统 | 审核部门 |
|---|---|---|
| 身份 | `User`、手机/微信/Apple 登录、用户 JWT | `ReviewStaff`、用户名/强密码/TOTP、审核 JWT |
| 会话 | `RefreshToken` | `ReviewSession` |
| 路由 | 用户与运营业务 | `/api/v1/review/*` |
| 网页 | 小程序及业务运营入口 | `/review/` 独立审核工作台 |
| 审计 | 通用 `AuditLog` | 专属 `ReviewAuditLog`，并关联案件动作记录 |

审核工作台仅展示完成判断所必需的案件、证据与会话上下文。用户 JWT、`admin`、`moderator` 都不能访问审核队列；旧 `/admin/` 书签会重定向到 `/review/`，旧审核 API 已从 `AdminModule` 移除。

审核员提交动作后，统一通过 `ReviewModerationService` 调用受控案件决策通道。聊天消息、社区帖子、申诉和限言只会因这条经过鉴权、带理由并留痕的决策发生业务状态变更。

## 上线与账号初始化

1. 部署数据库 migration：

   ```bash
   cd backend/api
   npm run prisma:deploy
   ```

2. 在 secret store 配置独立且互不复用的密钥：

   - `REVIEW_JWT_ACCESS_SECRET`
   - `REVIEW_JWT_REFRESH_SECRET`
   - `REVIEW_TOTP_ENCRYPTION_KEY`

   生产环境三者均至少 32 字符；审核 JWT 不能复用用户 JWT，审核 TOTP 加密密钥不能复用旧运营 staff 的 TOTP 密钥。

3. 在可信终端为每位审核员生成专属 TOTP 种子：

   ```bash
   cd backend/api
   REVIEW_BOOTSTRAP_USERNAME=reviewer.liu npm run review:totp-secret
   ```

4. 使用一次性环境变量初始化账号。`reviewer` 可审核、升级复核和标注；`lead` 额外可执行或解除聊天限言。

   ```bash
   export REVIEW_BOOTSTRAP_USERNAME=reviewer.liu
   export REVIEW_BOOTSTRAP_PASSWORD='<16+ character strong password>'
   export REVIEW_BOOTSTRAP_TOTP_SECRET='<Base32 secret>'
   export REVIEW_BOOTSTRAP_ROLE=reviewer
   export REVIEW_BOOTSTRAP_DISPLAY_NAME='刘审核'
   npm run build
   npm run review:bootstrap
   unset REVIEW_BOOTSTRAP_USERNAME REVIEW_BOOTSTRAP_PASSWORD REVIEW_BOOTSTRAP_TOTP_SECRET REVIEW_BOOTSTRAP_ROLE REVIEW_BOOTSTRAP_DISPLAY_NAME
   ```

   同一用户名重复执行会轮换密码和 TOTP、清除登录锁定并撤销该审核员的旧刷新会话；不会创建重复身份。

5. 打开 `https://<api-host>/review/`，使用新账号完成真实登录。不要使用用户手机号、微信登录或旧 `STAFF_BOOTSTRAP_*` 账号。

## 安全响应

- 审核员离职或凭据疑似泄露：将 `ReviewStaff.status` 设为 `suspended` 并撤销其 `ReviewSession`；不要通过用户账号封禁替代该操作。
- 连续五次错误登录锁定 15 分钟；用户名与 IP 均经过 Redis 限流；成功与失败登录均写入 `ReviewAuditLog`。
- 高风险处置必须填写理由。`restrict24h`、`restrict7d` 与 `liftRestriction` 仅允许 `lead`。
- 审核页面只使用 `sessionStorage` 保存短期审核会话；退出时会撤销服务器端刷新会话。

## 迁移说明

本次 migration 不会复制 `StaffCredential` 或 `User` 数据到 `ReviewStaff`。这是有意的：复制旧密码、TOTP 和用户关联会重新引入身份混用。上线前须为审核部门重新发放独立账号。

旧 `moderator` / `admin` 用户角色仍可用于不属于审核部门的既有运营能力；它们不再是审核身份，也不应被赋予审核案件访问权。
