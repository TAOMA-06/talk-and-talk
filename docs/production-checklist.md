# 生产环境检查清单

上线前在 **staging 验证通过** 后，对 production 逐项勾选。  
本清单只检查配置与运维门禁，**不扩展产品功能**。正式交易模型、停机红线和外部签字责任见 [COMMERCIAL_RELEASE.md](./COMMERCIAL_RELEASE.md)；已知未完成能力见 [NEXT_PHASE.md](../NEXT_PHASE.md)。

## 商用模式总门禁

- [ ] `COMMERCIAL_RELEASE_MODE=commercial`；`REFUND_REQUEST_WINDOW_HOURS`、`COMPANION_SETTLEMENT_HOLD_HOURS` 与经批准规则一致，且结算至少晚于退款窗口 24 小时
- [ ] `ORDER_INTAKE_ENABLED`、总量/单用户/单陪伴者容量与 `ORDER_MAX_SCHEDULE_DAYS` 已按排班和值班能力设置；事故演练能暂停新单但仍允许同幂等键找回原订单
- [ ] `/admin/commercial/readiness` 返回 `clear`，并由值班人员核对失败/超时退款、超时工单、失败推送、过期推送租约、待复核商业档案、未结追偿、超时结算、审核服务故障、严重/超时审核、媒体删除失败、过期支付、预约响应/支付保留超时、已过履约窗口待退款和超时服务订单均为 0
- [ ] `SUPPORT_MAX_OPEN_PER_USER` 与实际客服容量一致；普通工单达到上限会被拒绝，但紧急安全工单仍可进入队列
- [ ] 每位上架陪伴者均具备已复核的实名状态与商业档案；收款对象、税务档案、身份和协议只保存受控外部证据引用
- [ ] 已逐笔处置历史已支付/服务中/已完成订单、失败退款、未结工单及缺少结算快照的应结款；禁止伪造历史核验结果
- [ ] 产品、工程、运营/客服、财务和法律/合规完成 Go 签字；任一外部 P0 未签字均不得开放真实付费流量

## 网络与 TLS

- [ ] HTTPS 已启用（`infra/nginx/talk-and-talk.conf.example` 或等价反向代理）
- [ ] HTTP → HTTPS 301 跳转正常
- [ ] 证书未过期；续期流程已知（ACME 或手动）
- [ ] `curl -fsS https://api.talkandtalk.app/api/v1/health` 返回 `ok` 或可接受的 `degraded`

## CORS / JWT / 密钥

- [ ] `cd backend/api && npm run preflight:deployment -- .env.production` 通过
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
- [ ] 迁移前确认 `RefundTransaction.providerRefundId` 的非空值无重复；若有差异先逐笔对账，不得删除或随意改写财务记录来强行通过唯一索引
- [ ] `20260720163000_refund_reconciliation_schedule` 已部署；现存 `processing` 退款已获得 `nextReconcileAt`，worker 扫描后不存在长期逾期租约

## 微信支付

- [ ] `GET /api/v1/payments/status` 返回 `provider=real`、`productionReady=true`
- [ ] `WECHAT_PAY_APP_ID` / `MCH_ID` / `API_V3_KEY` / `CERT_SERIAL_NO` / `NOTIFY_BASE_URL` 已填
- [ ] 私钥二选一：CloudBase 使用加密环境变量 `WECHAT_PAY_PRIVATE_KEY`；Compose 使用 `WECHAT_PAY_PRIVATE_KEY_HOST_PATH` 指向 host PEM，并只读挂载为容器内 `WECHAT_PAY_PRIVATE_KEY_PATH`（见 [`infra/secrets/README.md`](../infra/secrets/README.md)）
- [ ] 商户私钥未提交到仓库、未进入小程序包、未出现在日志中
- [ ] 通知 URL 可达：`https://api.talkandtalk.app/api/v1/payments/wechat/notify`
- [ ] 生产未配齐微信时 prepay 返回 `WECHAT_PAY_NOT_CONFIGURED`（**禁止** Mock 提供商）
- [ ] 真实 prepay / 平台证书验签 / resource 解密已联调通过（沙箱或生产小额）
- [ ] 生产启动时能主动拉取并解密当前微信平台证书；证书或商户签名异常会阻止实例接流量，而不是等首个支付回调才暴露
- [ ] staging 演示仍可用 mock-notify；production mock-notify → 403

## 微信小程序

- [ ] `GET /api/v1/auth/wechat/mini-program/status` 返回 `configured=true`
- [ ] 使用 `wx.request` 时，小程序主体与 `api.talkandtalk.app` 已完成所需备案并配置 request 合法域名；使用云托管 `callContainer` 时已关联对应 CloudBase 环境
- [ ] `WECHAT_MINIPROGRAM_APP_ID` / `WECHAT_MINIPROGRAM_APP_SECRET` 已填；AppSecret 仅存在于部署机密中
- [ ] 微信支付商户号已绑定小程序 AppID，并开通 JSAPI 支付；真机已完成一笔小额支付与退款
- [ ] 小程序后台已配置隐私保护指引；`/legal/privacy.html` 与 `/legal/terms.html` 均能在微信内打开
- [ ] 小程序支付成功后以服务端回调订单状态为准；取消支付不将订单标记 paid
- [ ] 演练“微信预下单已受理但 API 超时/进程退出”：本地 `outTradeNo` 不丢失、不生成第二笔可支付单，后台对账能回补成功或确认关单，`stalePrepays` 最终归零

## 微信订阅通知

- [ ] 生产配置的十个逻辑模板键均映射到实际审批通过的模板 ID，字段与小程序授权场景一致
- [ ] 真机逐个验证授权、发送、拒绝授权、模板更换和授权耗尽；旧模板授权不得用于新模板
- [ ] 失败投递进入后台商用门禁并配置跨副本告警；不得对结果未知的一次性消息自动重发

## 退款、结算与财务对账

- [ ] 完成微信支付日账单、退款账单与系统订单/支付/退款台账逐笔对账，并有差异处置负责人和 SLA
- [ ] `PAYMENT_RECONCILIATION_ENABLED=true`；演练退款提交时 API 超时/进程退出和退款回调丢失：本地唯一 `outRefundNo` 不丢失，worker 查询微信后恢复状态；仅 `RESOURCE_NOT_EXISTS` 以原退款号、原交易和原金额幂等重提，查询按数据库时间递增退避，多副本只允许一个租约获胜
- [ ] 超时退款会出现在后台队列；管理员“查询微信退款状态”可恢复，查询返回的 `outRefundNo` 不匹配时拒绝落账；显式 `failed` 状态仍必须走独立审计的管理员重试，状态同步不得绕过审批
- [ ] 退款失败会持续冻结应结款；退款成功后若原应结款已付款，会生成追偿记录并冻结该陪伴者后续结算
- [ ] 演练一次超出自助窗口的订单工单：仅当前负责人可发起例外退款，且发起人与退款审核人不同
- [ ] 用 `moderator` 账号确认退款队列与批准/拒绝/重试均为 403；仅 `admin` 可执行资金处置
- [ ] 以相同 `clientRequestId` 重放创建订单并确认只生成一笔；验证单用户、单陪伴者与全局未结订单上限，以及 `ORDER_INTAKE_ENABLED=false` 的停单流程
- [ ] 验证 `PAYOUT_CLAIMS_ENABLED=false` 只阻止领取新付款任务，不阻断已经发生的转账凭证补录、复核和追偿
- [ ] 人工结算仅在已批准的低容量上限内使用；领取、带外转账、唯一流水/金额/收款对象/凭证摘要和第二人复核均完成
- [ ] 演练一次“领取后未转账”：原领取人不能自撤，另一名管理员凭受控引用和 SHA-256 复核释放，审计日志可追溯
- [ ] 规模化前已接入受监管的付款提供方，或由财务与合规书面批准继续使用人工模式的容量与值班上限

## DeepSeek（可选）

- [ ] 配置真实 `DEEPSEEK_API_KEY`、HTTPS 端点和明确模型；用无害/违规/自伤样本验证结果、超时与无效响应。生产缺失凭据会拒绝启动，运行时故障必须让聊天/社区转人工且公开资料写入返回 503
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
- [ ] 恢复演练覆盖新增商业档案、订单快照、应结款、退款追偿、客服结论、通知 outbox 与法律同意证据
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
- [ ] 商用业务告警：失败退款、超时工单、失败通知、追偿逾期、结算任务超时、服务订单超时；告警在多副本环境可聚合并实际触达值班人员

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

生产烟测严格要求 health/database/redis 全部为 `ok`、小程序凭证已配置、支付 provider 为 `real`、短信 Mock 关闭、法律页可访问且公网 metrics 被阻断。可提供短期 `PRODUCTION_ACCESS_TOKEN` 额外验证 authenticated mock-notify 返回 403。
