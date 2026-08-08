# Talk&Talk 项目指引

> 新人 / 协作者 / AI 助手请先读本文，再改代码或回答问题。

## 1. 产品是什么

**Talk&Talk** 是一个「女性友好的线上陪伴服务」平台：情绪倾听、职场减压、睡前陪伴等纯线上服务。

核心红线：

- 所有沟通必须在平台内完成。
- 禁止引导私联、线下见面、私下转账。
- 需要内容安全审查，保护用户不被骚扰、诱骗或引流到平台外。

当前发行范围是微信小程序与正式 NestJS 后端。历史 iOS 工程保留作参考，不纳入聊天审核 v2 的实现或发布验收；旧 Node demo 后端已移除，正式后端位于 `backend/api`。

## 2. AI 内容识别做什么

AI 内容识别是平台内容安全员，不是陪用户聊天的机器人。

当用户在 App 里发聊天消息或社区内容时，系统需要判断内容是否违规，并给出决策：

| 决策 | 含义 | 用户表现 |
|------|------|----------|
| `allow` | 正常内容 | 正常发出 |
| `review` | 边界内容 | 进入复核 |
| `warn` | 轻度越界 | 发出并提醒 |
| `block` | 高风险 | 拦截并生成安全提醒 |

正式后端已提供聊天与审核 API。`c1`–`c3` 聊天发送以服务端 `decision` 为准；客户端不保存或直连任何 AI API key。当前版本只使用服务端本地规则与授权人工复核，所有环境都禁止把用户原文发送给 DeepSeek 或其他外部生成式 AI 服务。

## 3. 当前架构

```text
talk-and-talk/
├── frontend/miniprogram/  # 当前发行：原生 TypeScript 微信小程序
├── frontend/ios/          # 历史/后续 SwiftUI 工程，不参与当前放行
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
| 微信小程序 | 原生 TypeScript | 当前唯一商用客户端；覆盖微信登录、商品/时段、订单、支付、履约、售后和双角色工作台 |
| iOS App | SwiftUI, iOS 18+ | 历史/后续工程，可本地运行但不属于当前发行或验收范围 |
| 正式 API | NestJS, TypeScript | Auth、供给、商品、容量、推荐、订单、支付、会话、审核、退款、结算与运营控制 |
| 数据依赖 | Postgres, Redis | Docker Compose 已配置 |
| 内容审核 | 服务端 RuleEngine + 独立人工复核；外部用户原文传输关闭 | 聊天、社区、公开昵称、评价和陪伴者资料均以服务端为准 |

## 4. App 与后端怎么协作

当前发行（微信小程序 + NestJS）：

- 小程序以 `wx.login` 建立微信身份，服务端签发 JWT access/refresh；法律同意、18+ 门禁、注销与同意撤回均保留服务端证据。
- 默认发现与推荐只展示未来 7 天内同时具有当前商品和结构化剩余容量的陪伴者；卡片价格来自 SKU，不来自可编辑资料价。
- 商用创建订单必须携带稳定幂等键、商品 ID 和时段 ID。服务端在创建、接单和预支付阶段重复校验价格、资格和容量。
- 订单、支付、退款、评价、聊天权益、结算和追偿均以服务端事实为准；小程序不自行推导资金或权限状态。
- 正式聊天与审核 API 已接入微信小程序：`POST /conversations/:id/messages`、媒体直传预留/完成、`POST /moderation/appeals`、`GET /conversations/:id/status` 与 staff 审核接口。
- 文本、图片、短语音统一走 `queued → pendingReview/published/blocked → 人工复核 → 处置/申诉`；接收方不会看到待审文本或未获批准媒体。
- 聊天响应只返回用户可理解的审核决定与风险等级，举报响应只返回回执；规则命中、AI 原因和完整案件仅 staff API 可见。
- 审核流水线：本地 RuleEngine → Case/Evidence/ActionLog → 必要的授权人工复核；高风险或待复核内容不会自动公开。当前 provider 边界会拒绝所有用户原文，DeepSeek 或其他外部生成式 AI 不是生产依赖。
- Review Department：概览、筛选队列、详情、会话证据、人工处置、样本标注/导出；审核员使用独立 `ReviewStaff`，动作写 `ModerationActionLog`、`AuditLog` 与 `ReviewAuditLog`。
- 用户举报、广场举报和订单客服均只返回权限内的收讫/状态，不向用户泄漏另一方或内部案件细节。
- Web 审核部门与普通用户/陪伴者客户端完全分离：本地工具入口为 `http://localhost:3000/review/`，生产部署需独立访问控制。
- 会话、消息、审核工单持久化到 Postgres。

历史 iOS：

- 仅用于参考或后续独立立项；它的 Debug 演示、Apple 登录、Keychain、TestFlight 或 App Store 配置都不是当前小程序商用放行条件。
- 不允许以 iOS 已有页面作为当前能力完成的证据；当前真实行为以小程序、NestJS、冻结契约和生产检查清单为准。

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

独立审核部门工作台：

```text
http://localhost:3000/review/
```

开发 seed phone 身份为 `13800000001`（admin）、`13800000002`（moderator），仅用于 API 测试。Web 审核部门使用独立密码 + TOTP，按 `docs/review-department.md` 初始化。

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

环境变量：`APP_ENV`（development/staging/production）控制 mock 支付与 seed；`GET /api/v1/health` 返回精简 liveness，依赖细节走鉴权后的 `/api/v1/health/ready`；metrics 需携带 `Authorization: Bearer $METRICS_TOKEN` 请求 `/api/v1/metrics`（staging/production 强制）。

微信小程序的当前本地结构与运行冒烟见 [小程序 README](../frontend/miniprogram/README.md)，真实环境联调见 [staging-acceptance.md](./staging-acceptance.md)，商用闭环证据见 [commercial-interface-closure.md](./commercial-interface-closure.md)。[miniprogram-verification.md](./miniprogram-verification.md) 只保留 2026-07-13 的历史双端验证记录。历史 iOS 若需单独维护，再按 `frontend/ios` 内配置运行；它不进入本节首发步骤。

## 6. 测试

```bash
cd backend/api
npm test
npm run test:preflight
npm run test:e2e         # 同 npm run test:integration；需 Postgres + Redis
./scripts/acceptance-smoke.sh http://127.0.0.1:3000
```

历史 iOS（可选，不属于当前放行）：

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
- [core-tolerance-and-expansion-matrix.md](./core-tolerance-and-expansion-matrix.md)
- 契约冻结：[shared/contracts](../shared/contracts)
- 未交付范围：[NEXT_PHASE.md](../NEXT_PHASE.md)
- 后端商业化差距审查：[backend-commercialization-gap-audit.md](./backend-commercialization-gap-audit.md)

## 7. 常见误区

| 误区 | 正确理解 |
|------|----------|
| “旧 demo 后端还在” | 已从主分支移除；正式后端在 `backend/api`；历史见 git history |
| “iOS 页面存在，所以它也是本次首发” | 当前唯一发行范围是微信小程序 + NestJS；iOS 为历史/后续工程 |
| “资料已发布就一定能被首页推荐” | 默认目录与推荐还要求当前有效 SKU、未来 7 天结构化剩余容量和启用的交付方式 |
| “聊天已经完全接正式后端” | 小程序正式聊天、举报、审核与权益均走后端；生产故障不得用本地假消息或自动回复兜底 |
| “AI 是陪聊” | AI/审核逻辑只负责内容安全 |
| “在根目录 npm start” | 后端命令在 `backend/api` 执行 |
| “审核后台还是旧 demo” | 独立审核工作台在 `backend/api/public/review` + `/api/v1/review/*` |

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
| 正式审核 API（RuleEngine + 独立人工复核） | `backend/api/src/moderation` |
| 审核部门 API / 处置 / 样本 | `backend/api/src/review`（包括独立的受控案件决策服务） |
| Web 审核工作台 | `backend/api/public/review` |
| Admin 审核契约 | `docs/admin-moderation-api.md` |
