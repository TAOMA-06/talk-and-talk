# Staging 联调验收（受控参考，当前不可执行）

> 当前状态：`G1 NO-GO`、`G2-ready NO-GO`、`G2 BLOCKED`。本文件是未来
> staging 验收的场景目录，不授权复制配置、创建数据、启动容器、迁移、seed、调用
> 微信、支付或上传小程序。不得从旧版本复用 `docker compose up --build`、
> `prisma` 写操作、`acceptance-smoke.sh` 或本地 source 启动作为 staging 配方。

## 每项外部动作的必填记录

每一项 staging 配置、部署、迁移、fixture/seed、支付/退款、微信回调、真机预览、
数据清理或烟测都需要独立的非秘密授权记录。一个 G1、E2E、SBOM 或迁移批准不会
自动覆盖任何其他动作。

| 字段 | 必填内容 |
|---|---|
| Evidence ID | 仅用于当前动作、可在审批系统核验的非秘密授权 ID。 |
| 目标与范围 | staging 环境/资源 ID、数据边界、账号/设备别名、是否会调用微信/支付/消息 provider。 |
| 冻结输入 | 候选 SHA/source-tree、不可变 API/Web/OCI digest、制品保管证明；禁止分支、浮动 tag、`--build` 或当前工作树。 |
| 有效期与人员 | 签发/到期时间、执行人、独立复核人，以及禁止自审/绕过的控制。 |
| 预期结果与停止条件 | 所需场景、数据清理/保留策略、text-only 与路由断言、失败时停止条件。 |
| 结果与复核 | 脱敏收据/校验和、清理结果、独立复核结论；不得归档凭据、连接串、OpenID、支付签名或聊天内容。 |

缺失、过期、目标不匹配、没有不可变制品保管或未填结果/复核，均为 `BLOCKED`。
未来具体执行机制只能写入这份已批准记录和
[G2 执行包](./cto-self-audit/runs/2026-08-08-g1-remediation/g2-execution-package.md)，不能由本仓库文档代替。

## 场景目录（未来获授权后）

下表描述空的、一次性 disposable staging 数据边界中需要验证的结果；它不提供命令、
测试账号、seed 口令、环境变量或部署配方。任何需要 fixture 的场景都必须由对应授权
记录指定来源、保留期和清理证据。独立审核部门凭据按
[review-department.md](./review-department.md) 的受控流程创建，不写入仓库。

| # | 未来获授权场景 | 期望 |
|---|------|------|
| 1 | 不可变候选的迁移与受控 fixture 建立 | 仅产生授权记录中定义的陪伴者/员工/客户别名；migration/fixture receipt 和清理证据可复核 |
| 2 | `POST /api/v1/auth/sms/send-code` + `phone/login` | 返回 access/refresh token |
| 3 | `GET /api/v1/companions` | 返回 seed 陪伴者列表 |
| 4 | 创建订单 → 陪伴者确认 → 预下单 | 确认前禁止支付；只使用授权记录明确的 mock/sandbox/真实 provider 边界 |
| 5 | 授权的支付结果回执演练 | 订单状态仅由权威/明确允许的回执改变，会话按预期激活 |
| 6 | `POST /conversations/c1/messages` 正常文案 | `decision=allow`，有 `companionReply` |
| 7 | 发送「加微信私下聊」等违规文案 | `decision=block`，`safetyMessage`，创建 ModerationCase |
| 8 | Web `http://<host>/review/` 使用独立 reviewer 密码 + TOTP 登录处置 | `confirmViolation` / `dismiss` 写入 ReviewActionLog、AuditLog 与 ReviewAuditLog |
| 9 | `GET /api/v1/health`；带 Bearer token 请求 `/api/v1/metrics` | health 仅含依赖状态；受保护 metrics 含请求/AI/微信计数 |

## 自动化冒烟边界

`backend/api/scripts/acceptance-smoke.sh` 仅用于 development/mock SMS/mock
payment/local seed 的工程检查；它不是 staging、真实微信、真实支付或 provider
证据，也不得作为 staging/production 放行命令。未来 staging 验收使用已批准记录
中绑定的不可变候选、受控运行方法和脱敏结果，而不是本节的脚本。

## 商用闭环验收（必须留证）

以下场景不能只看接口返回；只有相应独立授权记录已获批准时才可执行。每项保存
Evidence ID、请求 ID、后台截图、数据库/微信商户侧引用、清理结果和两名执行人；
涉及真实支付时还必须明确金额上限、商户范围和停止条件。

| # | 场景 | 必须证明的结果 |
| --- | --- | --- |
| 1 | 管理员 A 提交陪伴者商业档案，A 尝试自审，再由管理员 B 复核并单独上架 | A 自审为 403；身份/协议/税务/收款只存外部引用；复核前公共列表不可见；重提或暂停立即下架。 |
| 2 | 同一 `clientRequestId` 并发/超时重放，随后触发单用户、单陪伴者和总量上限 | 同键只产生一单；不同业务参数复用同键被拒绝；容量错误可运营识别；停单后旧键仍可找回原单。 |
| 3 | 陪伴者确认后，在微信预下单响应前终止 API；另测回调丢失和乱序回调 | 唯一 `outTradeNo` 已落库，不出现第二笔可支付单；worker 回补成功或权威关单；金额/商户/AppID/币种/交易不符均拒绝。 |
| 4 | 退款提交时断网/退出、退款回调丢失、查询返回不存在、显式失败后重试 | 始终复用唯一 `outRefundNo`；先查询，仅权威不存在才原参数重提；失败继续冻结结算；用户不能重提失败退款，只有 admin 审计重试。 |
| 5 | 履约完成、自助退款窗口、超窗工单例外退款 | 用户确认不缩短退款期；超窗普通请求被拒绝；工单当前负责人发起且第二名 admin 审核；工单期间结算冻结。 |
| 6 | 应结款领取、带外付款凭证、第二人复核；分别在领取后与确认付款后发生退款 | 原领取人不能自撤；金额/收款快照/唯一流水/凭证摘要一致；分别生成付款状态不确定或付款后追偿，未结前冻结后续结算。 |
| 7 | 权威 manifest 中的 16 个必需微信模板分别授权、发送、拒绝、耗尽和换模板 | 授权绑定当时实际模板 ID；旧授权不能挪给新模板；结果未知不自动重发；失败进入站内通知和 readiness。`availabilityReminder` 为另行审批、默认关闭的第 17 个可选模板。 |
| 8 | 用安全、边界、高风险文本验证本地规则，并确认 DeepSeek provider 对任何用户原文都不发起网络调用；另制造媒体存储/分析或删除适配器失败 | 边界内容进入受控人工复核，高风险内容不会自动公开；生产与 staging 均保持 `EXTERNAL_AI_USER_CONTENT_ENABLED=false` 且无 `DEEPSEEK_API_KEY`。媒体失败不伪装成功并按租约/退避恢复。 |
| 9 | 员工 token 签发后降权/限制，普通用户 restricted/banned；对一个已通过双人批准的账户注销任务在不同擦除阶段中断、重启和并发领取 | 员工立即失去后台读写；普通 restricted/banned 只保留政策允许的最小法定自助入口。注销不绕过退款、支付和留存义务；多副本只允许一个有效租约推进，有界批次可从持久 phase/cursor 恢复，失败进入可审计重试，最终后置条件未通过时不得标记完成或伪装已删除。 |
| 10 | 清空所有演练积压后访问 `/api/v1/admin/commercial/readiness` | 所有 blocker 为 0、状态为 `clear`；随后分别制造失败退款、通用通知关闭但有 due backlog、投递 SLA 超时/过期租约、可约提醒各阶段失败/过期 claim/超过 SLA 积压/未核查终态、注销执行失败或保留到期失败、普通用户账号申诉复核超时、陪伴者账号申诉复核超时、人工审核积压和已到期的语音关房任务，确认对应计数准确且门禁转为 `attentionRequired` 并真实告警。启用紧急语音清场后，即使尚未发现积压，`voiceEmergencyStopActive` 也必须让门禁保持 `attentionRequired`。 |

## 微信小程序验收

前置仅能由获授权的环境记录完成：小程序 request 合法域名、HTTPS/备案、测试
AppID、微信凭据引用及真实支付商户绑定均不得写入 Git 或由本文件直接配置。若验证
真实支付，授权记录还必须限定商户/AppID、金额、账户别名、回滚/清理与结果复核。

| # | 场景 | 期望 |
|---|------|------|
| 1 | 真机首次打开小程序 | `wx.login` → `/auth/wechat/mini-program`；得到独立 JWT 会话，不保存 AppSecret 或 session_key |
| 2 | 发现、详情、广场、评价 | 读取 NestJS 正式 API 数据；只展示实名、商业档案已复核且已上架的陪伴者 |
| 3 | 创建订单 → 陪伴者确认 → `channel=miniProgram` prepay | 未确认时禁止支付；staging mock 返回 `wechatMiniProgramParams`；真实环境能调起 `wx.requestPayment` |
| 4 | 取消 / 成功支付 | 取消不标记 paid；成功后以微信回调刷新订单和会话 |
| 5 | 聊天和举报 | 正常、warn、review、block 提示可见；举报只提交服务端回执 |
| 6 | 陪伴者订单 | paid → inService → completed 状态流转正确；完成订单可评价 |
| 7 | 隐私保护指引 | 首次涉及聊天、支付或发帖时，平台要求时可正常授权；隐私链接可打开 |
| 8 | 订单聊天权益 | `paid` / `inService` 的服务前、服务中和收尾窗口可发普通消息；完成订单历史仍可查看但不能新发文字/媒体；举报、售后和客服不受影响 |

## 历史 iOS 回归（不属于当前商用放行范围）

以下内容仅保留作历史工程参考；当前发布结论不得引用本节结果。

前置：API 已 seed；**TestFlight 使用 scheme `TalkAndTalk-Staging`**（`BACKEND_BASE_URL=https://api-staging.talkandtalk.app`，`ENABLE_PHONE_LOGIN=YES`）。  
生产 Archive 使用 scheme `TalkAndTalk`（Release，仅 Apple 登录）。  
仅使用 `frontend/ios/TalkAndTalk.xcodeproj`。

| # | 场景 | 期望 |
|---|------|------|
| 1 | 登录（SMS mock 或 Apple） | 进入主 Tab；token 进 Keychain |
| 2 | 发现列表 | 出现 seed 陪伴者；空/错态可重试 |
| 3 | 详情 | 主题、价格、可下单入口正常 |
| 4 | 下单 → prepay | 订单进入 paying/paid 路径 |
| 5 | 支付状态 | mock/沙箱成功后 paid；失败/取消有文案；未确认时引导订单页 |
| 6 | 聊天（c1–c3） | 正常文案 allow；违规 block/review 有反馈 |
| 7 | 审核反馈 | 用户可见提示与安全分逻辑不崩溃 |
| 8 | 订单列表 | 状态文案正确；空态友好 |
| 9 | 通知 | 列表/未读/标已读 |
| 10 | 设置 | 协议/隐私可打开；含外链 URL |
| 11 | 退出登录 | 回登录页；需重新验证 |

额外检查：

1. 在 `frontend/ios` 执行 `xcodegen generate` 后，Archive **TalkAndTalk-Staging** 成功（Team + 版本号已配置）。
2. Debug/Staging/Release 均无「安全工作台 / Admin」入口；管理员能力只存在于独立 Web 后台。
3. 隐私政策 / 用户协议 HTTPS 可打开。
4. `WECHAT_APP_ID` 未配置时支付错误文案清晰（非崩溃）。
5. Staging 显示手机号登录；生产 Release 仅显示 Apple 登录。

单元测试：

```bash
# 生成工程（修改 project.yml 后）
cd frontend/ios && xcodegen generate

xcodebuild test \
  -project frontend/ios/TalkAndTalk.xcodeproj \
  -scheme TalkAndTalk \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5' \
  -only-testing:TalkAndTalkTests
```

UITests 未纳入 v0.1 门禁（与登录门控有漂移）；见 NEXT_PHASE。
