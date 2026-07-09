# Talk&Talk

女性友好的线上陪伴服务工程（iOS App + 正式 NestJS 后端）。

新人请先读 [docs/GUIDE.md](./docs/GUIDE.md)。它说明产品边界、AI 内容识别的职责、当前分阶段后端化状态和常见误区。

## 快速开始

### iOS App

```bash
open apps/ios/TalkAndTalk.xcodeproj
# Xcode -> TalkAndTalk scheme -> 模拟器运行
```

工程由 XcodeGen 生成：

```bash
cd apps/ios
xcodegen generate
```

模拟器默认正式后端地址为 `http://127.0.0.1:3000`，可用 Scheme 环境变量 `BACKEND_BASE_URL` 覆盖。真机调试时将它设为 Mac 局域网 IP，例如 `http://192.168.1.10:3000`。

### 正式后端

```bash
cd services/api
cp .env.example .env
npm install
npx prisma migrate deploy
npm run start:dev
```

健康检查：

```bash
curl http://localhost:3000/api/v1/health
```

发送验证码（开发环境 mock SMS，验证码会打印在 API 日志）：

```bash
curl -X POST http://localhost:3000/api/v1/auth/sms/send-code \
  -H 'Content-Type: application/json' \
  -d '{"phone":"13800138000"}'
```

Docker 启动 API、Postgres、Redis：

```bash
docker compose up --build
```

## 仓库结构

| 路径 | 说明 |
|------|------|
| [docs/GUIDE.md](./docs/GUIDE.md) | 项目总指引 |
| [docs/auth-api.md](./docs/auth-api.md) | Auth API 契约 |
| [apps/ios/](./apps/ios/) | iOS SwiftUI App |
| [services/api/](./services/api/) | NestJS + TypeScript 正式后端 |
| [docs/review.md](./docs/review.md) | iOS 代码逐文件说明 |
| [archive/](./archive/) | 旧实验，非主工程 |

## 当前能力边界

- **正式后端 Phase 1**：NestJS 工程、统一 envelope、health、Docker Compose、Prisma。
- **正式后端 Phase 2（Auth）**：手机号/Apple 登录、JWT、refresh/logout、RBAC、`GET /users/me`。
- **iOS 已连接**：登录门控、Keychain token、自动 refresh；`c1`/`c2`/`c3` 为后端聊天对象。
- **仍需兜底**：Day 4 聊天/审核接口完成前，聊天失败会自动回到 App 本地逻辑。
- **后续阶段**：聊天与内容审核 API、业务域持久化会逐步迁移到正式后端。

## 测试

```bash
cd services/api
npm test
npm run test:e2e
```

iOS 测试需 Xcode：

```bash
xcodebuild test \
  -project apps/ios/TalkAndTalk.xcodeproj \
  -scheme TalkAndTalk \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5' \
  -only-testing:TalkAndTalkTests
```
