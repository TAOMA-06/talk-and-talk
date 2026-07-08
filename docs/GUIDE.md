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

正式后端 Phase 1 只交付基础设施与 health。聊天和审核 API 会在 Phase 2 迁移到后端；在此之前，iOS 继续使用本地 `HybridModerationService` 和规则引擎兜底。

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
| 正式 API | NestJS, TypeScript | Phase 1 基础设施与 health |
| 数据依赖 | Postgres, Redis | Docker Compose 已配置 |
| 内容审核 | 本地规则服务 | Phase 2 迁移到正式 API |

## 4. App 与后端怎么协作

Phase 1：

- iOS 默认连接 `http://127.0.0.1:3000`。
- App 启动时调用 `GET /api/v1/health` 检查正式后端状态。
- `BackendConfig.supportsChat` 对 `c1` / `c2` / `c3` 返回 true，用来标记这些会话需要优先尝试正式后端。
- Day 4 聊天/审核接口完成前，后端聊天调用失败会自动回退到 App 本地聊天与本地审核，不能阻断用户使用。
- 社区发帖、订单、支付等仍走 App 本地逻辑。

Phase 2：

- 新增正式聊天与审核 API。
- iOS 再开启后端聊天同步。
- 会话、消息、审核工单持久化到 Postgres。

## 5. 启动方式

### 后端

```bash
cd services/api
cp .env.example .env
npm install
npm run start:dev
```

健康检查：

```bash
curl http://localhost:3000/api/v1/health
```

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
| “聊天已经完全接正式后端” | Phase 1 会尝试正式聊天接口，但接口未完成时必须本地兜底 |
| “AI 是陪聊” | AI/审核逻辑只负责内容安全 |
| “在根目录 npm start” | 后端命令在 `services/api` 执行 |

## 8. 改代码建议

| 需求 | 建议位置 |
|------|----------|
| 后端基础设施 / health | `services/api/src` |
| iOS 后端地址与开关 | `apps/ios/Sources/Data/API/BackendConfig.swift` |
| iOS API client | `apps/ios/Sources/Data/API/BackendClient.swift` |
| 本地内容审核规则 | `apps/ios/Sources/Data/Moderation/RuleBasedModerationEngine.swift` |
| 后续正式审核 API | `services/api/src/moderation` |
