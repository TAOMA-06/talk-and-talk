# Talk&Talk

女性友好的线上陪伴服务工程。**当前唯一发行范围是微信小程序 + NestJS 后端**；`frontend/ios` 仅保留为历史/后续工程，不参与本次商用放行。

- 新人请先读 [docs/GUIDE.md](./docs/GUIDE.md)
- **v0.1 已冻结 `/api/v1` 契约**：[shared/contracts](./shared/contracts)
- 未交付能力见 [NEXT_PHASE.md](./NEXT_PHASE.md)（不在本发行范围）

## 仓库结构

```text
talk-and-talk/
├── frontend/ios/          # 历史 iOS 工程（不在当前发行范围）
├── frontend/miniprogram/  # 原生 TypeScript 微信小程序
├── backend/api/           # NestJS API（Docker 可部署）
├── shared/contracts/      # OpenAPI v1 前后端共同契约
├── infra/                 # Docker Compose、nginx、secrets
├── docs/
├── README.md
└── NEXT_PHASE.md
```

| 路径 | 说明 |
|------|------|
| [docs/GUIDE.md](./docs/GUIDE.md) | 项目总指引 |
| [shared/contracts](./shared/contracts) | OpenAPI v1 冻结契约 |
| [docs/auth-api.md](./docs/auth-api.md) | Auth API 说明 |
| [docs/admin-moderation-api.md](./docs/admin-moderation-api.md) | 审核后台 API |
| [docs/staging-acceptance.md](./docs/staging-acceptance.md) | Staging 与小程序联调 |
| [docs/deploy-rollback.md](./docs/deploy-rollback.md) | 部署与回滚 |
| [docs/production-checklist.md](./docs/production-checklist.md) | 生产检查清单 |
| [docs/COMMERCIAL_RELEASE.md](./docs/COMMERCIAL_RELEASE.md) | 正式商用交易模型、代码控制、外部 P0 与放行流程 |
| [docs/core-tolerance-and-expansion-matrix.md](./docs/core-tolerance-and-expansion-matrix.md) | CTO + 商务负责人视角的核心宽容度、硬边界、扩展触发器与放量规则 |
| [docs/wechat-backend-selection.md](./docs/wechat-backend-selection.md) | 微信后端方案选型、云托管部署与真机验收 |
| [docs/app-store-metadata.md](./docs/app-store-metadata.md) | App Store Connect 元数据 |
| [frontend/ios/](./frontend/ios/) | 历史 iOS SwiftUI App（当前不发布） |
| [frontend/miniprogram/](./frontend/miniprogram/) | 微信小程序（微信登录、JSAPI 支付、用户/陪伴者业务） |
| [backend/api/](./backend/api/) | NestJS 后端 |
| [infra/](./infra/) | Docker Compose、nginx TLS 示例、secrets 挂载 |

旧 demo / 实验代码已从主分支移除；需要历史请查 git history。

## 快速开始

### 后端

```bash
cd backend/api
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

Web 审核后台：`http://localhost:3000/admin/`（独立用户名、密码和 TOTP；初始化见 `docs/staff-operations.md`）
法律页：`http://localhost:3000/legal/privacy.html`、`/legal/terms.html`（稳定入口会跳转到配置化的当前版本）
开发普通 phone 身份：`13800000001`（admin）、`13800000002`（moderator）；审核后台不使用短信登录。

Docker（本地 API + Postgres + Redis）：

```bash
docker compose -f infra/docker-compose.yml up --build
```

### iOS（不在当前发行范围）

```bash
cd frontend/ios
xcodegen generate   # 修改 project.yml 后
open TalkAndTalk.xcodeproj
```

- Debug 默认启动前端离线演示（`FRONTEND_DEMO_MODE` 默认开启）：**不连接后端、不要求登录**，以本地演示身份进入完整 App 壳；**不注入虚假陪伴者/广场用户/订单**，发现与广场显示正式空状态，便于老板演示与上架观感对齐。
- 需要本地 API 联调时，在 Xcode 的 Run Scheme 环境变量中设置 `FRONTEND_DEMO_MODE=NO`；随后 Debug 使用 `http://127.0.0.1:3000`，列表数据来自后端（可用 `prisma:seed`）。
- Staging 使用远程 staging 后端并保留真实登录流程。
- Release 默认：`https://api.talkandtalk.app`
- 真机调试：Scheme / `BACKEND_BASE_URL` 指向 Mac 局域网 IP
- TestFlight 前在 `Config/Shared.xcconfig` 填写 `WECHAT_APP_ID` 与 Apple Team
- iOS 只承载普通用户与陪伴者双角色业务，不包含任何运营审核入口；审核、退款处置等管理员能力仅通过独立 Web 后台和 staff API 使用。

Release 数据安全规则：正式构建不会编译 `MockData` 或离线身份；陪伴者、社区、评价、消息、订单及退款失败时只显示空状态/错误。CI 会构建 Release 并运行 `frontend/ios/Scripts/check_release_artifact.sh`，测试姓名或 Demo/Mock 标记进入产物会直接失败。生产环境同时拒绝 `SEED_ON_STARTUP=true`。

## 环境变量

完整示例见：

- 开发：`backend/api/.env.example`
- Staging：`backend/api/.env.staging.example`
- 生产：`backend/api/.env.production.example`

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
| `STAFF_TOTP_ENCRYPTION_KEY` | 加密审核后台 TOTP 种子 | **必填、独立高强度密钥** |
| `DEEPSEEK_API_KEY` | 文本审核提供方凭据；本地可空 | **生产必填** |
| `DEEPSEEK_URL` / `DEEPSEEK_MODEL` | 文本审核端点与模型 | **生产显式配置、HTTPS** |
| `WECHAT_PAY_*` | 微信商户与证书路径、回调 base | 真实收款时必填 |
| `WECHAT_MINIPROGRAM_APP_ID` / `WECHAT_MINIPROGRAM_APP_SECRET` | 小程序登录与 JSAPI 支付 AppID；AppSecret 仅后端保存 | 小程序发行必填 |
| `APPLE_SIGN_IN_BUNDLE_ID` | 历史 iOS 登录配置 | 小程序首发不使用 |
| `RATE_LIMIT_PER_MINUTE` | IP 限流，默认 `120` | |
| `BODY_SIZE_LIMIT` | 默认 `1mb` | |
| `SEED_ON_STARTUP` | 容器启动时 seed | 生产 **false** |

`.env` / `.env.staging` / `.env.production` 已 gitignore，勿提交密钥。

## Migration

```bash
cd backend/api
npm run prisma:migrate   # 开发：创建并应用（改 schema 时用）
npm run prisma:deploy    # 生产 / Docker entrypoint：只应用已有 migration
```

首次克隆仓库、仅跑已有 migration 时，开发环境仍用 `prisma:migrate`（不会无故新建 migration，除非 `schema.prisma` 与库不一致）。

Docker entrypoint 在启动 API 前执行 `prisma migrate deploy`。

## Seed

```bash
cd backend/api
npm run prisma:seed
# 或
npm run db:seed
```

写入本地/staging 陪伴者、可登录 owner 与 staff phone 测试身份。陪伴者 owner 手机为 `13800000101`–`13800000105`。生产禁止 `SEED_ON_STARTUP=true`；正式陪伴者与 staff 必须通过受控运营流程预置，不能复用默认账号。审核后台员工凭据按 `docs/staff-operations.md` 初始化。

## 测试

```bash
cd backend/api
npm test                 # unit（src/**/*.spec.ts）
npm run test:preflight   # 部署配置检查器单元测试
npm run test:e2e         # HTTP 集成级 e2e（需 Postgres + Redis）
npm run test:integration # 同 test:e2e 别名
./scripts/acceptance-smoke.sh http://127.0.0.1:3000
cd ../..
backend/api/node_modules/.bin/tsc -p frontend/miniprogram/tsconfig.json --noEmit
node frontend/miniprogram/scripts/validate.mjs
node frontend/miniprogram/scripts/smoke.mjs
```

iOS：

```bash
xcodebuild test \
  -project frontend/ios/TalkAndTalk.xcodeproj \
  -scheme TalkAndTalk \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5' \
  -only-testing:TalkAndTalkTests
```

手工回归清单见 [docs/staging-acceptance.md](./docs/staging-acceptance.md)。

## 部署（Staging / Production）

填写环境文件后先运行不会输出密钥值的部署预检：

```bash
cd backend/api
npm run preflight:deployment -- .env.production
```

```bash
# Production
cp backend/api/.env.production.example backend/api/.env.production
# 填写密钥、数据库/Redis 密码，并把微信商户私钥放到配置的 host path 后：
docker compose -f infra/docker-compose.prod.yml --env-file backend/api/.env.production up -d --build

# Staging
cp backend/api/.env.staging.example backend/api/.env.staging
# DEPLOY_ENV_FILE 路径相对 infra/（compose 文件所在目录）
DEPLOY_ENV_FILE=../backend/api/.env.staging \
  docker compose -f infra/docker-compose.prod.yml --env-file backend/api/.env.staging up -d --build
```

- Nginx TLS 示例：`infra/nginx/talk-and-talk.conf.example`，证书目录 `infra/nginx/certs/`
- 回滚： [docs/deploy-rollback.md](./docs/deploy-rollback.md)
- 上线勾选： [docs/production-checklist.md](./docs/production-checklist.md)

## 备份

```bash
DATABASE_URL=postgres://... ./backend/api/scripts/db-backup.sh
```

建议 cron 每日执行，发布前再跑一次。恢复步骤见 deploy-rollback 文档。

## 微信支付

- 环境变量：`WECHAT_PAY_APP_ID`、`MCH_ID`、`API_V3_KEY`、`CERT_SERIAL_NO`、`NOTIFY_BASE_URL`，以及二选一的 `WECHAT_PAY_PRIVATE_KEY`（CloudBase 加密环境变量）/ `WECHAT_PAY_PRIVATE_KEY_PATH`（文件挂载）
- 流程：创建订单 → `POST /orders/:id/prepay` → 客户端调起微信 / mock → `POST /payments/wechat/notify` 或 staging `mock-notify`
- `APP_ENV=staging|development` 可用 mock 闭环；生产使用微信支付 API v3 真实预支付、平台证书验签、回调解密与退款，未完整配置时硬失败且不会回落 Mock
- 小程序：`POST /orders/:id/prepay` 提交 `{ "channel": "miniProgram" }`，服务端以当前微信 OpenID 创建 JSAPI 预支付，客户端再调用 `wx.requestPayment`。商户号需绑定小程序 AppID。

## 微信小程序

- 工程在 [`frontend/miniprogram`](./frontend/miniprogram)，使用微信开发者工具导入；发布准备见该目录 README。
- 小程序用 `wx.login` 取得短期 code，后端调用 code2Session 并建立独立的 `wechatMiniProgram` 身份；不保存 `session_key`，也不会自动合并 Apple/微信账户。
- 已支持两种正式传输：公网 HTTPS `wx.request`，或微信云托管 `wx.cloud.callContainer`；后者无需配置 request 合法域名，但公网入口仍供 iOS 和支付回调使用。
- 推荐部署与验收步骤见 [微信后端方案选型](./docs/wechat-backend-selection.md)。

## DeepSeek

- 本地与 staging 可在 `DEEPSEEK_API_KEY` 为空时仅运行 RuleEngine；生产强制真实文本审核提供方，运行时故障时聊天/社区转人工、公开资料写入返回可重试错误，绝不降级公开
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

- Auth：微信小程序登录、JWT、原子 refresh/logout、服务端法律同意与 18+ 门禁
- 陪伴者列表与详情、预约订单、微信 JSAPI 预支付/回调/退款/关单
- 支付后客户与陪伴者会话、服务端审核；Admin 审核 Web
- 通知、注销申请、同意撤回、日志脱敏、限流、helmet
- **不做**：复杂推荐、人脸实名、多支付渠道等 → [NEXT_PHASE.md](./NEXT_PHASE.md)
