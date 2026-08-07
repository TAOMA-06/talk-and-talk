# 总控制台账

> 本文件是跨域索引，不复制各专项目录的检查方法。每次形成发布候选时复制下表并绑定唯一证据；没有证据的空白项必须保留为 `UNKNOWN`，不能删除。

## 使用规则

1. `Control ID` 必须对应 `02`—`09` 中的一个稳定编号或本轮新增编号；重复视角必须指定 `canonical_control` 和 `related_controls`。
2. 同一控制跨多个 Gate 时拆成多行，避免用本地证据替代生产证据。
3. `required_evidence` 由风险决定；资金、安全、隐私、资质、恢复和真实运营的 G3 控制不得低于 E4。
4. 每个 P0 必须有 owner、独立 reviewer、截止时间、失效时间和失败关闭动作。
5. 敏感原件只保存受控 URI、最小脱敏摘要和 SHA-256，不进入 Git。

## 发布候选

- Release candidate ID：
- Commit / tag：
- Lockfile SHA-256：
- Image digest：
- Migration head：
- Config schema digest：
- Scope / excluded surfaces：

## 控制结果

| Control ID | canonical / related | scope / feature flag | Gate | Priority | required_evidence | Status | Evidence ID | owner | reviewer | deadline | expires_at | failure action / residual risk |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
|  |  |  |  |  |  | `UNKNOWN` |  |  |  |  |  |  |

## 外部门禁映射

| Control ID | 外部系统/机构 | 账号、主体或地域边界 | 原始回执 URI | SHA-256 | 状态 | 到期/复核日 | owner |
|---|---|---|---|---|---|---|---|
| CG-02 | 微信公众平台 |  |  |  | `UNKNOWN` |  |  |
| CG-03 | 微信公众平台 |  |  |  | `UNKNOWN` |  |  |
| CG-05 | 微信支付 |  |  |  | `UNKNOWN` |  |  |
| CG-11 | 属地网信/适用提交平台 |  |  |  | `UNKNOWN` |  |  |
| CG-12 | 属地网信/算法备案系统 |  |  |  | `UNKNOWN` |  |  |

## 放行签字

| Gate | 决策 | 阻断 Control ID | 批准角色 | 姓名/受控签字引用 | 时间 |
|---|---|---|---|---|---|
| G1 | No-Go |  | Engineering / Security |  |  |
| G2 | No-Go |  | Engineering / QA / Operations |  |  |
| G3 | No-Go |  | Product / Engineering / Operations / Finance / Compliance / Trust & Safety |  |  |
| G4 | No-Go |  | Product / Engineering / Finance / Operations |  |  |
