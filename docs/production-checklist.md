# 生产环境检查清单

上线前在 **staging 验证通过** 后，对 production 逐项勾选。  
本清单只检查配置与运维门禁，**不扩展产品功能**。已知未完成能力见 [NEXT_PHASE.md](../NEXT_PHASE.md)。

## 网络与 TLS

- [ ] HTTPS 已启用（`infra/nginx/talk-and-talk.conf.example` 或等价反向代理）
- [ ] HTTP → HTTPS 301 跳转正常
- [ ] 证书未过期；续期流程已知（ACME 或手动）
- [ ] `curl -fsS https://api.talkandtalk.app/api/v1/health` 返回 `ok` 或可接受的 `degraded`

## CORS / JWT / 密钥

- [ ] `CORS_ORIGINS` 为显式 allowlist（生产禁止依赖开发默认列表）
- [ ] `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` 为高强度随机值，非 `CHANGE_ME` / 开发默认
- [ ] access / refresh 密钥互不相同
- [ ] `METRICS_TOKEN` 为 32+ 位随机值；metrics 采集端发送 Bearer token
- [ ] `.env.production` 未提交到 git（见根 `.gitignore`）

## 数据库与 Redis

- [ ] `DATABASE_URL` 使用强密码；与 compose `POSTGRES_PASSWORD` 一致
- [ ] Postgres 不直接对公网暴露
- [ ] `REDIS_URL` 生产建议 `redis://:PASSWORD@host:6379`（requirepass）；至少不公网裸奔
- [ ] health 中 `dependencies.database` / `dependencies.redis` 为 `ok`

## 微信支付

- [ ] `WECHAT_MINIPROGRAM_APP_ID` / `MCH_ID` / `API_V3_KEY` / `CERT_SERIAL_NO` / `NOTIFY_BASE_URL` 已填
- [ ] `WECHAT_PAY_PRIVATE_KEY_HOST_PATH` 指向 host PEM；`WECHAT_PAY_PRIVATE_KEY_PATH` 为容器内只读挂载路径（见 `secrets/README.md`）
- [ ] 通知 URL 可达：`https://api.talkandtalk.app/api/v1/payments/wechat/notify`
- [ ] 生产未配齐微信时 prepay 返回 `WECHAT_PAY_NOT_CONFIGURED`（**禁止** Mock 提供商）
- [ ] 真实 prepay / 平台证书验签 / resource 解密已联调通过（沙箱或生产小额）
- [ ] staging 演示仍可用 mock-notify；production mock-notify → 403

## 微信小程序

- [ ] 小程序主体与 `api.talkandtalk.app` 已完成所需备案，且该 HTTPS 域名已配置为 request 合法域名
- [ ] `WECHAT_MINIPROGRAM_APP_ID` / `WECHAT_MINIPROGRAM_APP_SECRET` 已填；AppSecret 仅存在于部署机密中
- [ ] 微信支付商户号已绑定小程序 AppID，并开通 JSAPI 支付；真机已完成一笔小额支付与退款
- [ ] 小程序后台已配置隐私保护指引；`/legal/privacy.html` 与 `/legal/terms.html` 均能在微信内打开
- [ ] 小程序支付成功后以服务端回调订单状态为准；取消支付不将订单标记 paid

## DeepSeek（可选）

- [ ] 未配置 `DEEPSEEK_API_KEY` 时确认纯规则审核可接受
- [ ] 若配置了 key：URL/Model 正确；日志无泄漏完整 prompt 中的敏感字段

## 短信 / 登录策略

- [ ] `APP_ENV=production` 时 **禁止** `SMS_PROVIDER=mock`（启动校验会拒绝）
- [ ] **产品策略：production 使用微信小程序登录**（`SMS_PROVIDER=none` → `SMS_UNAVAILABLE`）
- [ ] 真实 SMS（Aliyun/Tencent）为后续增强，不阻塞小程序首发

## 日志脱敏

- [ ] 确认生产日志无完整手机号、验证码、JWT、微信支付签名原文
- [ ] 实现：`backend/api/src/common/logging/redact.ts`（单元测试覆盖）

## 备份与回滚

- [ ] 定时任务调用 `backend/api/scripts/db-backup.sh`（建议每日 + 发布前）
- [ ] 备份落盘路径与保留天数已知
- [ ] 已演练一次 restore（见 [deploy-rollback.md](./deploy-rollback.md)）
- [ ] 发布前记录 git tag / 镜像 digest

## 管理员与 Seed

- [ ] 生产 `SEED_ON_STARTUP=false`
- [ ] 按 [staff-operations.md](./staff-operations.md) 创建独立 admin 与 moderator，并完成密码 + TOTP 真实登录
- [ ] 确认生产不存在 seed 手机账号、共享员工账号或默认密码
- [ ] Web `/admin/` 仅内网或 VPN 可达（推荐；至少不公开宣传）

## 监控与告警

- [ ] `GET /api/v1/health` 纳入探活
- [ ] `GET /api/v1/metrics` 仅内网抓取（勿对公网裸奔）
- [ ] 告警：5xx 率、依赖 down、磁盘、证书到期（工具自选）

## 微信开发者工具 / 发行

- [ ] 在官方微信开发者工具导入 `frontend/miniprogram`，选择与后端一致的 AppID
- [ ] 关闭“不校验合法域名”调试开关后完成编译、预览、体验版真机回归
- [ ] 上传体验版并完成微信审核；仓库 CI 只做结构/契约验证，不代替签名上传
- [ ] 隐私政策 / 用户协议 HTTPS 可打开（`/legal/privacy.html`、`/legal/terms.html`）

## 发布后冒烟

```bash
METRICS_TOKEN='<production token>' \
  ./backend/api/scripts/production-smoke.sh https://api.talkandtalk.app
```

`acceptance-smoke.sh` 依赖 mock SMS / mock 支付，仅允许在 development 或 staging 使用，禁止用于 production 放行。
