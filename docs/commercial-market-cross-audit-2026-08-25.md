# Talk&Talk 商用界面市场交叉审查（2026-08-26 修复后最终复审）

市场资料刷新：2026-08-25
修复后最终复审：2026-08-26
对象：微信小程序、NestJS API、商业运营后台、独立审核工作台、官方营销 Web
方法：市场产品审查与规模/安全审查交替进行；市场事实只取官方应用商店、帮助中心或平台政策，仓库结论只取当前代码、迁移和可执行验证。历史 [2026-08-02 复审](./commercial-market-cross-audit-2026-08-02.md) 不再代表当前候选。

## 结论

本轮市场复审先发现 2 项仓库 P1，随后由产品、规模和安全审查交替复核，又发现 1 项 P0 与多项 P1/P2。全部发现修复后，市场/规格、标准及安全/规模三路只读复审的当前工作树结论均为 **可操作仓库 P0=0、P1=0、P2=0**。这只是未冻结工作树的调查结论；任何未获得外部原始证据的生产事项仍保持 No-Go。

### 本轮发现与处置

| 级别 | 发现 | 当前处置 |
|---|---|---|
| P0 | 身份授权门固定失败，但系统仍允许创建订单和预支付，可能形成“已收款、唯一文字交付渠道不可用” | 新订单和预支付复用消息身份门并在任何业务/支付写入前拒绝；商业 readiness 永久显示身份 authority blocker，直至真正接入可撤销的授权模型；正式版隐藏预约、支付、社区发布和聊天输入，保留已有订单、售后、客服与安全 |
| P1 | 陪伴者处罚申诉推翻后只撤销动作，商业资格仍冻结；临时 suspension 到期也没有恢复路径 | 推翻与自然到期均进入持久化、独立复核的 reactivation 状态机；不自动重新发布；恢复只在当前 KYC、成年、培训、商业证据和其它限制均通过后清除精确 causal suspension，再走显式发布 |
| P1 | 普通用户申诉无附件；陪伴者申诉接受任意 `evidenceReferences` | 两类申诉统一接入 reserve → 上传 → 摘要核验 → 安全审核 → approved → 单次绑定；最多 3 件；任意字符串入口移除 |
| P1 | `support_disputes_safety` 留存到期声明 30 阶段，但多个阶段无执行器；`AuditSubjectReference` 可残留 | 补齐完整有界执行图、共享双边匿名化、媒体两段删除和终态后置条件；主体引用按 250 行 CTE 清理并保留同日志其他主体 |
| P1 | 法律留置可能晚于媒体删除排程，且普通 180 天媒体清理早于三年保留到期 | 媒体与 retention record 持久绑定；删除 claim 与留置放置采用同一记录锁序；pending/active hold 阻断 claim，已进入外部删除的不确定状态明确拒绝伪保全；release 后重新唤醒 |
| P1 | 陪伴者对客户的私密未来预约边界使用唯一错误码，且旧 owner 在换绑竞态中可能写入 | 私密边界与普通不可约统一使用无原因 envelope；事务锁后重读当前 owner；历史订单、聊天和客服不变 |
| P1 | 所有 supply 员工都能读取全部陪伴者安全事件附件 | 安全事件加入并发安全认领/分配；普通 supply 仅当前 assignee 可见附件并签短期 URL，admin 才有全局视图 |
| P1 | 2026-08-25 依赖审计出现新高危公告 | 后端锁定安全传递依赖；Web 升级 Next/Vinext/Cloudflare/Vite/React 及构建链，并验证 Worker 静态资源仍经过安全头；三个发行根的完整 audit 重新清零 |
| P1 | 后台仍展示必然 409 的新实名提交/批准，正式小程序历史待支付订单仍显示支付并先请求订阅授权 | Admin 只保留实名撤销和拒绝；订单列表、详情和直达支付页在弹窗、订阅、prepay 与微信支付前全部关闭，社区空态不再邀请必失败发布 |
| P1 | 任意 supply 可浏览陪伴者账号申诉附件并签读取 URL | 增加匿名 claimable 队列、CAS 认领/admin 分配、当前 assignee 专属附件和裁决权限、DB 在岗/独立性 guard 与离职交接 |
| P1 | 普通 180 天媒体到期可早于三年保留截止删除；due CTE 先全量物化；新 provider 删除失败未进入 readiness | claim 先在 LIMIT 内选候选，并锁定/重验精确 `retentionEndsAt`；day-180 阻断、day-1095 才可删；新错误与 outcome unknown 均阻断 readiness |
| P1 | 多个 PostgreSQL probe 只依赖父进程准入，文件内后续 test callback 可绕过 ownership | 每个数据库 test callback 在连接或建/删 schema 前现场 await sealed ownership；manifest 守卫逐 test body 验证而非只看文件首次调用 |
| P2 | 事件分配和员工停权存在反向 StaffCredential 锁序；暂停到期 worker 仅进程内互斥 | actor/target/replacement 统一排序去重锁定并用真实 PG 复现竞争；到期 worker 改成单事务 `FOR UPDATE SKIP LOCKED` 多副本 claim 与满批有界续跑 |
| P2 | 客户退款响应已收窄，但 Mini 类型仍错误承诺完整 `Order` | 新增与 OpenAPI 完全一致的 17 字段 `CustomerRefundOrder`，客户端 smoke 锁定字段集合 |

## 官方市场事实与仓库映射

| 参照 | 官方事实 | Talk&Talk 判断 |
|---|---|---|
| [松果用户端](https://apps.apple.com/cn/app/%E6%9D%BE%E6%9E%9C%E5%80%BE%E8%AF%89-%E5%BF%83%E7%90%86%E4%B8%8E%E6%83%85%E6%84%9F%E5%92%A8%E8%AF%A2/id1223389923)、[倾听者规范](https://www.51songguo.com/article/view%26topicId%3D448005) | 区分倾听、安慰、分析与建议；服务不匹配、骚扰和私联进入退款/举报 | 服务意图、订单规则快照、客服/争议/举报已覆盖；真实 KYC 为上线门禁 |
| [比心](https://apps.apple.com/cn/app/%E6%AF%94%E5%BF%83-%E6%89%BE%E6%B8%B8%E6%88%8F%E9%99%AA%E7%BB%83%E4%B8%8A%E6%AF%94%E5%BF%83app%E5%B0%B1%E5%A4%9F%E4%BA%86/id1286964732) | 实名、真人比对、考核和复考 | 仓库有外部证据引用、成年与复审到期门；真实核验不能由代码替代 |
| [Papa 资格](https://www.papa.com/resources/pal-basics/papa-pal-requirements)、[访问安全](https://www.papa.com/resources/member-safety/member-and-visit-safety) | 年龄/身份/持续检查、准时、爽约、安全事件和紧急升级 | 成年、履约争议、事件、受控证据与危机资源覆盖；线下车辆/保险不复制 |
| [Supportiv 安全定位](https://www.supportiv.com/updates/supportiv-a-safe-place-to-talk)、[对话流程](https://www.supportiv.com/conversational-arc) | 训练主持、实时安全主持与资源转介，同时明确非治疗/非危机咨询 | 培训、独立审核、危机资源和非医疗边界覆盖；24/7 人力为外部门禁 |
| [Preply 课程问题](https://help.preply.com/en/articles/4182862-how-to-report-an-issue-with-a-lesson)、[缺课处理](https://help.preply.com/en/articles/4934005-what-to-do-if-you-missed-your-lesson) | 技术问题、导师缺席、用户缺席、付款后果分域 | 履约争议、双方陈述、证据、申诉和退款状态分域覆盖 |
| [Upwork 身份](https://support.upwork.com/hc/en-us/articles/360001176427-How-to-verify-your-identity-as-a-freelancer)、[账号申诉](https://support.upwork.com/hc/en-us/articles/5313574196627-How-to-appeal-an-account-suspension) | 有限功能、重新核验、申诉进度；申诉获准后恢复访问 | 促成 reactivation 状态机与身份 authority 硬门；未接真实 authority 前不得收款 |
| [Rover 申诉](https://support.rover.com/hc/en-us/articles/19820331523092-Can-I-appeal-Rover-s-account-action-or-deactivation-decision) | 允许在期限内提交照片、视频、认证或整改材料 | 促成两类账号申诉受控附件，不再接受任意引用 |
| [Airbnb 申诉](https://www.airbnb.com/help/article/3835)、[移除申诉证据](https://www.airbnb.com/help/article/1303)、[Resolution Center](https://www.airbnb.com/help/article/1370) | 申诉期间限制、批准后恢复、订单关联证据与平台介入 | 恢复、证据、交易争议已分域；不会自动上架或泄露私密关系选择 |
| [Wyzant 核验](https://support.wyzant.com/tutors/tutor-account/background-check-policy/)、[扣费争议](https://support.wyzant.com/students-parents/student-billing/how-do-i-dispute-a-lesson-or-cancellation-fee-charge/) | 显示核验日期、错误结果可更正、站内沟通可核验 | 最近核验/下次复审、平台内记录和支付争议覆盖 |
| [Fiverr 取消](https://help.fiverr.com/hc/en-us/articles/12864193979793-How-cancellations-work-for-clients)、[服务者可用状态](https://help.fiverr.com/hc/en-us/articles/360015529197-Setting-Availability-for-freelancers) | 超时取消、替换推荐、休假停止新单但保留既有订单 | 安全重新匹配、排班/休假、未来新单私密边界覆盖 |

## 刻意不复制

- 不拆用户端与陪伴者端两个安装包。
- 不复制线下车辆、保险、MVR 或私人应急响应。
- 不默认录音，不为争议采集设备指纹、IP 或整段聊天导出。
- 不承诺 24/7 人工主持或紧急救援，除非真实排班与演练证据齐全。
- 不引入礼物币、财富榜、付费排名、付费认证或默认部分退款/平台余额。
- 不向客户披露陪伴者私密未来预约选择、事件附件或账号处罚内部原因。

## 外部门禁

仓库闭环不能替代以下事实：可撤销的真实身份 authority、微信主体/类目/AppID/商户/模板审批、真实支付退款与投诉、陪伴者 KYC/签约/税务、客服与安全值班、法务批准、真机无障碍/弱网、生产数据库/Redis/TLS、监控、备份恢复和容量演练。任一项缺少原始收据与独立复核，生产保持 **No-Go**。
