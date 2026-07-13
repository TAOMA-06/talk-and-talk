# Talk&Talk 项目指引

> 新人 / 协作者 / AI 助手请先读本文，再改代码或回答问题。

## 1. 产品是什么

**Talk&Talk** 是一个「女性友好的线上陪伴服务」平台：情绪倾听、职场减压、睡前陪伴等纯线上服务。

核心红线：

- 所有沟通必须在平台内完成。
- 禁止引导私联、线下见面、私下转账。
- 需要内容安全审查，保护用户不被骚扰、诱骗或引流到平台外。

当前仓库正在从演示工程迁移到正式后端。旧 Node demo 后端已移除，正式后端位于 `backend/api`。

## 2. AI 内容识别做什么

AI 内容识别是平台内容安全员，不是陪用户聊天的机器人。

当用户在 App 里发聊天消息或社区内容时，系统需要判断内容是否违规，并给出决策：

| 决策 | 含义 | 用户表现 |
|------|------|----------|
| `allow` | 正常内容 | 正常发出 |
| `review` | 边界内容 | 进入复核 |
| `warn` | 轻度越界 | 发出并提醒 |
| `block` | 高风险 | 拦截并生成安全提醒 |

正式后端已提供聊天与审核 API。`c1`–`c3` 聊天发送以服务端 `decision` 为准；iOS 的 `LocalModerationService` 仅用本地规则处理 DEBUG 失败兜底与尚未后端化的社区内容。DeepSeek 仅由后端可选启用，客户端不保存或直连任何 AI API key。

## 3. 当前架构

```text
talk-and-talk/
├── frontend/ios/          # iOS SwiftUI App，App Store/TestFlight 分发
├── backend/api/           # NestJS + TypeScript 正式后端
├── shared/contracts/      # OpenAPI v1，前后端共同契约
├── infra/                 # Docker Compose、nginx、secrets
├── docs/                  # 项目文档
├── README.md
└── NEXT_PHASE.md
```

旧 demo / 实验代码已从主分支移除；需要历史请查 git history。

| 模块 | 技术 | 当前状态 |
|------|------|----------|
| iOS App | SwiftUI, iOS 18+ | UI 与多数业务仍可本地运行 |
| 正式 API | NestJS, TypeScript | Auth + companions + conversations + moderation |
| 数据依赖 | Postgres, Redis | Docker Compose 已配置 |
| 内容审核 | 服务端 RuleEngine + 可选 DeepSeek | 聊天路径以服务端为准；社区/举报仍本地 |

## 4. App 与后端怎么协作

Phase 1：

- iOS Debug 默认运行前端离线演示：不连接后端且不要求登录；使用本地演示身份进入完整 App 壳，**不预填虚假陪伴者/广场用户/订单**（空状态与上架产物一致）；首次启动仍展示身份选择。
- Debug 需要本地 API 联调时，在 Run Scheme 环境变量中设置 `FRONTEND_DEMO_MODE=NO`，再使用 `http://127.0.0.1:3000`（列表数据来自后端 seed/真实写入）。
- Staging/Release 维持后端连接；App 启动时调用 `GET /api/v1/health` 检查后端状态。
- Debug 的本地人物、消息和支付闭环只在 `#if DEBUG` 中编译；Release 后端失败只显示空状态或错误。
- Release 聊天只写入后端已存在的正式会话，不生成自动陪伴者回复。
- 订单、社区、评价、陪伴者申请和服务方订单均由后端持久化；订单保存预约时间与人物/主题快照。
- 退款只有微信回调或主动查询确认成功后才更新订单为“已退款”；服务中/已完成订单先进入人工审核。
- 通知中心（支付/订单/审核/安全）、账号注销申请、安全加固（helmet、限流、日志脱敏、审计）已具备发行前基础。

Phase 2（Auth）：

- 正式账号体系：手机号验证码登录、Apple 登录、JWT access/refresh、logout、`GET /users/me`。
- iOS 启动门控：Debug 离线演示直接进入本地演示身份（市场数据为空壳）；Staging/Release 未登录显示 `LoginView`，已登录进入主 App。
- Token 持久化在 Keychain；401 时自动 refresh 并重试。
- Release 使用 `Config/Release.xcconfig` 中的生产 `BACKEND_BASE_URL`，CI 会扫描产物并拒绝 Demo/Mock 标记。
- 详见 [docs/auth-api.md](./auth-api.md)。

Phase 3（聊天/审核）：

- 正式聊天与审核 API 已接入：`POST /conversations/:id/messages`、`POST /moderation/check`、`GET /moderation/cases`（staff）。
- iOS 是用户/陪伴者客户端，不编译管理员页面、审核队列或处置动作；用户只能查看本人安全状态并提交举报。
- 聊天响应只返回用户可理解的审核决定与风险等级，举报响应只返回回执；规则命中、AI 原因和完整案件仅 staff API 可见。
- 审核流水线：RuleEngine →（高风险 block 跳过）可选 DeepSeek → Case/Evidence/ActionLog。
- Admin Moderation：概览、筛选队列、详情、会话证据、人工处置、样本标注/导出；动作写 `ModerationActionLog` + `AuditLog`。
- 用户举报：`POST /moderation/reports`；iOS 举报入口优先提交后端。
- Web 运营后台与 iOS 完全分离：本地工具入口为 `http://localhost:3000/admin/`，生产部署需独立访问控制。
- iOS `c1`–`c3` 以服务端 decision 为准（含 `review` 反馈「内容已进入平台复核」）。
- 会话、消息、审核工单持久化到 Postgres。

## 5. 启动方式

### 后端

```bash
cd backend/api
cp .env.example .env
npm install
npm run prisma:migrate
npm run prisma:seed      # companions + admin/moderator 账号
npm run start:dev
```

健康检查：

```bash
curl http://localhost:3000/api/v1/health
```

Web 审核后台：

```text
http://localhost:3000/admin/
```

开发账号：`13800000001`（admin）、`13800000002`（moderator）。`SMS_PROVIDER=mock` 时验证码见 API 日志。

Docker（本地）：

```bash
docker compose -f infra/docker-compose.yml up --build
```

Staging 部署：

```bash
cp backend/api/.env.staging.example backend/api/.env.staging
cd backend/api && npm run preflight:deployment -- .env.staging && cd ../..
DEPLOY_ENV_FILE=../backend/api/.env.staging \
  docker compose -f infra/docker-compose.prod.yml --env-file backend/api/.env.staging up -d --build
./backend/api/scripts/acceptance-smoke.sh https://api-staging.talkandtalk.app
```

生产部署默认加载 `backend/api/.env.production`（见 `infra/docker-compose.prod.yml` 中 `DEPLOY_ENV_FILE`，路径相对 `infra/`）。

环境变量：`APP_ENV`（development/staging/production）控制 mock 支付与 seed；`GET /api/v1/health` 返回 metrics 快照。

iOS：Debug 默认 `http://127.0.0.1:3000`（[`Config/Debug.xcconfig`](../frontend/ios/Config/Debug.xcconfig)）；Release 默认 `https://api.talkandtalk.app`。TestFlight 前在 `Config/Shared.xcconfig` 填写 `WECHAT_APP_ID` 与 Apple Team。

### iOS

```bash
open frontend/ios/TalkAndTalk.xcodeproj
```

模拟器默认后端地址：`http://127.0.0.1:3000`。真机调试时使用 `BACKEND_BASE_URL` 指向 Mac 局域网 IP。

## 6. 测试

```bash
cd backend/api
npm test
npm run test:preflight
npm run test:e2e         # 同 npm run test:integration；需 Postgres + Redis
./scripts/acceptance-smoke.sh http://127.0.0.1:3000
```

iOS：

```bash
xcodebuild test \
  -project frontend/ios/TalkAndTalk.xcodeproj \
  -scheme TalkAndTalk \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5' \
  -only-testing:TalkAndTalkTests
```

发行前手工回归与生产检查：

- [staging-acceptance.md](./staging-acceptance.md)
- [production-checklist.md](./production-checklist.md)
- 契约冻结：[shared/contracts](../shared/contracts)
- 未交付范围：[NEXT_PHASE.md](../NEXT_PHASE.md)

## 7. 常见误区

| 误区 | 正确理解 |
|------|----------|
| “旧 demo 后端还在” | 已从主分支移除；正式后端在 `backend/api`；历史见 git history |
| “聊天已经完全接正式后端” | `c1`–`c3` 聊天与审核已走正式后端；举报已接 `POST /moderation/reports`；社区仍本地；DEBUG 失败可本地兜底 |
| “AI 是陪聊” | AI/审核逻辑只负责内容安全 |
| “在根目录 npm start” | 后端命令在 `backend/api` 执行 |
| “审核后台还是旧 demo” | 运维控制台在 `backend/api/public/admin` + `/api/v1/admin/moderation/*` |

## 8. 改代码建议

| 需求 | 建议位置 |
|------|----------|
| Auth API 契约 | `docs/auth-api.md` |
| 后端 Auth / JWT | `backend/api/src/auth` |
| iOS 登录与 token | `frontend/ios/Sources/Data/Auth` |
| 后端基础设施 / health | `backend/api/src` |
| iOS 后端地址与开关 | `frontend/ios/Sources/Data/API/BackendConfig.swift` |
| iOS API client | `frontend/ios/Sources/Data/API/BackendClient.swift` |
| 本地内容审核规则（DEBUG/非后端会话） | `frontend/ios/Sources/Data/Moderation/RuleBasedModerationEngine.swift` |
| 正式审核 API（RuleEngine + DeepSeek） | `backend/api/src/moderation` |
| Admin 审核 API / 处置 / 样本 | `backend/api/src/admin/moderation` |
| Web 审核后台 | `backend/api/public/admin` |
| Admin 审核契约 | `docs/admin-moderation-api.md` |
