# Staging 联调验收

从**空数据库**开始，验证 TestFlight 前关键路径。

## 准备

从仓库根目录：

```bash
cp backend/api/.env.staging.example backend/api/.env.staging
# 配置 DATABASE_URL / JWT / WECHAT_PAY_*（沙箱）

# DEPLOY_ENV_FILE 路径相对 infra/（compose 文件所在目录）
DEPLOY_ENV_FILE=../backend/api/.env.staging \
  docker compose -f infra/docker-compose.prod.yml --env-file backend/api/.env.staging up -d --build
```

`DEPLOY_ENV_FILE` 控制 API 容器加载的配置文件（默认 production 使用 `../backend/api/.env.production`，路径相对 `infra/`）。

Seed 陪伴者 owner 登录手机号依次为 `13800000101`–`13800000105`。Web 审核后台需另按 [`staff-operations.md`](./staff-operations.md) 初始化密码和 TOTP 凭据。

或本地（需 Postgres + Redis）：

```bash
cd backend/api
npm run prisma:migrate
npm run db:seed
npm run start:dev
```

## 验收清单

| # | 步骤 | 期望 |
|---|------|------|
| 1 | `prisma:migrate` + `seed` | 5 个有可登录 owner 的陪伴者；admin `13800000001`、moderator `13800000002` |
| 2 | `POST /api/v1/auth/sms/send-code` + `phone/login` | 返回 access/refresh token |
| 3 | `GET /api/v1/companions` | 返回 seed 陪伴者列表 |
| 4 | `POST /api/v1/orders` → 陪伴者 `POST /orders/service/:id/confirm` → `prepay` | 确认前禁止支付；staging 返回 `payment.mock=true` |
| 5 | 小程序支付模拟 **或** `POST /payments/wechat/mock-notify` | 订单 `paid`，会话激活 |
| 6 | `POST /conversations/c1/messages` 正常文案 | `decision=allow`，有 `companionReply` |
| 7 | 发送「加微信私下聊」等违规文案 | `decision=block`，`safetyMessage`，创建 ModerationCase |
| 8 | Web `http://<host>/admin/` 使用 moderator 密码 + TOTP 登录处置 | `confirmViolation` / `dismiss` 写入 ActionLog |
| 9 | `GET /api/v1/health`；带 Bearer token 请求 `/api/v1/metrics` | health 仅含依赖状态；受保护 metrics 含请求/AI/微信计数 |

## 自动化冒烟

```bash
./backend/api/scripts/acceptance-smoke.sh http://127.0.0.1:3000
```

## 商用闭环验收（必须留证）

以下场景不能只看接口返回；每项保存请求 ID、后台截图、数据库/微信商户侧引用和两名执行人。涉及真实支付时只在隔离 staging 或批准的小额生产验收中执行。

| # | 场景 | 必须证明的结果 |
| --- | --- | --- |
| 1 | 管理员 A 提交陪伴者商业档案，A 尝试自审，再由管理员 B 复核并单独上架 | A 自审为 403；身份/协议/税务/收款只存外部引用；复核前公共列表不可见；重提或暂停立即下架。 |
| 2 | 同一 `clientRequestId` 并发/超时重放，随后触发单用户、单陪伴者和总量上限 | 同键只产生一单；不同业务参数复用同键被拒绝；容量错误可运营识别；停单后旧键仍可找回原单。 |
| 3 | 陪伴者确认后，在微信预下单响应前终止 API；另测回调丢失和乱序回调 | 唯一 `outTradeNo` 已落库，不出现第二笔可支付单；worker 回补成功或权威关单；金额/商户/AppID/币种/交易不符均拒绝。 |
| 4 | 退款提交时断网/退出、退款回调丢失、查询返回不存在、显式失败后重试 | 始终复用唯一 `outRefundNo`；先查询，仅权威不存在才原参数重提；失败继续冻结结算；用户不能重提失败退款，只有 admin 审计重试。 |
| 5 | 履约完成、自助退款窗口、超窗工单例外退款 | 用户确认不缩短退款期；超窗普通请求被拒绝；工单当前负责人发起且第二名 admin 审核；工单期间结算冻结。 |
| 6 | 应结款领取、带外付款凭证、第二人复核；分别在领取后与确认付款后发生退款 | 原领取人不能自撤；金额/收款快照/唯一流水/凭证摘要一致；分别生成付款状态不确定或付款后追偿，未结前冻结后续结算。 |
| 7 | 十个微信模板分别授权、发送、拒绝、耗尽和换模板 | 授权绑定当时实际模板 ID；旧授权不能挪给新模板；结果未知不自动重发；失败进入站内通知和 readiness。 |
| 8 | 文本审核提供方超时/无效响应，媒体删除适配器失败 | 聊天/社区转人工，公开资料写入返回 503 且不公开；删除失败不伪装成功并按退避重试。 |
| 9 | 员工 token 签发后降权/限制，普通用户 restricted/banned，账户注销含未决资金 | 员工立即失去后台读写；普通 restricted 仅保留只读和法定自助入口；注销不绕过退款、支付和留存义务。 |
| 10 | 清空所有演练积压后访问 `/api/v1/admin/commercial/readiness` | 所有 blocker 为 0、状态为 `clear`；随后分别制造失败退款、过期租约和审核积压，确认门禁转为 `attentionRequired` 并真实告警。 |

## 微信小程序验收

前置：在小程序后台将 staging API 配置为 request 合法域名；配置有效 HTTPS 证书、ICP备案域名、测试小程序 AppID，并在 `.env.staging` 填写 `WECHAT_MINIPROGRAM_APP_ID` / `WECHAT_MINIPROGRAM_APP_SECRET`。若验证真实支付，商户号必须已绑定该小程序 AppID 并获 JSAPI 权限。

| # | 场景 | 期望 |
|---|------|------|
| 1 | 真机首次打开小程序 | `wx.login` → `/auth/wechat/mini-program`；得到独立 JWT 会话，不保存 AppSecret 或 session_key |
| 2 | 发现、详情、广场、评价 | 读取 NestJS 正式 API 数据；只展示实名、商业档案已复核且已上架的陪伴者 |
| 3 | 创建订单 → 陪伴者确认 → `channel=miniProgram` prepay | 未确认时禁止支付；staging mock 返回 `wechatMiniProgramParams`；真实环境能调起 `wx.requestPayment` |
| 4 | 取消 / 成功支付 | 取消不标记 paid；成功后以微信回调刷新订单和会话 |
| 5 | 聊天和举报 | 正常、warn、review、block 提示可见；举报只提交服务端回执 |
| 6 | 陪伴者订单 | paid → inService → completed 状态流转正确；完成订单可评价 |
| 7 | 隐私保护指引 | 首次涉及聊天、支付或发帖时，平台要求时可正常授权；隐私链接可打开 |

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
