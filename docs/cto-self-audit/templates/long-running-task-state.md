# 长期任务断点续跑状态

> 每个长期目标只保留一份权威 `state.md`。每个切片完成、中断、上下文压缩或范围变化前更新；不要把过程聊天当状态存储。

## 1. 目标与基线

- Task ID：
- Objective：
- Started at / timezone：
- Branch / baseline SHA：
- Current SHA：
- Worktree：clean / dirty
- Included surfaces：
- Excluded surfaces：
- Product boundary decision / Evidence ID：

### Dirty ownership map

> 启动时逐文件/目录登记。任何未登记的新 diff 或无法解释的 hash 变化都是停止线。

| path | initial status | baseline SHA-256/blob hash | ownership | allowed action | current hash | divergence | reviewer |
|---|---|---|---|---|---|---|---|
| | | | user / task / generated / unknown | preserve / modify / regenerate / inspect-only | | none / explained / unexplained | |

### 模型审计

> 每个实际参与的智能体、角色和切片单独登记。Planner/reviewer 的 requested model 必须是 `gpt-5.6-sol`、reasoning 必须是 `ultra`；writer 的 requested model 为用户指定的 Luna Ultra。`actual model`、`reasoning` 或 `checked_at` 缺失时，该智能体产出不得进入 `completed`。

| agent | role | Slice ID | requested model | actual model | reasoning | checked_at | Luna capability result | fallback approval Evidence ID |
|---|---|---|---|---|---|---|---|---|
| | planner / reviewer / writer / integrator | | | | | | callable / unavailable / N/A | N/A |

## 2. 当前状态

- Phase：
- Work status：pending / in_progress / awaiting_review / completed / blocked / cancelled
- User-facing：保留 / 调整 / 暂停 / 待验证 / 上线门禁
- Last completed slice：
- In-progress Web slice（最多一个）：
- In-progress Mini Program slice（最多一个）：
- In-progress shared/integration slice（全局最多一个；运行时客户端实现为零）：
- Integration next exact action：
- Integration owner：
- Integration reviewer：

### Gate matrix

| Gate | status | evidence | blocker | next condition |
|---|---|---|---|---|
| G0 | UNKNOWN | | | |
| G1 | UNKNOWN | | | |
| G2 | UNKNOWN | | | |
| G3 | UNKNOWN | | | |
| G4 | UNKNOWN | | | |

Gate status 只使用：`PASS / PARTIAL / FAIL / BLOCKED / STALE / UNKNOWN / N/A`。`G2-ready` 写在 evidence/next condition，不得把它填成 G2 PASS。

### File leases

> 全局最多两个实现切片；共享/backend/CI 切片只能串行，且不得与客户端实现并行。

| path/glob | surface | Slice ID | owner | agent | baseline SHA/hash | acquired_at | last heartbeat/checkpoint | release status |
|---|---|---|---|---|---|---|---|---|
| | web / mini / shared / backend / CI | | | | | | | active / released / conflicted |

heartbeat 超时不得自动释放 lease。集成负责人必须核对 live agent、对应 diff、baseline/current hash 和最后 checkpoint，记录转移 Evidence ID 后才能重新分配；无法核对时标记 `conflicted`。

## 3. 切片队列

| Slice ID | 用户结果 | 文件/API 范围 | owner | reviewer | Work status | Audit status | last checkpoint | next exact action/command | 验收 | Evidence ID |
|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | pending | UNKNOWN | | | | |

## 4. 决策与确认

| Decision ID | 问题 | 推荐选项 | 其他选项/代价 | 用户结论 | 日期 | 重新评估触发器 |
|---|---|---|---|---|---|---|
| | | | | pending | | |

## 5. 验证摘要

> 当前结论只在本文件维护。完整命令与场景结果 append-only 写入 `validation.md`，本表只引用 Evidence ID。

| 时间 | SHA | 命令/场景 | 环境/设备 | 结果 | pass/fail/skip 数量 | 日志/Evidence ID | 失效条件 |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## 6. 风险与停止线

| ID | Priority | 风险/阻断 | 当前证据 | failure action | owner | 截止/复核 | 状态 |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## 7. 外部动作等待区

> 每个动作单独一行、单独授权；环境、AppID、版本、域名、金额、账号或参数变化后不得复用旧授权。动作包括但不限于 git push/PR、各环境部署、DNS/TLS/云资源、GitHub/微信变量、体验版上传、账号/法律域名/隐私配置、真钱和外部消息。

| Action | exact target | authorization source / Evidence ID | scope | granted_at | expires_at | executor | result | post-check |
|---|---|---|---|---|---|---|---|---|
| | | Not authorized | | | | | not run | |

## 8. 本轮 handoff

> 本节由上述当前状态生成快照；不要在 `handoff.md` 维护另一套活动状态。

- Actually completed：
- Changed files：
- Preserved user changes：
- Verified：
- Failed / skipped / not verified：
- Residual risks：
- Next exact action：
- User action needed：
