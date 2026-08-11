# 下一次 Codex 接手指示

> **历史交接快照（2026-07-19，不得继续作为当前执行指令）。** 下列迁移和待办只对应当时的聊天审核工作；当前接手必须先读实际 `git diff`、[商用界面闭环台账](./commercial-interface-closure.md)、[生产检查清单](./production-checklist.md) 与现有全部迁移，不能只执行本文列出的两个旧迁移。

当前工作区已完成聊天审核 v2 及全应用核心可靠性补强；先阅读 `git diff`，不要覆盖未提交改动。历史 iOS 工程仍不在本轮范围，正式范围是 NestJS、Web 运营后台与微信小程序。

## 当前执行边界

本文件的旧迁移/上线清单不可执行，尤其不得把其中的 staging、`test:preflight`、
`test:e2e`、支付开关或历史媒体流程当作当前发布指令。当前首发必须遵循
[`docs/cto-self-audit/runs/2026-08-08-g1-remediation`](./cto-self-audit/runs/2026-08-08-g1-remediation/)
中的冻结候选、零跳过、不可变制品、逐项授权和 G2 场景卡：

- 本地只可执行 `npm run test:preflight:static` 等无外部副作用门禁；
  PostgreSQL preflight 和 E2E 仅由获授权的密封 disposable runner 创建目标。
- 真实微信、支付/退款、TRTC、provider-media、staging/production 迁移与部署均需
  对应 Evidence ID、目标范围、有效期、执行者、收据和独立复核；当前不得推断授权。
- 当前 first-release 为 text-only，不能根据本历史快照打开媒体/TRTC 或支付相关
  provider 开关。

历史迁移名称仅供差异审计；任何新接手者先读当前 `git diff`、候选证据模板、G2
执行包和部署/回滚控制参考，再决定是否有获授权的下一步。

## 仍需外部环境完成的工作

- 真实微信登录、JSAPI 支付、退款回调与商户证书轮换联调。
- 真实媒体存储、图像/OCR、语音转写适配器的实现与验收。未注册真实、加密的适配器前，生产环境必须保持 `MEDIA_FEATURE_ENABLED=false`、`MEDIA_PROVIDER=disabled`。
- 审核员在 `/review/` 完成内容案件、证据、申诉与样本标注的人工验收；确认每个动作均有 ReviewAuditLog。退款、注销结算和陪伴者商业上架仍属非审核运营流程。
- 真机微信小程序验收通知深链、预约付款保留提示、聊天图片与短语音上传。

## 已完成的关键保障

- mock 支付回调仅在 mock 支付适配器运行时允许；真实支付配置的 staging 也会拒绝它。
- 已支付但服务窗口结束的订单由可恢复的数据库巡检处理；确认预约使用原子时段保留并自动释放。
- 媒体审核使用带过期租约的 compare-and-set 领取，避免多副本重复建案、重复限言或重复安全提醒。
- Web 运营后台已覆盖退款、注销结算、账号状态/实名及陪伴者上架；小程序通知支持未读、已读与订单/聊天跳转。
