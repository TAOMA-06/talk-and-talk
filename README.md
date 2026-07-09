# Talk&Talk

女性友好的线上陪伴服务工程（iOS App + NestJS 正式后端）。

- 新人请先读 [docs/GUIDE.md](./docs/GUIDE.md)
- **v0.1 已冻结 `/api/v1` 契约**：[packages/contracts](./packages/contracts)
- 未交付能力见 [NEXT_PHASE.md](./NEXT_PHASE.md)（不在本发行范围）

## 仓库结构

| 路径 | 说明 |
|------|------|
| [docs/GUIDE.md](./docs/GUIDE.md) | 项目总指引 |
| [packages/contracts](./packages/contracts) | OpenAPI v1 冻结契约 |
| [docs/auth-api.md](./docs/auth-api.md) | Auth API 说明 |
| [docs/admin-moderation-api.md](./docs/admin-moderation-api.md) | 审核后台 API |
| [docs/staging-acceptance.md](./docs/staging-acceptance.md) | Staging 联调与 iOS 回归 |
| [docs/deploy-rollback.md](./docs/deploy-rollback.md) | 部署与回滚 |
| [docs/production-checklist.md](./docs/production-checklist.md) | 生产检查清单 |
| [docs/app-store-metadata.md](./docs/app-store-metadata.md) | App Store Connect 元数据 |
| [apps/ios/](./apps/ios/) | iOS SwiftUI App（**仅使用** `TalkAndTalk.xcodeproj`） |
| [services/api/](./services/api/) | NestJS 后端 |
| [deploy/nginx/](./deploy/nginx/) | TLS 反代示例 |
| [archive/](./archive/) | 旧实验，非主工程 |

## 快速开始

### 后端

```bash
cd services/api
cp .env.example .env
npm install
# 本地开发：创建并应用 migration（见下方 Migration）；需 Postgres + Redis 可达
npm run prisma:migrate
npm run prisma:seed
npm run start:dev
```

健康检查：

```bash
curl http://localhost:3000/api/v1/health
```

Web 审核后台：`http://localhost:3000/admin/`  
法律页：`http://localhost:3000/legal/privacy.html`、`/legal/terms.html`  
开发账号：`13800000001`（admin）、`13800000002`（moderator）；`SMS_PROVIDER=mock` 时验证码见 API 日志。

Docker（本地 API + Postgres + Redis）：

```bash
docker compose up --build
```

### iOS

```bash
cd apps/ios
xcodegen generate   # 修改 project.yml 后
open TalkAndTalk.xcodeproj
```

- Debug 默认后端：`http://127.0.0.1:3000`
- Release 默认：`https://api.talkandtalk.app`
- 真机调试：Scheme / `BACKEND_BASE_URL` 指向 Mac 局域网 IP
- TestFlight 前在 `Config/Shared.xcconfig` 填写 `WECHAT_APP_ID` 与 Apple Team

## 环境变量

完整示例见：

- 开发：`services/api/.env.example`
- Staging：`services/api/.env.staging.example`
- 生产：`services/api/.env.production.example`

| 变量 | 说明 | 生产 |
|------|------|------|
| `NODE_ENV` | `development` / `test` / `production` | `production` |
| `APP_ENV` | `development` / `staging` / `production`（控制 mock 支付/SMS/seed 策略） | `production` |
| `PORT` | 监听端口，默认 `3000` | 按部署 |
| `API_PREFIX` | 固定 `api/v1`（契约前缀） | 勿改 |
| `APP_VERSION` | health/metrics 版本串 | 与 git tag 对齐 |
| `DATABASE_URL` | Postgres 连接串 | 强密码 |
| `REDIS_URL` | Redis 连接串 | 建议带密码 |
| `CORS_ORIGINS` | 逗号分隔 allowlist | **必填** |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | JWT 密钥 | **必填、高强度** |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | 默认 `15m` / `30d` | 按需 |
| `SMS_CODE_TTL_SECONDS` | 验证码 TTL，默认 `300` | |
| `SMS_PROVIDER` | `mock` / `none`（真实厂商见 NEXT_PHASE） | **禁止 mock**；`none` 则无短信登录 |
| `DEEPSEEK_API_KEY` | 可选；空则纯规则审核 | 可选 |
| `DEEPSEEK_URL` / `DEEPSEEK_MODEL` | DeepSeek 配置 | 有 key 时需要 |
| `WECHAT_PAY_*` | 微信商户与证书路径、回调 base | 真实收款时必填 |
| `APPLE_SIGN_IN_BUNDLE_ID` | 须与 iOS `com.talkandtalk.app` 一致 | 必填 |
| `RATE_LIMIT_PER_MINUTE` | IP 限流，默认 `120` | |
| `BODY_SIZE_LIMIT` | 默认 `1mb` | |
| `SEED_ON_STARTUP` | 容器启动时 seed | 生产 **false** |

`.env` / `.env.staging` / `.env.production` 已 gitignore，勿提交密钥。

## Migration

```bash
cd services/api
npm run prisma:migrate   # 开发：创建并应用（改 schema 时用）
npm run prisma:deploy    # 生产 / Docker entrypoint：只应用已有 migration
```

首次克隆仓库、仅跑已有 migration 时，开发环境仍用 `prisma:migrate`（不会无故新建 migration，除非 `schema.prisma` 与库不一致）。

Docker entrypoint 在启动 API 前执行 `prisma migrate deploy`。

## Seed

```bash
cd services/api
npm run prisma:seed
# 或
npm run db:seed
```

写入陪伴者与 staff 手机号。生产首次可临时 `SEED_ON_STARTUP=true`，就绪后改 `false` 并轮换默认管理员。

## 测试

```bash
cd services/api
npm test                 # unit（src/**/*.spec.ts）
npm run test:e2e         # HTTP 集成级 e2e（需 Postgres + Redis）
npm run test:integration # 同 test:e2e 别名
./scripts/acceptance-smoke.sh http://127.0.0.1:3000
```

iOS：

```bash
xcodebuild test \
  -project apps/ios/TalkAndTalk.xcodeproj \
  -scheme TalkAndTalk \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5' \
  -only-testing:TalkAndTalkTests
```

手工回归清单见 [docs/staging-acceptance.md](./docs/staging-acceptance.md)。

## 部署（Staging / Production）

```bash
# Production（默认加载 services/api/.env.production）
cp services/api/.env.production.example services/api/.env.production
# 填写密钥后：
docker compose -f docker-compose.prod.yml up -d --build

# Staging
cp services/api/.env.staging.example services/api/.env.staging
DEPLOY_ENV_FILE=./services/api/.env.staging \
  docker compose -f docker-compose.prod.yml --env-file services/api/.env.staging up -d --build
```

- Nginx TLS 示例：`deploy/nginx/talk-and-talk.conf.example`，证书目录 `deploy/nginx/certs/`
- 回滚： [docs/deploy-rollback.md](./docs/deploy-rollback.md)
- 上线勾选： [docs/production-checklist.md](./docs/production-checklist.md)

## 备份

```bash
DATABASE_URL=postgres://... ./services/api/scripts/db-backup.sh
```

建议 cron 每日执行，发布前再跑一次。恢复步骤见 deploy-rollback 文档。

## 微信支付

- 环境变量：`WECHAT_PAY_APP_ID`、`MCH_ID`、`API_V3_KEY`、`PRIVATE_KEY_PATH`、`CERT_SERIAL_NO`、`NOTIFY_BASE_URL`
- 流程：创建订单 → `POST /orders/:id/prepay` → 客户端调起微信 / mock → `POST /payments/wechat/notify` 或 staging `mock-notify`
- `APP_ENV=staging|development` 可用 mock 闭环；**生产真实预支付若代码仍为壳实现则不可收款**（NEXT_PHASE）
- iOS：`WECHAT_APP_ID` 未配置时 Release 显示「微信支付未配置」类错误

## DeepSeek

- 可选内容审核增强；`DEEPSEEK_API_KEY` 为空时 **RuleEngine 独立运行**
- 高风险 rule `block` 会跳过 AI

## 短信

- 开发/staging：`SMS_PROVIDER=mock`，验证码打日志
- 生产：禁止 mock；当前无阿里云/腾讯实现时只能 `none`（无短信登录）或阻塞上线 → NEXT_PHASE

## Apple 登录

- 后端：`APPLE_SIGN_IN_BUNDLE_ID=com.talkandtalk.app`，校验 Apple identity token
- iOS：Sign in with Apple entitlement 已配置

## 常见故障

| 现象 | 排查 |
|------|------|
| health `degraded` | Postgres/Redis 连不上；查 `DATABASE_URL` / `REDIS_URL` 与容器网络 |
| 登录 401 验证码错误 | mock 看 API 日志；生产 `none` 无法发码 |
| CORS 浏览器报错 | 生产必须配置 `CORS_ORIGINS` |
| JWT 启动失败 | 生产未设置或过短的 secret |
| 微信回调失败 | 证书路径、通知 URL、签名；staging 用 mock-notify |
| 支付结果未确认 | 回调延迟；订单页刷新；勿重复支付 |
| metrics 公网暴露 | 仅内网抓取 `/api/v1/metrics` |
| iOS 无法连接 | Release 需合法 `BACKEND_BASE_URL`；真机勿用 `127.0.0.1` |
| Archive 签名失败 | Xcode 配置 Development Team；版本号见 `project.yml` |

## 当前能力边界（v0.1）

- Auth：手机（mock）/ Apple、JWT、refresh/logout、`/me`
- 陪伴者列表与详情、订单与 mock 支付闭环
- `c1`–`c3` 聊天 + 服务端审核；Admin 审核 Web
- 通知、注销申请、日志脱敏、限流、helmet
- **不做**：复杂推荐、人脸实名、多支付、完整社区后端等 → [NEXT_PHASE.md](./NEXT_PHASE.md)
