# 运营与审核账号边界

审核账号已迁移为独立的审核部门身份，不再挂在用户表、`StaffCredential` 或旧 `/admin/` 页面上。审核员的初始化、轮换和安全响应请使用 [review-department.md](./review-department.md)。

本页仅保留非审核运营账号的历史操作说明。用户 `admin` / `moderator` 不再能访问审核队列，也不得作为审核部门账号发放。

## 非审核运营账号

非审核运营账号仍只接受独立 staff 用户名、16 位以上强密码和 TOTP 动态口令，不依赖消费者短信或微信登录。所有初始化、轮换均必须在可信终端执行，命令结束后立即清除 shell 环境变量和终端输出。

1. 先部署 `20260719060000_staff_credentials` migration，并在服务端 secret store 设置独立的 `STAFF_TOTP_ENCRYPTION_KEY`（至少 32 字符，不得与 JWT、数据库或 Redis 密钥复用）。这项凭据只服务于仍保留的非审核运营能力。
2. 在可信终端生成 TOTP 种子：

   ```bash
   cd backend/api
   STAFF_BOOTSTRAP_USERNAME=ops-admin npm run staff:totp-secret
   ```

3. 使用 `STAFF_BOOTSTRAP_*` 一次性变量执行 `npm run staff:bootstrap`。它不创建审核部门身份。
4. 不要用这类账号登录审核页面；审核工作台固定入口为 `/review/`，并使用 `REVIEW_BOOTSTRAP_*` 发放的独立审核身份。旧 `/admin/` 已仅保留迁移跳转。

## 安全响应

- 运营账号离职或凭据疑似泄露：先按对应运营流程限制该用户并撤销其用户刷新会话。
- 审核账号的停用、轮换和审计响应只按 [review-department.md](./review-department.md) 操作，不能用运营账号替代。
