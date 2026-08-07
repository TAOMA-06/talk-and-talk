# 自检执行记录模板

## 1. 元数据

- Audit ID：
- 日期/时区：
- 候选 SHA：
- Release candidate ID / tag：
- 工作树：clean / dirty（附 `git status --short` 摘要）
- 发布面：
- Lockfile SHA-256：
- 镜像 digest / 制品哈希：
- Migration head：
- 配置 schema digest：
- 环境：local / staging / production-read-only
- 审查负责人：
- 独立复核人：

## 2. 本轮范围

- 包含：
- 排除：
- 与上次相比的变更：
- 需要重新失效的旧证据：

## 3. 控制结果

| Control ID | canonical / related | scope / flag | Gate | Priority | required / actual | Status | Evidence ID | owner / reviewer | 截止/失效 | 备注 |
|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | |

## 4. 自动验证

| 命令/CI | 环境 | 结果 | 数量/摘要 | 日志或制品引用 |
|---|---|---|---|---|
| | | | | |

## 5. 真实链路与演练

| 场景 | 账号/数据边界 | 预期 | 实际 | Evidence ID |
|---|---|---|---|---|
| | | | | |

## 6. 决策

- G0 范围真实：Go / No-Go
- G1 仓库候选：Go / Conditional（仅 P1）/ No-Go
- G2 Staging：Go / Conditional（仅 P1）/ No-Go
- G3 生产：Go / Conditional（仅 P1）/ No-Go
- G4 放量：Go / Conditional（仅 P1）/ No-Go
- 阻断项：
- 已接受残余风险及批准人：
- 回滚触发器/执行人：
- 下一次复核日期：
