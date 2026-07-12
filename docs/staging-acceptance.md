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
| 1 | `prisma:migrate` + `seed` | 5 陪伴者；admin `13800000001`、moderator `13800000002` |
| 2 | `POST /api/v1/auth/sms/send-code` + `phone/login` | 返回 access/refresh token |
| 3 | `GET /api/v1/companions` | 返回 seed 陪伴者列表 |
| 4 | `POST /api/v1/orders` → `prepay` | `payment.mock=true`（staging） |
| 5 | iOS 微信沙箱唤起 **或** `POST /payments/wechat/mock-notify` | 订单 `paid`，会话激活 |
| 6 | `POST /conversations/c1/messages` 正常文案 | `decision=allow`，有 `companionReply` |
| 7 | 发送「加微信私下聊」等违规文案 | `decision=block`，`safetyMessage`，创建 ModerationCase |
| 8 | Web `http://<host>/admin/` moderator 登录处置 | `confirmViolation` / `dismiss` 写入 ActionLog |
| 9 | `GET /api/v1/health` | `metrics` 含请求数、错误率、AI/微信计数 |

## 自动化冒烟

```bash
./backend/api/scripts/acceptance-smoke.sh http://127.0.0.1:3000
```

## iOS 完整回归（TestFlight / Staging 前）

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
