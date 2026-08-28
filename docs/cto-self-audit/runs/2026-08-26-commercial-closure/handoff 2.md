# 2026-08-26 商用闭环交接

## 当前可交付物

- 最新官方市场映射：[commercial-market-cross-audit-2026-08-25.md](../../../commercial-market-cross-audit-2026-08-25.md)
- 当前状态：[state.md](./state.md)
- 可执行验证：[validation.md](./validation.md)
- 外部门禁：[external-blockers.md](./external-blockers.md)

## 下一位负责人必须按顺序完成

1. 固定当前工作树为新的干净候选 SHA；不得把基线 `2882bf9` 当作包含本轮变更的候选。
2. 在独立受保护控制面用该 SHA 重新执行零跳过 API、Web、Mini、PostgreSQL、迁移兼容和制品/SBOM 门禁。
3. 接入真实、可撤销、可到期的身份 authority；在此之前不得解除新订单、预支付、社区发布和消息硬门。
4. 提供微信 AppID/主体/类目/隐私/商户/模板、公共 DNS/TLS、真实 KYC、法务、客服安全值班和生产基础设施原始证据。
5. 先在受控 staging 做真机、真实测试商户、弱网、退款/对账、备份恢复和回滚，再由独立复核人决定是否进入 G2/G3。

## 禁止误用

- 不得把本机工作树的单测、E2E、PostgreSQL 或依赖 audit 清零写成“生产已上线”；精确数字只读 [validation.md](./validation.md)，且仍非冻结候选证据。
- 不得用历史 `isVerified=true`、测试 spy、Mock 支付或手工数据库更新解除身份/资金门。
- 不得把媒体删除请求当作存储已删除，也不得在 pending/active legal hold 下继续 claim。
- 不得向客户返回陪伴者私密预约原因、事件附件、账号处罚内部原因、内部订单主体或证据快照。
- 未经用户另行授权，不推送分支、不创建 PR、不部署 Web/API/小程序。
