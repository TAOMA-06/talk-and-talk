# 生产环境检查清单

上线前在 **staging 验证通过** 后，对 production 逐项勾选。  
本清单只检查配置与运维门禁，**不扩展产品功能**。正式交易模型、停机红线和外部签字责任见 [COMMERCIAL_RELEASE.md](./COMMERCIAL_RELEASE.md)；市场对标、正式发行边界和仓库红线见 [商用界面市场交叉审查（2026-08-02 复审）](./commercial-market-cross-audit-2026-08-02.md)（[2026-08-01 历史快照](./commercial-market-cross-audit-2026-08-01.md)）；已知未完成能力见 [NEXT_PHASE.md](../NEXT_PHASE.md)。

## 商用界面与交叉审查门禁

- [ ] 普通用户与陪伴者只验收微信小程序正式路径，商业员工验收 `/admin/`，独立审核员验收 `/review/`；不得用 `frontend/ios`、消费者 Web、本地演示或静态截图替代
- [x] 仓库：被处置用户在刷新、重新登录或从通知进入后，仍可看到本人可申诉案件并提交一次内容申诉；已提交、计划处理时间、逾期和最终结果均可见，且申诉复核人不是原处置人
- [x] 仓库：普通用户 restriction/ban 生成不可变账号动作、理由、规则版本、申诉截止和站内通知；locked-account 最小壳可进入，申诉由非原处置人复核并回显结果，管理员不能只改 `User.accountStatus` 结束流程
- [x] 仓库：`banned` 账号即使无法读取普通 `/me` 资料，也能进入最小账号/隐私界面并提交/查看政策允许的访问、导出、更正、删除等数据权利请求；普通业务权限不会因此恢复
- [x] 仓库：用户可查询本人注销申请的状态、截止时间和结果；后台处理更新能回显，接口不暴露内部备注或其他用户数据
- [x] 仓库：用户可在小程序查看本人微信支付投诉的权威状态、SLA 和沟通摘要；接口失败显示未知/重试，不显示成“没有投诉”
- [x] 仓库：陪伴者账号动作申诉由非原处置人复核；服务端拒绝同一人员处置后自审并保留审计
- [x] 仓库：退款管理队列提供稳定分页与总量，运营能遍历全部待办，不再固定截断前 200 条
- [x] 仓库：注销管理队列显示总量和当前页，可遍历后续待办；筛选变化回到第 1 页，加载失败不会清空成“无待办”
- [x] 仓库：订单时间线、陪伴者服务单和客服案件加载失败分别显示失败与重试，不把失败后的空数组解释成没有记录
- [ ] 用微信真机屏幕朗读、字体/显示放大、焦点顺序、非颜色提示、触控目标、低端机与弱网走完支付、举报、争议和数据权利关键路径，并保存缺陷复测证据

## 商用模式总门禁

- [ ] `COMMERCIAL_RELEASE_MODE=commercial`；`REFUND_POLICY_VERSION`、`REFUND_REQUEST_WINDOW_HOURS` 与已批准规则一致，取得非秘密 `REFUND_POLICY_APPROVAL_REFERENCE` 后才设置 `REFUND_POLICY_APPROVED=true`；`COMPANION_SETTLEMENT_HOLD_HOURS` 至少晚于退款窗口 24 小时。生产示例默认未批准并保持 No-Go
- [ ] 账号注销后的分类保留期限已经外部法律/合规批准；仅在取得可追溯、非秘密的批准引用后，将 `ACCOUNT_DELETION_RETENTION_POLICY_APPROVED=true` 并填写 `ACCOUNT_DELETION_RETENTION_POLICY_APPROVAL_REFERENCE`，否则保持 No-Go
- [ ] `COMPANION_VOICE_EVIDENCE_VIEWER_URL` 指向无凭据、无 query/fragment 的外部 HTTPS 受控查看器；签名密钥为独立 32+ 位随机值，TTL 在 60–900 秒。管理员实测短期地址过期、换人或换版本后不可复用；查看器缺失时语音批准返回 503 且后台明确 No-Go
- [ ] 用正式小程序重放一次创建订单：缺少 `clientRequestId`、`serviceOfferingId` 或 `availabilityWindowId` 均返回 422；相同幂等键和相同业务输入只返回原订单及原退款规则版本/小时快照，即使当前配置已经换版也不产生第二笔订单或支付意图
- [ ] 默认发现、价格排序和推荐均只返回未来 7 天有当前 SKU 与结构化剩余容量的对象；卡片起价/时长/方式与详情 SKU、订单快照、支付金额一致。商品目录或时段接口故障时小程序失败关闭，不降级到资料价
- [ ] `ORDER_INTAKE_ENABLED`、总量/单用户/单陪伴者容量与 `ORDER_MAX_SCHEDULE_DAYS` 已按排班和值班能力设置；事故演练能暂停新单但仍允许同幂等键找回原订单
- [ ] `ORDER_RESCHEDULE_RESPONSE_WINDOW_MINUTES`、`ORDER_RESCHEDULE_EXPIRY_*`、`rescheduleRequested`、`rescheduleAccepted`、`rescheduleRejected`、`rescheduleExpired` 与 `rescheduleCancelled` 订阅消息模板已按值班能力配置；小程序真机已验证用户主动开启提醒时会按单次最多 3 项分批请求并记录授权；改期请求只在双方确认后、并通过第二次容量校验时才可替换原预约，拒绝、超时、订单取消、退款或履约开始/完成都不会改写原预约
- [ ] `ORDER_CHAT_PRE_SERVICE_WINDOW_MINUTES` 与 `ORDER_CHAT_POST_SERVICE_WINDOW_MINUTES` 已按服务与客服能力明确设置；两名真实测试用户验证服务窗口内可发消息，完成订单仅可查看历史而不能新建文字/媒体，举报、售后和客服仍可用
- [ ] `/admin/commercial/readiness` 返回 `clear`，并由值班人员核对退款政策已批准、`refundPolicySnapshotGaps=0`、最新可用微信账期四类账单全部完成且开放差异为 0、账号注销保留政策已批准、失败/超时退款、超时工单、超时账号注销、普通用户账号申诉复核超时、陪伴者账号申诉复核超时、支付投诉超时/同步失败、失败推送、过期推送租约、待复核商业档案、未结追偿、超时结算、严重/超时人工审核、媒体审核或删除失败、过期支付、预约响应/支付保留超时、已过履约窗口待退款、超时服务订单和语音关房积压均为 0；若启用语音，`voiceEmergencyStopActive=0` 且 `voice.roomControlEnabled=true`
- [ ] 单独核对 `notificationDelivery`：worker 关闭但存在 pending、到期/超过 SLA 的 pending、过期 processing 租约和未被站内已读兜底的失败投递均为 0；在多副本演练中每条 due delivery 只被一个 claimant 处理，provider 超时不会让数据库事务长期占锁
- [ ] 单独核对可约提醒 readiness：fanout、准备、授权预留、投递 claim 均无失败、过期租约、超过 5 分钟的到期积压或“runner 关闭但有到期任务”；`failedBeforeSend`、`rejected`、`uncertain` 只允许有权限人员记录受审计的人工核查，渠道事实不变、绝不自动补发，只有未核查终态阻断放行
- [ ] 单独核对账号注销执行与保留到期队列：双人批准后任务按持久 phase/cursor 有界推进，多副本只有一个有效租约；中断可恢复，达到自动重试上限后显示失败并支持带理由的受审计重试。最终后置条件、保留台账和评分重算任务未完成前，不得把请求标为完成或把账号写成已彻底删除
- [ ] `/admin/commercial/funnel` 的请求、接单（含已释放支付保留的不可变审计事实）、支付、应开始、准时开始、应完成、完成、评价、退款、复购和净实收已与抽样订单逐笔核对；经营评审采用 [核心宽容度与拓展度决策](./core-tolerance-and-expansion-matrix.md) 的分母和停止规则
- [ ] `SUPPORT_MAX_OPEN_PER_USER` 与实际客服容量一致；普通工单达到上限会被拒绝，但紧急安全工单仍可进入队列
- [ ] 每位上架陪伴者均具备已复核的实名状态与商业档案；收款对象、税务档案、身份和协议只保存受控外部证据引用
- [ ] 已核对迁移生成的 `legacy-inferred-v1` 与 `legacy-72h-v1` 退款快照；兼容标记不视为政策批准。逐笔处置历史已支付/服务中/已完成订单、失败退款、未结工单、退款快照缺口及缺少结算快照的应结款；禁止伪造历史核验结果
- [ ] 产品、工程、运营/客服、财务和法律/合规完成 Go 签字；任一外部 P0 未签字均不得开放真实付费流量

## 网络与 TLS

- [ ] HTTPS 已启用（`infra/nginx/talk-and-talk.conf.example` 或等价反向代理）
- [ ] HTTP → HTTPS 301 跳转正常
- [ ] 证书未过期；续期流程已知（ACME 或手动）
- [ ] `curl -fsS https://api.talkandtalk.app/api/v1/health` 返回精简 liveness（`status`/`service`/`version`）；依赖细节走 `GET /api/v1/health/ready` + `Authorization: Bearer $METRICS_TOKEN`
- [ ] staging/production 未配齐微信凭证时选择 Disabled（**禁止**静默 Mock）；仅 development/test 可启用 Mock，且需 `MOCK_WECHAT_NOTIFY_SECRET`（≥32）
- [ ] Real 微信回调在 staging/production 强制 `resource.ciphertext`；明文 resource 仅限 development/test

## CORS / JWT / 密钥

- [ ] `cd backend/api && npm run preflight:deployment -- .env.production` 通过
- [ ] `cd backend/api && npm run verify:cloudbase-template` 通过；实际 CloudBase 清单从受控环境生成、最小实例不少于 1，且不含任何运行时变量或密钥
- [ ] `CORS_ORIGINS` 为显式 allowlist（生产禁止依赖开发默认列表）
- [ ] `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` 为高强度随机值，非 `CHANGE_ME` / 开发默认
- [ ] access / refresh 密钥互不相同
- [ ] `AUTH_IDENTITY_TOMBSTONE_HMAC_KEYS` 中每把密钥均为密钥管理生成的独立 32+ 字节随机值，`AUTH_IDENTITY_TOMBSTONE_ACTIVE_KEY_ID` 存在于密钥环，`AUTH_IDENTITY_REREGISTRATION_POLICY=after_tombstone_expiry`
- [ ] 身份墓碑换钥遵循“先加入新密钥、再切 active、等旧墓碑到期清理后才移除旧密钥”；发布前商用就绪度中的覆盖缺口和未知密钥积压均为 0
- [ ] `METRICS_TOKEN` 为 32+ 位随机值；metrics 与 `/health/ready` 采集端发送 Bearer token（staging/production 均强制）
- [ ] `COMPANION_VOICE_EVIDENCE_SIGNING_SECRET` 仅存在密钥管理/加密环境变量中，不进入 URL、日志、审计元数据或仓库
- [ ] `.env.production` 未提交到 git（见根 `.gitignore`）

## 数据库与 Redis

- [ ] `DATABASE_URL` 使用强密码；与 compose `POSTGRES_PASSWORD` 一致
- [ ] Postgres 不直接对公网暴露
- [ ] `REDIS_URL` 生产建议 `redis://:PASSWORD@host:6379`（requirepass）；至少不公网裸奔
- [ ] `/health/ready`（Bearer `METRICS_TOKEN`）中 `dependencies.database` / `dependencies.redis` 为 `ok`
- [ ] 发布前已备份数据库；在 staging 执行 `20260725100000_derive_companion_trust_metrics` 后，逐位核对评分/评价数、完单数与平均响应文案均来自真实评价和订单。生产迁移后再次抽样，禁止手工“恢复”旧宣传数字
- [ ] 迁移前确认 `RefundTransaction.providerRefundId` 的非空值无重复；若有差异先逐笔对账，不得删除或随意改写财务记录来强行通过唯一索引
- [ ] `20260720163000_refund_reconciliation_schedule` 已部署；现存 `processing` 退款已获得 `nextReconcileAt`，worker 扫描后不存在长期逾期租约

## 微信支付

- [ ] `GET /api/v1/payments/status` 返回 `provider=real`、`productionReady=true`
- [ ] `WECHAT_PAY_APP_ID` / `MCH_ID` / `API_V3_KEY` / `CERT_SERIAL_NO` / `NOTIFY_BASE_URL` 已填
- [ ] 私钥二选一：CloudBase 使用加密环境变量 `WECHAT_PAY_PRIVATE_KEY`；Compose 使用 `WECHAT_PAY_PRIVATE_KEY_HOST_PATH` 指向 host PEM，并只读挂载为容器内 `WECHAT_PAY_PRIVATE_KEY_PATH`（见 [`infra/secrets/README.md`](../infra/secrets/README.md)）
- [ ] 商户私钥未提交到仓库、未进入小程序包、未出现在日志中
- [ ] 通知 URL 可达：`https://api.talkandtalk.app/api/v1/payments/wechat/notify`
- [ ] 生产未配齐微信时 prepay 返回 `WECHAT_PAY_NOT_CONFIGURED`（**禁止** Mock 提供商）；staging 同样禁止静默 Mock
- [ ] `WECHAT_PAY_COMPLAINTS_ENABLED=true`，轮询间隔和批量大小与当班承载能力一致；微信商户平台已把消费者投诉 2.0 通知地址真实登记为 `https://<API 域名>/api/v1/payments/wechat/complaint-notify`。登记截图/工单号已归档；仅配置代码或域名不算完成
- [ ] 用隔离商户投诉通知验签、AES-256-GCM 解密、重复通知幂等与 5 秒内空 204 回执；数据库和日志都不含回调原文、手机号、openid 或远程证据 URL
- [ ] 演练通知丢失：worker 能从近三日投诉列表发现记录、按投诉号回补权威详情；查询失败进入 `syncFailed` 和运行门禁，人工“同步微信状态”不会直接改写渠道结果
- [ ] 演练投诉 PENDING → 商户回复 → PROCESSING → 完结 → PROCESSED：次日结束前首次回复、第三日结束前完结的 SLA 正确；用户新消息或微信平台服务介入会阻止提前完结；回复/完结超时保留 `outcomeUnknown` 并阻止重复提交
- [ ] 未结投诉冻结未付款收益；已付款收益生成 `paymentDisputeAfterPayout` 追偿；只有同订单无其他活动投诉且无未结退款时才释放冻结。support 只能认领后读取/回复本人投诉，finance 只见资金事实，admin 才能分配，所有动作均有审计
- [ ] 真实 prepay / 平台证书验签 / resource 解密已联调通过（沙箱或生产小额）
- [ ] 生产启动时能主动拉取并解密当前微信平台证书；证书或商户签名异常会阻止实例接流量，而不是等首个支付回调才暴露
- [ ] staging 演示仍可用 mock-notify；production mock-notify → 403

## 微信小程序

- [ ] `GET /api/v1/auth/wechat/mini-program/status` 返回 `configured=true`
- [ ] 使用 `wx.request` 时，小程序主体与 `api.talkandtalk.app` 已完成所需备案并配置 request 合法域名；使用云托管 `callContainer` 时已关联对应 CloudBase 环境
- [ ] `WECHAT_MINIPROGRAM_APP_ID` / `WECHAT_MINIPROGRAM_APP_SECRET` 已填；AppSecret 仅存在于部署机密中
- [ ] 微信支付商户号已绑定小程序 AppID，并开通 JSAPI 支付；真机已完成一笔小额支付与退款
- [ ] 小程序后台已配置隐私保护指引；`/legal/privacy.html` 与 `/legal/terms.html` 均能在微信内打开
- [ ] 小程序支付成功后以服务端回调订单状态为准；取消支付不将订单标记 paid
- [ ] 演练“微信预下单已受理但 API 超时/进程退出”：本地 `outTradeNo` 不丢失、不生成第二笔可支付单，后台对账能回补成功或确认关单，`stalePrepays` 最终归零

## TRTC 出席事实与履约争议

- [ ] `TRTC_CALLBACK_SIGNING_KEY` 使用 16–32 位独立随机字母数字密钥，只存在于部署机密；不得与 SDK SecretKey、JWT、支付或审核密钥复用
- [ ] 腾讯云 TRTC 控制台已把房间与媒体事件回调登记为 `https://<API 域名>/api/v1/callbacks/trtc/room-events`，登记截图、变更人和回滚步骤已归档；仅填写环境变量不算完成
- [ ] 在隔离 staging 用真实签名事件验证创建房间、进房、切网重连、退房、音频起止、重复回调与未知字段；伪造签名、错误 SdkAppId、过期时间、未知房间或非订单参与者均不能生成可信出席事实
- [ ] 用两台真机验证公开 10 分钟等待期、24 小时事实补充、48 小时双方答辩、72 小时申诉和申诉答辩；客户端心跳单独存在时不能自动判定任何一方爽约
- [ ] 数据库、日志、后台和导出中均无语音录音、回调原文、IP、终端类型或设备指纹；匿名待认领队列在认领前不返回当事人、订单编号或陈述
- [ ] 演练“首审全额退款 → 不同人员申诉复核 → 终局全额退款 → 不同财务核验提交 → 微信 pending/processing/success/failed”：财务不可拒绝并推翻终局结论，只有渠道 `success` 才显示退款成功，未终结案件和退款始终冻结结算

## 微信订阅通知

- [ ] 生产配置的全部必需逻辑模板键（含 `messageReceived`）均映射到实际审批通过的模板 ID，字段与小程序授权场景一致；真机验证会话静音后不会消耗授权或投递新消息提醒
- [ ] 真机逐个验证授权、发送、拒绝授权、模板更换和授权耗尽；旧模板授权不得用于新模板
- [ ] 失败投递进入后台商用门禁并配置跨副本告警；不得对结果未知的一次性消息自动重发
- [ ] 收藏对象可约提醒保持 `AVAILABILITY_REMINDER_DELIVERY_ENABLED=false`，除非 staging 已完成一次明确授权、私人书签、真实可约与 provider 接受的受控演练；若开启，预检必须识别已审批的 `availabilityReminder` 模板
- [ ] 内网 metrics 已采集 `talk_availability_reminder_delivery_success_total`、`talk_availability_reminder_delivery_failures_total`、`talk_availability_reminder_delivery_skipped_total`；初期任何 failure 或私有 `uncertain` 增量均由工程值班人工核查，绝不通过改状态、释放授权或重启 runner 补发
- [ ] 管理后台对 `failedBeforeSend`、`rejected`、`uncertain` 的“已核查”操作只追加操作人、时间、原因与审计，不更改 provider 终态、不释放已消费授权；重复核查幂等，越权人员被拒绝，核查后 readiness 只关闭运营未处理项而不把原投递改写为成功

## 退款、结算与财务对账

- [x] 仓库：微信 T+1 `tradeAll`、`fundBasic`、`fundOperation`、`fundFees` 四类下载、官方 URL 限制、SHA-1 校验、隐私最小化解析、不可变导入、租约/退避、配置起始日全覆盖、交易与 BASIC 资金账单双向差异、资金业务类型/账户/方向/金额/状态严格核验、手续费与未知类型失败关闭、渠道原始成功时间、双人证据提案复核、人工重拉与全历史商用门禁已实现；四类 `noStatement` 遇到本地渠道时间活动均不会冒充已核对
- [x] 仓库：超过 API 90 日且不超过商户平台五年历史的官方账单可进入独立补证队列；仅接受一个上海自然日、最大 20 MiB，拒绝最多 31 日的合并导出。服务端重算文件与归一化 SHA-256，原文不落库、不回显、不进审计；提交与批准必须由不同人员完成，批准后数据库禁止并发追加
- [x] 仓库：支付和退款先追加 `UNCLASSIFIED` 现金台账，渠道、来源、方向与金额不可改写；账户及预计单日资金账单由一人提案、另一人批准。退款申请时间与成功时间分别持久化，成功时间早于申请时间或缺少任一权威事实均拒绝落账
- [ ] 财务批准每日拉账和差异处置 SOP，设置 `WECHAT_DAILY_BILL_RECONCILIATION_ENABLED=true`、`WECHAT_DAILY_BILL_RECONCILIATION_APPROVED=true`、非秘密批准引用、明确 `WECHAT_DAILY_BILL_RECONCILIATION_START_DATE=YYYY-MM-DD`、上海时间 10–23 点执行小时和 1–16 批量；起始日起所有日期 × 四类均须完整，最近 90 日以外无法自动回拉的历史缺口必须取得受控证据并独立复核，不能缩短起始日期来清门禁；生产示例默认未批准且起始日为空，必须保持 No-Go
- [ ] 用真实商户连续核对交易账单、三类资金账单与系统订单/支付/退款台账；演练无账单后重新拉取、账单 hash/官方汇总不匹配、孤儿交易、反向漏单、金额/账户/方向/状态差异、手续费/未知资金业务、支付或退款成功但微信时间缺失、负责人提交证据和另一人批准/拒绝（接受例外仅不同 admin 批准），确认历史开放差异、待复核提案、缺失渠道时间与任一覆盖缺口始终阻止放行
- [ ] 用真实商户导出一份 90 日外的官方单日账单，验证客户端与服务端 SHA 一致、第二人复核后才入账；再分别用 90 日内、五年外、跨日/31 日合并、超过 20 MiB、摘要不符和审批并发样本确认失败关闭，且数据库/审计/APM 中不存在账单原文
- [ ] 对一笔真实支付与退款核对 `providerRefundAcceptedAt`（申请/受理）和 `providerRefundSucceededAt`（成功）原始时间，再完成一次现金账户/预计账单日双人分类；`pendingBillImportApprovals` 或 `unclassifiedCashLedgerEntries` 任一非零时门禁必须保持 No-Go
- [ ] `PAYMENT_RECONCILIATION_ENABLED=true`；演练退款提交时 API 超时/进程退出和退款回调丢失：本地唯一 `outRefundNo` 不丢失，worker 查询微信后恢复状态；仅 `RESOURCE_NOT_EXISTS` 以原退款号、原交易和原金额幂等重提，查询按数据库时间递增退避，多副本只允许一个租约获胜
- [ ] 超时退款会出现在后台队列；管理员“查询微信退款状态”可恢复，查询返回的 `outRefundNo` 不匹配时拒绝落账；显式 `failed` 状态仍必须走独立审计的管理员重试，状态同步不得绕过审批
- [ ] 退款失败会持续冻结应结款；退款成功后若原应结款已付款，会生成追偿记录并冻结该陪伴者后续结算
- [ ] 演练一次超出自助窗口的订单工单：仅当前负责人可发起例外退款，且发起人与退款审核人不同
- [ ] 用 `moderator` 账号确认退款队列与批准/拒绝/重试均为 403；仅 `admin` 可执行资金处置
- [ ] 以相同 `clientRequestId` 重放创建订单并确认只生成一笔；验证单用户、单陪伴者与全局未结订单上限，以及 `ORDER_INTAKE_ENABLED=false` 的停单流程
- [ ] 验证 `PAYOUT_CLAIMS_ENABLED=false` 只阻止领取新付款任务，不阻断已经发生的转账凭证补录、复核和追偿
- [ ] 人工结算仅在已批准的低容量上限内使用；领取、带外转账、唯一流水/金额/收款对象/凭证摘要和第二人复核均完成
- [ ] 构造一个含多笔渠道投诉订单的真实或隔离商户投诉：每笔均以商户单号、微信交易号、金额三者匹配；未匹配任一笔时禁止完结，所有匹配订单均冻结或生成追偿，当事用户只看见自己关联的全部订单，不能看见其他用户订单
- [ ] 演练一次“领取后未转账”：原领取人不能自撤，另一名管理员凭受控引用和 SHA-256 复核释放，审计日志可追溯
- [ ] 规模化前已接入受监管的付款提供方，或由财务与合规书面批准继续使用人工模式的容量与值班上限

## 用户内容与外部生成式 AI

- [ ] `EXTERNAL_AI_USER_CONTENT_ENABLED=false` 已显式配置，生产和 staging 均无 `DEEPSEEK_API_KEY`；`/api/v1/moderation/status` 显示 `externalUserContentTransmission=false`，不得通过旧密钥或环境变量绕过
- [ ] 用情绪、健康、自伤、性、姓名、手机号和普通文本样本验证 DeepSeek provider 边界均不调用网络；本地规则仍将明确自伤/人身危险标记为 `critical` 并进入危机资源路径
- [ ] 当前隐私政策版本明确用户原文仅进入本地规则及授权人工复核，不会发送给 DeepSeek 或其他外部生成式 AI；新版本首次进入需重新同意，历史快照可访问
- [ ] 未来如启用任何外部内容处理方，先由合资格顾问判断法律基础和同意方式，并完成版本化 PIA/DPA、接收方与字段清单、处理地域、留存期限和禁止训练证明；这些证据未齐全前不得增加可开启的生产代码路径

## 短信 / 登录策略

- [ ] `APP_ENV=production` 时 **禁止** `SMS_PROVIDER=mock`（启动校验会拒绝）
- [ ] **产品策略：production 使用微信小程序登录**（`SMS_PROVIDER=none` → `SMS_UNAVAILABLE`）
- [ ] 真实 SMS（Aliyun/Tencent）为后续增强，不阻塞小程序首发

## 日志脱敏

- [ ] 确认生产日志无完整手机号、验证码、JWT、微信支付签名原文
- [ ] 实现：`backend/api/src/common/logging/redact.ts`（单元测试覆盖）

## 备份与回滚

- [ ] 定时任务调用 `backend/api/scripts/db-backup.sh`（建议每日 + 发布前）
- [ ] 备份落盘路径与保留天数已知
- [ ] 已演练一次 restore（见 [deploy-rollback.md](./deploy-rollback.md)）
- [ ] 恢复演练覆盖新增商业档案、订单快照、应结款、退款追偿、客服结论、通知 outbox 与法律同意证据
- [ ] 发布前记录 git tag / 镜像 digest

## 管理员与 Seed

- [ ] 生产 `SEED_ON_STARTUP=false`
- [ ] 按 [review-department.md](./review-department.md) 创建独立 reviewer 与 lead，并完成密码 + TOTP 真实登录
- [ ] 确认生产不存在 seed 手机账号、共享员工账号或默认密码
- [ ] Web `/review/` 仅内网或 VPN 可达（推荐；至少不公开宣传）

## 监控与告警

- [ ] `GET /api/v1/health` 纳入探活
- [ ] `GET /api/v1/metrics` 仅内网抓取（勿对公网裸奔）
- [ ] 告警：5xx 率、依赖 down、磁盘、证书到期（工具自选）
- [ ] 商用业务告警：失败退款、超时工单、失败通知、追偿逾期、结算任务超时、服务订单超时；告警在多副本环境可聚合并实际触达值班人员

## 微信开发者工具 / 发行

- [ ] 在官方微信开发者工具导入 `frontend/miniprogram`，选择与后端一致的 AppID
- [ ] 关闭“不校验合法域名”调试开关后完成编译、预览、体验版真机回归
- [ ] 上传体验版并完成微信审核；仓库 CI 只做结构/契约验证，不代替签名上传
- [ ] 隐私政策 / 用户协议 HTTPS 可打开（`/legal/privacy.html`、`/legal/terms.html`）

## 发布后冒烟

```bash
METRICS_TOKEN='<production token>' \
  ./backend/api/scripts/production-smoke.sh https://api.talkandtalk.app
```

`acceptance-smoke.sh` 依赖 mock SMS / mock 支付，仅允许在 development 或 staging 使用，禁止用于 production 放行。

生产烟测严格要求 health/database/redis 全部为 `ok`、小程序凭证已配置、支付 provider 为 `real`、短信 Mock 关闭、法律页可访问且公网 metrics 被阻断。可提供短期 `PRODUCTION_ACCESS_TOKEN` 额外验证 authenticated mock-notify 返回 403。
