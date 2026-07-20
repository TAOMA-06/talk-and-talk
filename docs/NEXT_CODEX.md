# 下一次 Codex 接手指示

当前工作区已完成聊天审核 v2 及全应用核心可靠性补强；先阅读 `git diff`，不要覆盖未提交改动。历史 iOS 工程仍不在本轮范围，正式范围是 NestJS、Web 运营后台与微信小程序。

## 上线前必须完成

1. 在 staging 按顺序部署并验证以下迁移：

   ```text
   20260719070000_chat_moderation_v2
   20260719100000_core_reliability_fixes
   ```

   后一迁移增加媒体审核租约、聊天案件去重索引与预约支付保留截止时间。

2. 运行完整验证：

   ```bash
   cd backend/api
   npm run prisma:generate
   npm test
   npm run test:preflight
   npm run verify:prod-artifacts

   cd ../../frontend/miniprogram
   ../../backend/api/node_modules/.bin/tsc -p tsconfig.json --noEmit
   node scripts/validate.mjs
   node scripts/smoke.mjs
   ```

3. 在专用、可销毁的 PostgreSQL + Redis 环境运行 `npm run test:e2e`。该套件会清理测试 Redis，不能指向共享或生产实例。

4. 配置并监控 `PAYMENT_RECONCILIATION_ENABLED=true`、60 秒间隔与告警。重点演练：预约保留超时释放、服务结束后未开始的自动退款、失败退款的受控重试、账号注销资金结算。

5. 每次编辑 `backend/api/public/admin/index.html` 后，重新计算内联脚本 SHA-256 并更新 `src/main.ts` 的 Helmet CSP；`npm run verify:prod-artifacts` 必须通过，不能手工跳过。

## 仍需外部环境完成的工作

- 真实微信登录、JSAPI 支付、退款回调与商户证书轮换联调。
- 真实媒体存储、图像/OCR、语音转写适配器的实现与验收。未注册真实、加密的适配器前，生产环境必须保持 `MEDIA_FEATURE_ENABLED=false`、`MEDIA_PROVIDER=disabled`。
- 审核员在 `/admin/` 完成退款、注销结算、账号状态/实名、陪伴者上架和媒体证据预览的人工验收；确认每个动作均有审计记录。
- 真机微信小程序验收通知深链、预约付款保留提示、聊天图片与短语音上传。

## 已完成的关键保障

- mock 支付回调仅在 mock 支付适配器运行时允许；真实支付配置的 staging 也会拒绝它。
- 已支付但服务窗口结束的订单由可恢复的数据库巡检处理；确认预约使用原子时段保留并自动释放。
- 媒体审核使用带过期租约的 compare-and-set 领取，避免多副本重复建案、重复限言或重复安全提醒。
- Web 运营后台已覆盖退款、注销结算、账号状态/实名及陪伴者上架；小程序通知支持未读、已读与订单/聊天跳转。
