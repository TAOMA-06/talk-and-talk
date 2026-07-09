# Talk&Talk 项目指引

> 新人 / 协作者 / AI 助手请先读本文，再改代码或回答问题。

## 1. 产品是什么

**Talk&Talk** 是一个「女性友好的线上陪伴服务」平台：情绪倾听、职场减压、睡前陪伴等纯线上服务。

核心红线：

- 所有沟通必须在平台内完成。
- 禁止引导私联、线下见面、私下转账。
- 需要内容安全审查，保护用户不被骚扰、诱骗或引流到平台外。

当前仓库正在从演示工程迁移到正式后端。旧 Node demo 后端已移除，正式后端位于 `services/api`。

## 2. AI 内容识别做什么

AI 内容识别是平台内容安全员，不是陪用户聊天的机器人。

当用户在 App 里发聊天消息或社区内容时，系统需要判断内容是否违规，并给出决策：

| 决策 | 含义 | 用户表现 |
|------|------|----------|
| `allow` | 正常内容 | 正常发出 |
| `review` | 边界内容 | 进入复核 |
| `warn` | 轻度越界 | 发出并提醒 |
| `block` | 高风险 | 拦截并生成安全提醒 |

正式后端已提供聊天与审核 API。`c1`–`c3` 聊天发送以服务端 `decision` 为准；本地 `HybridModerationService` 仅作 DEBUG 失败兜底与非后端会话。DeepSeek 为可选：未配置 `DEEPSEEK_API_KEY` 时纯规则审核仍可运行。

## 3. 当前架构

```text
talk-and-talk/
├── apps/ios/          # iOS SwiftUI App
├── services/api/      # NestJS + TypeScript 正式后端
├── docs/              # 项目文档
└── archive/           # 旧实验，非主工程
```

| 模块 | 技术 | 当前状态 |
|------|------|----------|
| iOS App | SwiftUI, iOS 18+ | UI 与多数业务仍可本地运行 |
| 正式 API | NestJS, TypeScript | Auth + companions + conversations + moderation |
| 数据依赖 | Postgres, Redis | Docker Compose 已配置 |
| 内容审核 | 服务端 RuleEngine + 可选 DeepSeek | 聊天路径以服务端为准；社区/举报仍本地 |

## 4. App 与后端怎么协作

Phase 1：

- iOS 默认连接 `http://127.0.0.1:3000`。
- App 启动时调用 `GET /api/v1/health` 检查正式后端状态。
- `BackendConfig.supportsChat` 对 `c1` / `c2` / `c3` 返回 true；这些会话优先走正式后端聊天与审核。
- DEBUG 下后端聊天失败可回退本地聊天与本地审核；Release 失败则提示重试，不以本地规则覆盖服务端决策。
- 订单/微信支付闭环已接正式后端（创建 → 预支付 → 回调/mock 回调 → paid 并激活会话）；社区发帖等仍可有本地逻辑。

Phase 2（Auth）：

- 正式账号体系：手机号验证码登录、Apple 登录、JWT access/refresh、logout、`GET /users/me`。
- iOS 启动门控：未登录显示 `LoginView`，已登录进入主 App。
- Token 持久化在 Keychain；401 时自动 refresh 并重试。
- Release 构建必须在 Info.plist 或 Scheme 中配置 `BACKEND_BASE_URL`。
- 详见 [docs/auth-api.md](./auth-api.md)。

Phase 3（聊天/审核）：

- 正式聊天与审核 API 已接入：`POST /conversations/:id/messages`、`POST /moderation/check`、`GET /moderation/cases`（staff）。
- 审核流水线：RuleEngine →（高风险 block 跳过）可选 DeepSeek → Case/Evidence/ActionLog。
- Admin Moderation：概览、筛选队列、详情、会话证据、人工处置、样本标注/导出；动作写 `ModerationActionLog` + `AuditLog`。
- 用户举报：`POST /moderation/reports`；iOS 举报入口优先提交后端。
- Web 运营后台：`http://localhost:3000/admin/`。
- iOS `c1`–`c3` 以服务端 decision 为准（含 `review` 反馈「内容已进入平台复核」）。
- 会话、消息、审核工单持久化到 Postgres。

## 5. 启动方式

### 后端

```bash
cd services/api
cp .env.example .env
npm install
npm run prisma:migrate   # 或 prisma:deploy
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

Docker：

```bash
docker compose up --build
```

### iOS

```bash
open apps/ios/TalkAndTalk.xcodeproj
```

模拟器默认后端地址：`http://127.0.0.1:3000`。真机调试时使用 `BACKEND_BASE_URL` 指向 Mac 局域网 IP。

## 6. 测试

```bash
cd services/api
npm test
npm run test:e2e
```

iOS：

```bash
xcodebuild test \
  -project apps/ios/TalkAndTalk.xcodeproj \
  -scheme TalkAndTalk \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5' \
  -only-testing:TalkAndTalkTests
```

## 7. 常见误区

| 误区 | 正确理解 |
|------|----------|
| “旧 demo 后端还在” | 已移除，正式后端在 `services/api` |
| “聊天已经完全接正式后端” | `c1`–`c3` 聊天与审核已走正式后端；举报已接 `POST /moderation/reports`；社区仍本地；DEBUG 失败可本地兜底 |
| “AI 是陪聊” | AI/审核逻辑只负责内容安全 |
| “在根目录 npm start” | 后端命令在 `services/api` 执行 |
| “审核后台还是旧 demo” | 已迁到 `services/api/public/admin` + `/api/v1/admin/moderation/*` |

## 8. 改代码建议

| 需求 | 建议位置 |
|------|----------|
| Auth API 契约 | `docs/auth-api.md` |
| 后端 Auth / JWT | `services/api/src/auth` |
| iOS 登录与 token | `apps/ios/Sources/Data/Auth` |
| 后端基础设施 / health | `services/api/src` |
| iOS 后端地址与开关 | `apps/ios/Sources/Data/API/BackendConfig.swift` |
| iOS API client | `apps/ios/Sources/Data/API/BackendClient.swift` |
| 本地内容审核规则（DEBUG/非后端会话） | `apps/ios/Sources/Data/Moderation/RuleBasedModerationEngine.swift` |
| 正式审核 API（RuleEngine + DeepSeek） | `services/api/src/moderation` |
| Admin 审核 API / 处置 / 样本 | `services/api/src/admin/moderation` |
| Web 审核后台 | `services/api/public/admin` |
| Admin 审核契约 | `docs/admin-moderation-api.md` |
