# Talk&Talk 商用界面市场交叉审查（第二轮复审）

审查日期：2026-08-02  
资料口径：截至审查日可访问的官方应用商店/帮助中心/协议/微信支付商户文档（及 2026-08-01 既有审查材料）  
审查对象：微信小程序、NestJS `/api/v1`、商业运营后台 `/admin/`、独立审核工作台 `/review/`  
方法：与 [commercial-market-cross-audit-2026-08-01.md](./commercial-market-cross-audit-2026-08-01.md) 对齐；先记官方事实，再映射仓库；状态仅用 `仓库闭环` / `仓库缺口` / `上线门禁` / `刻意不复制` / `待最终回归`。

> 说明：目标措辞中的「失眠同类应用 / 较差审查」按产品类「最新同类应用 + 交叉审查」理解；失眠类 App 不在成年陪伴/远程预约主类内，不作为定义性对标集合。

## 结论

**仓库侧：上一轮终检所列 8 项仓库缺口已在代码与自动回归中闭环；本轮复审未发现新的“后端已有但正式入口断裂 / 失败伪装为空 / 自审复核 / 队列不可遍历”类 P0/P1 仓库缺口。生产仍为 No-Go，直至外部 P0 证据齐全。**

对照说明：2026-08-01 报告仍叙述八项开放缺口，该叙述已被本轮代码重验与 `docs/production-checklist.md` 仓库项勾选 supersede；本文为当前仓库交叉审查结论。

### 上一轮八项仓库缺口复验

| 级别 | 缺口 | 本轮代码证据 | 结果 |
|---|---|---|---|
| P0 | 可申诉内容案件稳定入口 | `GET /moderation/appeals/eligible`；`pages/safety` appealableCases + 失败文案；smoke 覆盖资格未知≠无案 | 仓库闭环 |
| P0 | 普通用户 restriction/ban 动作与申诉 | `UserAccountActionsService` 不可变动作、通知、申诉截止；非原处置人 assign/resolve；locked-account 分区 | 仓库闭环 |
| P0 | banned 数据权利被 `/me` 挡住 | 账号页 banned 跳过 `fetchMe`，仍加载 data-rights/deletion；`SkipLegalConsent` | 仓库闭环 |
| P1 | 注销状态查询 | `GET/POST /me/deletion-request` + cancel；账号页 status/SLA/结果；tombstone 登录不可用页 | 仓库闭环 |
| P1 | 陪伴者账号动作自审 | `companion-lifecycle` 拒绝 `createdById === actorId` | 仓库闭环 |
| P1 | 退款队列固定 200 | `listRefundsAwaitingReview` 分页+total；`/admin/` 翻页 | 仓库闭环 |
| P1 | 注销管理固定首页 | `listAccountDeletions` + `#deletionPagination` | 仓库闭环 |
| P1 | 订单时间线/服务单/客服失败→空 | `timelineError`、services `loadError`、support `partialWarning`/`error` | 仓库闭环 |

### 本轮额外仓库修复（非市场对标新增，属可执行验收闭环）

| 项 | 证据 | 结果 |
|---|---|---|
| 注销保留快照 registry 51→54 与单测不同步 | 更新 pin 测试与 final-gate/sourceCount 期望；新增源：`financial_payment_dispute_orders`、`controlled_case_evidence_attachments`、`companion_customer_future_boundaries` | 仓库闭环 |
| `data-retention.worker` 错误方法名导致编译失败 / 递归风险 | 未处理 phase 返回 `null` 交还 `processRetainedPhaseBatch`；隐式 any 参数显式化 | 仓库闭环 |
| `account.status_updated` 缺 `resourceId` | 写入 `resourceId: userId` | 仓库闭环 |
| 可约提醒审计缺 `companionId` | 与其它 favorite 审计一致写入 | 仓库闭环 |
| 语音关房审计测桩缺 order 主体 | 单测补齐 `order.findUnique` 主体 | 仓库闭环 |
| `JwtAuthGuard` 依赖 tombstone 服务导致 feature 模块无法启动 | `AuthModule` 标记 `@Global()`；本地启动 `/api/v1/health` → `status=ok` 且 database/redis ok | 仓库闭环 |

## 分组复审（事实 / 判断 / 未知）

### 1. 国内陪伴、倾诉与泛社交

| 市场事实（官方） | 判断 | 仓库证据 | 结果 |
|---|---|---|---|
| 松果倾听者规范（页面标题「松果倾诉平台倾听者服务规范」）要求真实身份、禁止非咨询师包装心理咨询、接单响应与不文明服务定义 | 下单意图可解释、认证不暗示医疗、供给质量可处置 | `service-intent-policy`、商业档案双人复核、质量/账号动作 | 仓库闭环；真实 KYC 上线门禁 |
| 松果分用户端与倾听者端两个 App | 拆包非商用必需 | 同一小程序角色工作台 | 刻意不复制 |
| Soul 隐私政策（审查日仍可达）提供查阅/复制/更正/删除/注销等个人信息权利 | 限制/封禁态下法定入口仍需可达 | data-rights + deletion-request + banned 分区 | 仓库闭环；法务文本上线门禁 |

### 2. 全球同伴支持与安全边界

| 市场事实 | 判断 | 仓库证据 | 结果 |
|---|---|---|---|
| 7 Cups 强调匿名、禁止站外联系、危机另寻专业资源（社区/安全资料） | 非危机边界 + 站内沟通 + 升级路径必需 | 安全中心、危机页、训练边界 | 仓库闭环；地区危机 SOP 上线门禁 |
| Supportiv / Papa 等强调训练同伴、非治疗、状态与安全 | 不照搬上门背景审查强度 | 培训/复审/状态可见 | 仓库闭环 + 上线门禁 |

### 3. 远程预约、双边交易与申诉

| 市场事实 | 判断 | 仓库证据 | 结果 |
|---|---|---|---|
| Preply 退款帮助中心文稿 `dateModified` 2026-07-28 仍区分课程问题/支持退款路径 | 体验、资金、安全分域 | 评价/客服/出席争议/退款/支付投诉分域 | 仓库闭环 |
| 账号停用申诉需独立复核（Airbnb/Rover/Upwork 类） | 用户与陪伴者均需非原处置人 | 用户与陪伴者 account action appeal | 仓库闭环 |
| Cambly 默认录课 | 情绪陪伴默认录音风险高 | 默认不录音 | 刻意不复制 |

### 4. 微信支付消费者投诉 2.0

| 微信官方要求（交易投诉运营规范，文档更新时间 2024.09.23，审查日正文仍有效） | 仓库能力 | 结果 |
|---|---|---|
| 投诉生成后 1 日内首次回复；3 日内处理完成；用户可继续投诉 | readiness SLA、禁止提前完结、本人可见投诉状态、失败≠空列表 | 仓库闭环；真实商户登记上线门禁 |
| 通知/列表/详情回补与幂等 | complaint-notify、轮询、行锁、outcomeUnknown | 仓库闭环 + 上线门禁 |

## 刻意不复制（维持）

- 不拆两个消费者安装包  
- 不默认录音  
- 不宣称保险/无条件担保  
- 不补未成年人模式  
- 不做礼物币/财富榜/付费排名  
- 不把 AI 当危机处置人  

## 新发现仓库缺口

**无。** 本轮可在仓库内完成的事项已进入自动回归或启动探测证据。

## 上线门禁（代码不能代替）

见同期 `{SCRATCH}/external-blockers.md` 与根 `NEXT_PHASE.md` / `docs/production-checklist.md` 未勾选外部项。任一外部 P0 无原始证据时，`COMMERCIAL_RELEASE_MODE` 不得为 commercial，不得开放真实付费流量。

## 最终判定

| 层 | 判定 |
|---|---|
| 仓库闭环 | **Go（自动化）** — 正式入口、真实 API 状态、失败关闭、双人/非自审、分页总量可由单测/预检/构建/小程序 smoke/迁移/本地 health 证明 |
| 生产放行 | **No-Go** — 外部 P0 证据与签字未齐 |

## 本轮自动验证摘要（2026-08-02）

- `backend/api` `npm test`：141 suites / 1265 tests 通过  
- `npm run test:preflight`：64 pass / 7 skip / 0 fail  
- `npm run build` + `verify:prod-artifacts`：通过  
- 隔离 Postgres `prisma migrate deploy`：全部迁移成功  
- 小程序 `validate.mjs`：31 pages / 5 tabs；`smoke.mjs`：788 API calls 通过  
- 本地 API 启动：`GET /api/v1/health` → `status=ok`，database/redis ok  
- 完整 E2E：需专用 Redis DB index（1–15）+ `E2E_REDIS_FLUSH_ALLOWED=1`；默认 `.env` Redis 非专用库，**不**记为通过  
