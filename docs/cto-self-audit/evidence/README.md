# 审查证据目录约定

不要把真实身份证、合同、银行卡、OpenID、聊天、支付签名、私钥或生产连接串复制到这里。每次正式审查在受控证据系统建立 `AUDIT-YYYYMMDD-<short-sha>`，Git 中只保存索引和脱敏摘要。

建议的每次审查结构：

```text
AUDIT-YYYYMMDD-<short-sha>/
├── 00-scope/                 # SHA、工作树、发布面、系统/信任边界
├── 01-architecture-api/      # 模块图、契约 diff、错误/RBAC 矩阵
├── 02-data-migrations/       # schema、迁移、锁时长、数据探针
├── 03-transactions/          # 下单、支付、退款、对账、结算、争议
├── 04-security-privacy/      # threat model、日志、秘密、留存、PIA
├── 05-supply-chain/          # SBOM、漏洞、许可证、镜像 digest/签名
├── 06-performance-dr/        # 压测、pool、备份、PITR、恢复、failover
├── 07-observability/         # 指标、规则、仪表盘、告警注入、paging
├── 08-device-operations/     # 真机、弱网、无障碍、客服/审核/危机演练
├── 09-external-platform/     # 微信/备案/KYC/商户的受控原始回执引用
└── 10-release-decision/      # P0/P1/P2、waiver、Go/No-Go、签字
```

每个文件使用 [证据记录模板](../templates/evidence-record.md)，最终结论使用 [自检执行记录模板](../templates/audit-run.md)。

