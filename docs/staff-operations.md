# 审核后台员工账号操作手册

审核后台只接受独立 staff 用户名、16 位以上强密码和 TOTP 动态口令，不依赖消费者短信或微信登录。所有初始化、轮换均必须在可信终端执行，命令结束后立即清除 shell 环境变量和终端输出。

## 首个管理员与后续员工

1. 先部署 `20260719060000_staff_credentials` migration，并在服务端 secret store 设置独立的 `STAFF_TOTP_ENCRYPTION_KEY`（至少 32 字符，不得与 JWT、数据库或 Redis 密钥复用）。
2. 在可信终端生成 TOTP 种子，并将 URI 导入企业管理的身份验证器：

```bash
cd backend/api
STAFF_BOOTSTRAP_USERNAME=ops-admin npm run staff:totp-secret
```

3. 从 secret store 注入下列一次性变量并初始化。不要把密码或 TOTP 种子写进仓库、聊天、工单或 shell history：

```bash
export STAFF_BOOTSTRAP_USERNAME=ops-admin
export STAFF_BOOTSTRAP_PASSWORD='<16+ character strong password>'
export STAFF_BOOTSTRAP_TOTP_SECRET='<Base32 secret from step 2>'
export STAFF_BOOTSTRAP_ROLE=admin
export STAFF_BOOTSTRAP_DISPLAY_NAME='运营管理员'
npm run build
npm run staff:bootstrap
unset STAFF_BOOTSTRAP_USERNAME STAFF_BOOTSTRAP_PASSWORD STAFF_BOOTSTRAP_TOTP_SECRET STAFF_BOOTSTRAP_ROLE STAFF_BOOTSTRAP_DISPLAY_NAME
```

生产容器已经含编译产物时，使用受控一次性 job 执行 `node dist/src/database/bootstrap-staff.js`；job 必须接入和 API 相同的数据库、`DATABASE_URL` 与 `STAFF_TOTP_ENCRYPTION_KEY`。同一用户名重复执行会轮换密码和 TOTP、清除锁定，不会创建重复账号。

4. 打开 `/admin/` 完成一次真实登录并检查 `admin.login` 审计记录。再创建一个独立 moderator 账号，日常审核使用 moderator；admin 仅用于实名、账号状态、退款等受限操作。

## 安全响应

- 员工离职或凭据疑似泄露：先用 admin 将对应 User 设为 `banned`（旧 access token 会立即失效，refresh token 被撤销），再轮换凭据或删除 StaffCredential。
- 连续 5 次失败会锁定账号 15 分钟；IP/用户名同时有 Redis 限流。失败和成功均写审计日志。
- `STAFF_TOTP_ENCRYPTION_KEY` 轮换后，旧 TOTP 无法解密；应逐个重新执行 bootstrap，为每位员工下发新的种子。
- 禁止共享账号。每位员工使用独立用户名、密码和 TOTP，并定期复核 admin/moderator 名单。
