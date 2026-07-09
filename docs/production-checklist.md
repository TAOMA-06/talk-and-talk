# 生产环境检查清单

上线前在 **staging 验证通过** 后，对 production 逐项勾选。  
本清单只检查配置与运维门禁，**不扩展产品功能**。已知未完成能力见 [NEXT_PHASE.md](../NEXT_PHASE.md)。

## 网络与 TLS

- [ ] HTTPS 已启用（`deploy/nginx/talk-and-talk.conf.example` 或等价反向代理）
- [ ] HTTP → HTTPS 301 跳转正常
- [ ] 证书未过期；续期流程已知（ACME 或手动）
- [ ] `curl -fsS https://api.talkandtalk.app/api/v1/health` 返回 `ok` 或可接受的 `degraded`

## CORS / JWT / 密钥

- [ ] `CORS_ORIGINS` 为显式 allowlist（生产禁止依赖开发默认列表）
- [ ] `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` 为高强度随机值，非 `CHANGE_ME` / 开发默认
- [ ] access / refresh 密钥互不相同
- [ ] `.env.production` 未提交到 git（见根 `.gitignore`）

## 数据库与 Redis

- [ ] `DATABASE_URL` 使用强密码；与 compose `POSTGRES_PASSWORD` 一致
- [ ] Postgres 不直接对公网暴露
- [ ] `REDIS_URL` 生产建议 `redis://:PASSWORD@host:6379`（requirepass）；至少不公网裸奔
- [ ] health 中 `dependencies.database` / `dependencies.redis` 为 `ok`

## 微信支付

- [ ] `WECHAT_PAY_APP_ID` / `MCH_ID` / `API_V3_KEY` / `CERT_SERIAL_NO` / `NOTIFY_BASE_URL` 已填
- [ ] `WECHAT_PAY_PRIVATE_KEY_PATH` 指向容器内可读私钥；compose / 宿主机已挂载
- [ ] 通知 URL 可达：`https://api.talkandtalk.app/api/v1/payments/wechat/notify`
- [ ] **代码现状：** 真实预支付/平台证书验签若仍为壳实现，**生产真实收款不可用** → 见 NEXT_PHASE；staging 用 mock-notify 演示

## DeepSeek（可选）

- [ ] 未配置 `DEEPSEEK_API_KEY` 时确认纯规则审核可接受
- [ ] 若配置了 key：URL/Model 正确；日志无泄漏完整 prompt 中的敏感字段

## 短信

- [ ] `APP_ENV=production` 时 **禁止** `SMS_PROVIDER=mock`（启动校验会拒绝）
- [ ] 当前实现仅 `mock` / `none`；`none` 下手机验证码登录不可用
- [ ] 生产手机号登录策略二选一写明：仅 Apple 登录，或阻塞上线直到真实 SMS（NEXT_PHASE）

## Apple 登录

- [ ] `APPLE_SIGN_IN_BUNDLE_ID=com.talkandtalk.app`（与 iOS 一致）
- [ ] Apple Developer 中 Sign in with Apple 已启用对应 App ID

## 日志脱敏

- [ ] 确认生产日志无完整手机号、验证码、JWT、微信支付签名原文
- [ ] 实现：`services/api/src/common/logging/redact.ts`（单元测试覆盖）

## 备份与回滚

- [ ] 定时任务调用 `services/api/scripts/db-backup.sh`（建议每日 + 发布前）
- [ ] 备份落盘路径与保留天数已知
- [ ] 已演练一次 restore（见 [deploy-rollback.md](./deploy-rollback.md)）
- [ ] 发布前记录 git tag / 镜像 digest

## 管理员与 Seed

- [ ] 生产 `SEED_ON_STARTUP=false`
- [ ] 首次 seed 后立即轮换/限制默认 admin、moderator 手机号账号
- [ ] Web `/admin/` 仅内网或 VPN 可达（推荐；至少不公开宣传）

## 监控与告警

- [ ] `GET /api/v1/health` 纳入探活
- [ ] `GET /api/v1/metrics` 仅内网抓取（勿对公网裸奔）
- [ ] 告警：5xx 率、依赖 down、磁盘、证书到期（工具自选）

## iOS / App Store 联动

- [ ] Release `BACKEND_BASE_URL=https://api.talkandtalk.app`
- [ ] `WECHAT_APP_ID` 与后端商户配置一致
- [ ] 隐私政策 / 用户协议 HTTPS 可打开（`/legal/privacy.html`、`/legal/terms.html`）
- [ ] 见 [app-store-metadata.md](./app-store-metadata.md)

## 发布后冒烟

```bash
./services/api/scripts/acceptance-smoke.sh https://api.talkandtalk.app
```

生产若禁用 mock 支付/SMS，冒烟脚本中相关步骤可能失败——按环境裁剪或仅跑 health + Apple/登录可达性检查。
