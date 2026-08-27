# Talk&Talk CTO 自检审查目录

> 最新执行包： [2026-08-26 商用闭环](./runs/2026-08-26-commercial-closure/state.md)。本页下方的 2026-08-04 基线说明仅保留方法与历史上下文，不代表当前工作树或发布状态。

> 建立日期：2026-08-04  
> 当前基线：`main@9cf5e38`，工作树包含既有 `frontend/web` 未提交改动  
> 首轮结论：**仓库能力较完整，但生产放行仍为 No-Go**。代码通过、文档勾选或本地健康检查均不能替代真实微信、真实资金、真实设备、真实运营与外部资质证据。
> 当前成熟度：这是控制库、执行模板和首轮 finding，不是已经签字的 G3 审批包；只有按候选实例化总控制台账并绑定证据后才可用于放行。

## 1. 这套目录解决什么问题

现有 `docs/` 已有大量专项报告，但它们分别回答某一次代码复审、某一个门禁或某一条业务链，测试数字和结论会随工作树变化。这里不再复制这些报告，而是提供一套长期可重复执行的 CTO 控制目录：

1. 先固定发布范围和业务承诺；
2. 再按控制项收集可复核证据；
3. 将仓库、staging、生产和放量四种结论分开；
4. 任何 P0 缺口都必须有责任人、截止时间、原始证据和复核人；
5. 敏感原件不进入 Git，只在这里保存受控引用、摘要或哈希。

## 2. 当前审查范围

| 面 | 当前口径 | 本目录处理方式 |
|---|---|---|
| `frontend/miniprogram` | 当前消费者与陪伴者正式客户端 | 全量审查 |
| `backend/api` | `/api/v1`、`/admin/`、`/review/` 的权威后端 | 全量审查 |
| `shared/contracts` | 冻结的 v1 契约 | 全量审查 |
| `infra` | 部署、网络、可观测性、备份与回滚材料 | 全量审查，但必须用目标环境证据放行 |
| `frontend/web` | 仓库存在并有活跃改动，但既有正式发行说明仍写“无消费者 Web 首发” | **范围待决策**；在明确是官网、体验站还是正式交易面前，不得用它证明小程序闭环 |
| `frontend/ios` | 历史/后续工程 | 默认排除；重新立项后另开发布门禁 |

## 3. 目录

| 文件 | 用途 |
|---|---|
| [00-method-and-evidence.md](./00-method-and-evidence.md) | 状态、优先级、证据等级和放行算法 |
| [01-commercial-benchmarks.md](./01-commercial-benchmarks.md) | 只按机制对标成熟商业产品，不整包照抄 |
| [02-product-marketplace-and-growth.md](./02-product-marketplace-and-growth.md) | 定位、供给、可售、履约、增长与单位经济 |
| [03-architecture-api-and-data.md](./03-architecture-api-and-data.md) | 架构边界、契约、状态机、数据与扩展性 |
| [04-security-privacy-and-identity.md](./04-security-privacy-and-identity.md) | 身份、权限、隐私、秘密、威胁与供应链安全 |
| [05-transactions-finance-and-disputes.md](./05-transactions-finance-and-disputes.md) | 订单、支付、退款、对账、结算与争议 |
| [06-trust-safety-and-operations.md](./06-trust-safety-and-operations.md) | 内容安全、申诉、危机、客服与人工运营 |
| [07-quality-sre-and-release.md](./07-quality-sre-and-release.md) | 测试、SLO、告警、容灾、CI/CD 与发布 |
| [08-compliance-and-external-gates.md](./08-compliance-and-external-gates.md) | 必须办、暂时不用、待平台确认及触发条件 |
| [09-governance-team-and-cost.md](./09-governance-team-and-cost.md) | 决策、职责、成本、供应商和技术债治理 |
| [10-long-running-web-miniprogram-delivery-guide.md](./10-long-running-web-miniprogram-delivery-guide.md) | 官网 + 微信小程序长期目标任务的阶段、续跑、验收和停止线 |
| [registers/current-assessment-2026-08-04.md](./registers/current-assessment-2026-08-04.md) | 本轮已确认优势、缺口与完成条件 |
| [registers/control-register.md](./registers/control-register.md) | 跨域控制项、证据和 Gate 的唯一索引模板 |
| [registers/risk-register.md](./registers/risk-register.md) | 战略和运营风险台账 |
| [registers/decision-log.md](./registers/decision-log.md) | 已知决策与待决策事项 |
| [evidence/README.md](./evidence/README.md) | 每次审查的证据包结构与敏感信息边界 |
| [templates/audit-run.md](./templates/audit-run.md) | 每次自检的执行记录模板 |
| [templates/evidence-record.md](./templates/evidence-record.md) | 单条证据记录模板 |
| [templates/long-running-task-state.md](./templates/long-running-task-state.md) | 长期任务每轮必须更新的断点续跑状态模板 |

## 4. 范围前置与四道门

| 门 | 通过含义 | 绝不能替代的证据 |
|---|---|---|
| G0 范围真实 | 唯一确认首发客户端、后端、域名、AppID、开关、排除面和 owner | 范围冲突时不得开始正式候选审批 |
| G1 仓库候选 | 当前 SHA 的构建、测试、契约、迁移、静态安全与制品检查通过 | 不代表远端可用 |
| G2 Staging | 隔离的真实 Postgres/Redis、真实微信测试主体、真机和故障演练通过 | 不代表可以收真钱 |
| G3 生产放行 | 外部资质、真实 KYC、真钱支付退款对账、恢复、告警和值班均有签字 | 不代表可以立刻放量 |
| G4 放量 | 履约、退款、安全、供给密度、复购和单位经济达到阈值 | 不能用下载量、曝光或 GMV 单独替代 |

放行规则：每个控制项必须声明目标 Gate 与所需证据等级。任一 P0 为 `PARTIAL`、`FAIL`、`BLOCKED`、`STALE`、`UNKNOWN` 或低于该 Gate 所需等级时，该 Gate 必须是 No-Go；P0 不接受 Conditional 或风险豁免。只有 P1 可在不危及资金、安全、隐私、资质和恢复的前提下，由有权角色限时接受。仓库型 P0 可用 E2 通过 G1，但涉及生产放行的 P0 必须取得相应 E4。

## 5. 本轮先看哪里

1. 先处理 [当前缺口台账](./registers/current-assessment-2026-08-04.md) 中的 P0；
2. 明确 `frontend/web` 的产品与发布身份；
3. 为同一候选 SHA 建立一份 [审查执行记录](./templates/audit-run.md)；
4. 将 [生产检查清单](../production-checklist.md) 的勾选项逐条绑定证据 ID；
5. 外部证据齐全后再运行 [Staging 验收](../staging-acceptance.md) 和受控生产 smoke。
