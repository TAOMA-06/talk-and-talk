# Talk&Talk

女性友好的线上陪伴服务工程。**当前唯一发行范围是微信小程序 + NestJS 后端**；`frontend/ios` 仅保留为历史/后续工程，不参与本次商用放行。

- 新人请先读 [docs/GUIDE.md](./docs/GUIDE.md)
- 各文件夹/文件用途索引：[GUIDE.md](./GUIDE.md)
- **v0.1 已冻结 `/api/v1` 契约**：[shared/contracts](./shared/contracts)
- 当前工作树调查与外部门禁：[2026-08-26 商用闭环状态](./docs/cto-self-audit/runs/2026-08-26-commercial-closure/state.md)
- 最新官方市场交叉复审：[2026-08-26 修复后最终复审](./docs/commercial-market-cross-audit-2026-08-25.md)
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
├── GUIDE.md               # 目录与文件用途索引
├── README.md
└── NEXT_PHASE.md
```

| 路径 | 说明 |
|------|------|
| [GUIDE.md](./GUIDE.md) | 各文件夹与文件用途索引 |
| [docs/GUIDE.md](./docs/GUIDE.md) | 项目总指引 |
| [shared/contracts](./shared/contracts) | OpenAPI v1 冻结契约 |
| [docs/auth-api.md](./docs/auth-api.md) | Auth API 说明 |
| [docs/admin-moderation-api.md](./docs/admin-moderation-api.md) | 独立审核部门 API |
| [docs/review-department.md](./docs/review-department.md) | 审核部门边界、账号与上线操作 |
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

独立审核部门工作台：`http://localhost:3000/review/`（独立审核员用户名、密码和 TOTP；初始化见 `docs/review-department.md`）
法律页：`http://localhost:3000/legal/privacy.html`、`/legal/terms.html`（稳定入口会跳转到配置化的当前版本）
开发普通 phone 身份：`13800000001`（admin）、`13800000002`（moderator）；它们只用于用户/运营 API 测试，审核部门不使用短信登录。

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
| `AUTH_IDENTITY_TOMBSTONE_HMAC_KEYS` / `AUTH_IDENTITY_TOMBSTONE_ACTIVE_KEY_ID` | 注销身份防重绑 HMAC 密钥环与当前写入密钥；轮换时必须保留仍覆盖有效墓碑的旧密钥 | **必填、密钥管理托管** |
| `AUTH_IDENTITY_REREGISTRATION_POLICY` | 同一外部身份重新注册策略 | 固定 `after_tombstone_expiry` |
| `SMS_CODE_TTL_SECONDS` | 验证码 TTL，默认 `300` | |
| `SMS_PROVIDER` | `mock` / `none`（真实厂商见 NEXT_PHASE） | **禁止 mock**；`none` 则无短信登录 |
| `REVIEW_JWT_ACCESS_SECRET` / `REVIEW_JWT_REFRESH_SECRET` | 审核部门专属 JWT 密钥 | **必填、不得复用用户 JWT** |
| `REVIEW_TOTP_ENCRYPTION_KEY` | 加密审核部门 TOTP 种子 | **必填、不得复用运营 staff 密钥** |
| `STAFF_TOTP_ENCRYPTION_KEY` | 非审核运营 staff 的历史 TOTP 密钥 | 仅保留运营兼容能力 |
| `EXTERNAL_AI_USER_CONTENT_ENABLED` | 是否允许把用户原文交给外部生成式 AI；当前版本固定禁止 | **必须显式为 `false`** |
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

写入本地/staging 陪伴者、可登录 owner 与 staff phone 测试身份。陪伴者 owner 手机为 `13800000101`–`13800000105`。生产禁止 `SEED_ON_STARTUP=true`；正式陪伴者与 staff 必须通过受控运营流程预置，不能复用默认账号。审核部门凭据按 `docs/review-department.md` 初始化，不能复用用户或运营账号。

## 测试

```bash
cd backend/api
npm test                 # unit（src/**/*.spec.ts）
npm run test:preflight:static # 零跳过的本地部署配置/静态 preflight
# test:preflight 的 PostgreSQL 部分与 test:e2e/test:integration 只可由获授权、密封的 disposable runner 执行
./scripts/acceptance-smoke.sh http://127.0.0.1:3000
cd ../..
backend/api/node_modules/.bin/tsc -p frontend/miniprogram/tsconfig.json --noEmit
node frontend/miniprogram/scripts/validate.mjs
node frontend/miniprogram/scripts/smoke.mjs
```

`acceptance-smoke.sh` 仅支持 development/mock SMS/mock payment/local seed；不能作为
staging、真实微信、支付或 provider 的上线证据。外部动作必须按
[部署与回滚控制参考](./docs/deploy-rollback.md) 与 G2 执行包逐项授权。

当前 identity authority 门固定关闭时，local acceptance 只验证新订单/支付在写入前精确失败关闭并明确声明“不是商用验收”；下游交易状态机由隔离测试中的显式测试 adapter 覆盖。不得为了跑通脚本给生产代码增加身份绕过开关。

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

当前首发的 staging/production 部署、环境文件、数据库迁移、备份/恢复、DNS、
微信和支付动作都不是本 README 授权的操作。必须先有对应的逐项 Evidence ID、
冻结候选 SHA/不可变制品和保管证明、目标范围、有效期、执行人、结果收据与独立
复核。禁止从工作树或浮动 tag 使用 `--build` 重建制品。

部署预检可在获授权的受控环境中读取环境文件，但只应记录 vault/version 引用、
命令、时间、退出码和脱敏结果，绝不归档变量或密钥。详细边界见
[部署与回滚控制参考](./docs/deploy-rollback.md) 和
[G2 执行包](./docs/cto-self-audit/runs/2026-08-08-g1-remediation/g2-execution-package.md)。

- Nginx TLS 示例：`infra/nginx/talk-and-talk.conf.example`，证书目录 `infra/nginx/certs/`
- 回滚： [docs/deploy-rollback.md](./docs/deploy-rollback.md)
- 上线勾选： [docs/production-checklist.md](./docs/production-checklist.md)

## 备份

备份、恢复和保留期是外部数据操作，必须由独立授权记录绑定目标库、数据边界、
加密/保管位置、执行人、有效期、校验和和恢复复核。不得把数据库 URL 写入 shell
历史、Git、日志或文档。恢复步骤与回滚边界见
[deploy-rollback](./docs/deploy-rollback.md)。

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

## 内容安全与外部生成式 AI

- 当前所有环境只使用服务端本地规则与授权人工复核；用户原文、上下文、账号/订单标识和审核案件标识都不会发送给 DeepSeek 或其他外部生成式 AI。
- 生产与 staging 必须显式设置 `EXTERNAL_AI_USER_CONTENT_ENABLED=false`，并拒绝遗留 `DEEPSEEK_API_KEY`。高风险内容由本地规则失败关闭并进入人工/危机分流，不以外部模型故障为由降级公开。
- 未来如设计外部处理方，须先完成新版隐私文本、适用的 PIA/DPA、地域、留存、禁止训练和接收方审查；这不是填写一个 API key 即可开启的能力。

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
- 支付后客户与陪伴者会话、本地规则与独立人工复核；商业运营 `/admin/` 与独立审核 `/review/`
- 站内/微信事务通知、可约提醒安全流水线、注销申请与分阶段擦除、同意撤回、日志脱敏、限流和安全响应头
- 陪伴者自助入驻/服务/排班/收益工作台、可解释推荐与运营治理、订单级 TRTC 语音代码路径均已进入仓库；真实 KYC、微信模板、支付、TRTC 和运营值班仍是外部上线门禁
- **刻意不做**：临床诊疗、默认录音、礼物币/财富榜、付费认证/排名和无条件保险承诺；其他后续边界见 [NEXT_PHASE.md](./NEXT_PHASE.md)
