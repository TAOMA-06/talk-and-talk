# Talk&Talk 仓库文件索引

> 本文是**目录与文件用途索引**。产品红线、启动方式和改代码误区见 [docs/GUIDE.md](./docs/GUIDE.md)。未交付范围见 [NEXT_PHASE.md](./NEXT_PHASE.md)。

**当前发行范围：** 微信小程序（`frontend/miniprogram`）+ NestJS（`backend/api`）+ 冻结契约（`shared/contracts`）。
**不在本次放行：** `frontend/ios`（历史/后续）、`frontend/web` 延期交易面（官网营销页除外）。

---

## 怎么用这份索引

| 你想… | 去哪 |
|--------|------|
| 理解产品与协作规则 | [docs/GUIDE.md](./docs/GUIDE.md) |
| 按文件夹找具体文件 | 下文各节 |
| 按业务需求定位改哪里 | [按需求找文件](#按需求找文件) |
| 查 API 契约 | [shared/contracts](./shared/contracts) |
| 查放行/门禁 | [docs/COMMERCIAL_RELEASE.md](./docs/COMMERCIAL_RELEASE.md)、[docs/cto-self-audit](./docs/cto-self-audit) |

---

## 总目录

```text
talk-and-talk/
├── GUIDE.md                 # 本文件：目录/文件用途索引
├── README.md                # 仓库入口、快速开始、环境变量
├── NEXT_PHASE.md            # 明确不在本发行范围的后续项
├── frontend/
│   ├── miniprogram/         # 当前唯一商用客户端
│   ├── miniprogram-local/   # 本机联调生成副本（gitignore，勿上传）
│   ├── web/                 # 官网营销面；延期 Web App 生产关闭
│   └── ios/                 # 历史 SwiftUI App，不参与放行
├── backend/api/             # NestJS 权威后端
├── shared/contracts/        # OpenAPI v1 冻结契约
├── infra/                   # Compose、nginx、secrets、可观测性
├── docs/                    # 产品、运维、放行与审查文档
├── scripts/                 # 仓库级候选构建/证据脚本
└── .github/workflows/       # CI
```

| 路径 | 职责 |
|------|------|
| [README.md](./README.md) | 克隆后第一份说明：发行边界、本地启动、环境变量、migration/seed |
| [NEXT_PHASE.md](./NEXT_PHASE.md) | 外部门禁与刻意不做的能力清单 |
| [docs/GUIDE.md](./docs/GUIDE.md) | 产品是什么、红线、架构协作、常见误区 |
| [frontend/miniprogram](./frontend/miniprogram) | 用户/陪伴者微信小程序 |
| [backend/api](./backend/api) | `/api/v1`、`/admin/`、`/review/`、法律页 |
| [shared/contracts](./shared/contracts) | 前后端共同 OpenAPI |
| [infra](./infra) | 本地/生产编排与网关样例 |
| [frontend/web](./frontend/web) | 官网；交易面默认关闭 |
| [frontend/ios](./frontend/ios) | 历史 iOS，仅参考 |

---

## 1. 根目录文件

| 文件 | 用途 |
|------|------|
| `README.md` | 仓库主入口：结构、后端/小程序/iOS 启动、环境变量、migration、seed |
| `NEXT_PHASE.md` | 微信主体、TLS、真实身份 authority 等外部门禁；以及刻意延后的产品能力 |
| `GUIDE.md` | 本索引 |
| `.gitignore` | 忽略 `.env*`、密钥、`frontend/miniprogram-local/`、构建产物 |

---

## 2. `frontend/`

### 2.1 `frontend/miniprogram/` — 当前商用客户端

原生 TypeScript 微信小程序。页面一般由同名 `.ts`（逻辑）、`.wxml`（结构）、`.wxss`（样式）、`.json`（窗口/组件配置）组成，下表只列目录职责。

#### 工程根文件

| 文件 | 用途 |
|------|------|
| `README.md` | 本机副本联调、发行门禁、上线前配置 |
| `app.ts` | 小程序入口：初始化后端客户端与弱网恢复 |
| `app.json` | 页面注册、窗口、tabBar、权限声明 |
| `app.wxss` | 全局样式 |
| `project.config.json` | 微信开发者工具工程配置；发行门禁要求 production HTTPS 与 `urlCheck: true` |
| `sitemap.json` | 微信索引 sitemap |
| `package.json` / `package-lock.json` | 小程序 npm 依赖 |
| `tsconfig.json` | TypeScript 编译配置 |
| `typings/wechat.d.ts` | 微信 API 类型补充 |

#### `pages/` 页面

| 目录 | 用途 |
|------|------|
| `pages/consent/` | 首次法律同意与 18+ 门槛；同意前不登录、不打业务 API |
| `pages/legal/` | 用户协议 / 隐私政策 web-view 入口 |
| `pages/home/` | 首页：发现意图入口与推荐卡片 |
| `pages/discover/` | 陪伴者发现/筛选列表 |
| `pages/companion/detail` | 陪伴者详情：SKU、时段、下单入口 |
| `pages/companion/onboarding/` | 陪伴者自助入驻与补件 |
| `pages/companion/development/` | 陪伴者训练 / 复审 |
| `pages/companion/services/` | 陪伴者商品（SKU）管理 |
| `pages/companion/availability/` | 可约容量 / 时段 |
| `pages/companion/schedule/` | 排班 |
| `pages/companion/workbench/` | 陪伴者今日任务与接单工作台 |
| `pages/companion/earnings/` | 收益 / 结算查看 |
| `pages/companion/safety/` | 陪伴者限制申诉与安全相关入口 |
| `pages/orders/` | 订单列表 |
| `pages/order/detail` | 单笔订单履约、聊天入口、状态 |
| `pages/order/payment` | JSAPI 支付调起与回刷 |
| `pages/order/aftercare` | 订单售后 / 体验反馈 |
| `pages/order/dispute` | 出席争议 |
| `pages/messages/` | 会话列表 |
| `pages/chat/` | 订单内聊天（文本/媒体，审核以服务端为准） |
| `pages/voice/` | 订单级语音房（TRTC；控制台审批仍属外部门禁） |
| `pages/community/` | 广场动态 |
| `pages/profile/` | 个人资料 |
| `pages/account/` | 账号、注销、数据权利 |
| `pages/account/adult-eligibility` | 成年资格恢复 |
| `pages/account/deletion-status` | 注销进度 |
| `pages/notifications/` | 站内通知 |
| `pages/safety/` | 用户安全中心 / 举报结果回执 |
| `pages/support/` | 客服工单列表 |
| `pages/support/detail` | 工单详情 |
| `pages/crisis/` | 危机资源页（不承诺平台救援） |

#### `utils/`

| 文件 | 用途 |
|------|------|
| `config.ts` | API 基址、云托管、协议页地址；**发行门禁保护，勿改成 HTTP** |
| `api.ts` | 统一 `wx.request` / `callContainer`、鉴权信封、弱网重试 |
| `models.ts` | 前端领域模型与枚举 |
| `catalog.ts` | 主题/商品展示目录辅助 |
| `recommendations.ts` | 推荐卡片解释与展示 |
| `companion-commercial-api.ts` | 陪伴者入驻、商品、排班、收益、申诉 API |
| `attendance-disputes-api.ts` | 出席争议 API |
| `controlled-evidence.ts` | 受控案件证据上传预约/完成 |
| `order-display.ts` | 订单状态文案与展示规则 |
| `payment-dispute-display.ts` | 支付投诉展示 |
| `public-interaction-errors.ts` | 公开互动错误码 → 用户可读文案 |
| `privacy.ts` | 隐私授权与同意状态 |
| `crisis-gate.ts` | 危机话术门禁（引导官方资源，不充当救援） |
| `adult-eligibility-recovery.ts` | 成年资格恢复流程 |
| `notification-router.ts` | 通知点击跳转 |
| `subscription.ts` | 微信一次性订阅消息授权 |
| `sha256.ts` | 客户端哈希工具（非密钥） |

#### `scripts/`

| 文件 | 用途 |
|------|------|
| `create-local-copy.mjs` | 生成 `frontend/miniprogram-local` 本机/staging 联调副本 |
| `validate.mjs` | 页面注册、协议门槛、HTTPS、密钥泄露等结构门禁 |
| `smoke.mjs` | 编译后页面加载与登录/下单/支付分支冒烟 |
| `test-local-build.mjs` | 验证副本隔离且不会污染正式源目录 |

`frontend/miniprogram-local/` 由上述脚本生成，**已 gitignore**。只用于开发者工具联调，禁止上传体验版。

---

### 2.2 `frontend/web/` — 官网（交易面生产关闭）

| 路径 | 用途 |
|------|------|
| `README.md` | 官网责任面、surface policy、本地运行与 `npm run check` |
| `app/layout.tsx` | 根布局 |
| `app/page.tsx` | 营销首页 |
| `app/how-it-works/page.tsx` | 产品如何工作 |
| `app/safety/page.tsx` | 安全与公示 |
| `app/about/page.tsx` | 关于 |
| `app/partners/page.tsx` | 合作伙伴 |
| `app/robots.ts` / `app/sitemap.ts` | SEO；不能当作交易面开关 |
| `app/business/` `app/demo/` | 私密延期页；生产 404 |
| `app/discover/` `login/` `community/` `orders/` `messages/` `profile/` `workbench/` `companions/` | 延期 Web App 路由；生产 fail-closed |
| `app/api/session/*` `app/api/backend/*` | 仅隔离开发 BFF |
| `components/*Screen.tsx` | 各路由对应 UI |
| `components/MarketingHomeScreen.tsx` | 官网首页 |
| `components/MiniprogramCta.tsx` | 导流到微信小程序 |
| `components/motion/` | 官网动效（尊重 reduced motion） |
| `lib/web-surface-policy.ts` | 生产关闭延期面的权威策略 |
| `lib/enforce-web-surface.ts` | 运行时强制执行 surface policy |
| `lib/miniprogram-entry.ts` | 小程序入口 URL allowlist |
| `lib/api-client.ts` / `lib/server-api.ts` | 延期面 API 客户端（非生产路径） |
| `worker/index.ts` | Cloudflare Worker 入口 |
| `vite.config.ts` | Vinext/Vite 构建 |
| `tests/web-surface-policy.test.mjs` | 生产即使注入 open 开关也必须拒绝延期面 |
| `tests/rendered-html.test.mjs` | 构建产物 HTML 断言 |
| `tests/miniprogram-entry.test.mjs` | 小程序 CTA 协议校验 |
| `tests/worker-image-runtime.test.mjs` | Worker 运行时 |
| `tests/live-backend-integration.mjs` | 隔离开发联调（显式打开延期面） |

`examples/`、`db/`、`drizzle/` 是隔离实验/BFF 残留，**不是**官网放行证据。

---

### 2.3 `frontend/ios/` — 历史 SwiftUI App（不参与放行）

XcodeGen 工程。`project.yml` 生成 `TalkAndTalk.xcodeproj`。Debug 默认可开 `FRONTEND_DEMO_MODE` 做空状态演示，不注入虚假供给。

#### 工程与配置

| 文件 | 用途 |
|------|------|
| `project.yml` | XcodeGen 源：target、scheme、微信 SDK、Info.plist 键 |
| `TalkAndTalk.xcodeproj/` | 生成的 Xcode 工程（改 `project.yml` 后需 `xcodegen generate`） |
| `TalkAndTalk.entitlements` | Keychain、Associated Domains 等能力 |
| `Config/Shared.xcconfig` | 公共构建项；TestFlight 前填 `WECHAT_APP_ID` 与 Team |
| `Config/Debug.xcconfig` | Debug：本机 API、演示模式默认开 |
| `Config/Staging.xcconfig` | Staging 后端地址 |
| `Config/Release.xcconfig` | 生产 `https://api.talkandtalk.app` |
| `Resources/Info-Supplement.plist` | 补充 Info.plist（URL scheme、隐私文案） |
| `Resources/LaunchScreen.storyboard` | 启动屏 |
| `Resources/PrivacyInfo.xcprivacy` | Apple 隐私清单 |
| `Resources/Assets.xcassets/` | App 图标 |
| `Scripts/check_release_artifact.sh` | Release 产物禁止混入 Demo/Mock 姓名 |

#### `Sources/App/` — 入口与全局状态

| 文件 | 用途 |
|------|------|
| `TalkAndTalkApp.swift` | `@main`：装配 AuthSession、AppStore、微信回调 |
| `ContentView.swift` | 登录后五 Tab + 路由表（发现/广场/订单/消息/我的） |
| `AppStore.swift` | 客户端权威状态：用户、订单、消息、审核反馈、后端刷新 |

#### `Sources/Core/` — 模型、目录、设计系统

| 文件 | 用途 |
|------|------|
| `Catalog/AppCatalog.swift` | 主题目录与空用户占位（非后端种子供给） |
| `Catalog/FrontendDemoMode.swift` | Debug 离线演示开关解析 |
| `Models/Models.swift` | 领域模型：用户、陪伴者、订单、消息、审核决定等 |
| `Models/FrontendDemoIdentity.swift` | 演示身份（仅 DEBUG） |
| `UI/DesignSystem.swift` | 颜色、间距、按钮等设计 token |
| `UI/SharedViews.swift` | 跨页面共用视图（卡片、法律文档、空状态壳） |
| `UI/MarketplaceUIHelpers.swift` | 首页排序、列表筛选、市场空状态文案（冷启动不造假供给） |

#### `Sources/Data/` — 网络、登录、支付、审核

| 文件 | 用途 |
|------|------|
| `API/BackendConfig.swift` | 环境基址、功能开关（聊天是否走后端） |
| `API/BackendClient.swift` | `/api/v1` HTTP 客户端 |
| `API/BackendAuthClient.swift` | 登录/刷新专用客户端 |
| `API/BackendDTO.swift` | 响应 DTO 与领域模型映射 |
| `Auth/AuthSession.swift` | 登录态状态机 |
| `Auth/TokenStore.swift` | Keychain 存取 access/refresh |
| `Auth/AuthDTO.swift` | 登录请求/响应 DTO |
| `Payments/WeChatPayCoordinator.swift` | 微信 SDK 注册与回跳 |
| `Payments/WeChatPayClient.swift` | 调起微信支付 |
| `Moderation/ModerationService.swift` | 审核服务协议 |
| `Moderation/LocalModerationService.swift` | DEBUG 本地审核适配 |
| `Moderation/RuleBasedModerationEngine.swift` | 本地规则引擎（正式审核以服务端为准） |
| `Services/CreditService.swift` | 信用分/限制推导（客户端展示，服务端仍是权威） |

#### `Sources/Features/` — 界面

| 文件 | 用途 |
|------|------|
| `Auth/LoginView.swift` | 登录页 |
| `Auth/AppleSignInCoordinator.swift` | Sign in with Apple（小程序首发不使用） |
| `Discover/HomeView.swift` | 发现首页 |
| `Discover/CompanionListView.swift` | 陪伴者列表 |
| `Discover/CompanionDetailView.swift` | 陪伴者详情 |
| `Discover/CompanionHomepageView.swift` | 陪伴者主页 |
| `Discover/ReviewView.swift` | 评价页 |
| `Community/CommunityView.swift` | 广场 |
| `Orders/OrdersView.swift` | 订单列表 |
| `Orders/OrderView.swift` | 下单/订单详情 |
| `Messages/MessagesView.swift` | 会话列表 |
| `Messages/ChatView.swift` | 聊天 |
| `Profile/ProfileView.swift` | 我的 |
| `Profile/SettingsView.swift` | 设置 |
| `Profile/NotificationsView.swift` | 通知 |
| `Safety/SafetyCenterView.swift` | 安全中心 |
| `Safety/VerifyView.swift` | 实名/核验页 |

#### 测试

| 文件 | 用途 |
|------|------|
| `Tests/MarketplaceUIHelpersTests.swift` | 首页排序与空状态文案（不造假 CTA） |
| `Tests/AuthSessionTests.swift` | 登录态 |
| `Tests/TokenStoreTests.swift` | Keychain token |
| `Tests/BackendClientTests.swift` | API client |
| `Tests/LoginStateTests.swift` | 登录 UI 状态 |
| `Tests/ModerationTests.swift` | 本地审核与信用 |
| `UITests/TalkAndTalkUITests.swift` | UI 冒烟 |

---

## 3. `backend/api/` — NestJS 权威后端

公开前缀固定 `api/v1`。JSON 一律走 `data` / `error` + `meta` 信封。同目录 `*.spec.ts` 是单元测试，下文不逐条列出。

### 3.1 工程根

| 文件 | 用途 |
|------|------|
| `README.md` | 本地开发、信封格式、Prisma、Docker、staff/review bootstrap |
| `package.json` | npm scripts：`start:dev`、`test`、`test:e2e`、`prisma:*`、bootstrap |
| `prisma.config.ts` | Prisma 配置 |
| `tsconfig.json` / `tsconfig.build.json` | 编译 |
| `jest.config.js` | 单元测试 |
| `Dockerfile` / `docker-entrypoint.sh` | 镜像；启动前 `prisma migrate deploy` |
| `.env.example` / `.env.staging.example` / `.env.production.example` | 环境变量模板（真实 `.env` 不入库） |
| `src/main.ts` | 进程入口：helmet、CORS、信封、校验、静态资源、shutdown |
| `src/app.module.ts` | 根模块组装 |

### 3.2 `src/` 业务模块

每个模块通常含 `*.module.ts`（装配）、`*.controller.ts`（HTTP）、`*.service.ts`（业务）、`dto/`（入参校验）。

| 目录 | 用途 |
|------|------|
| `config/` | `configuration.ts` 环境解析；`cors.ts`；`commercial-surface.ts` 商用面开关；`first-release-capability-matrix.ts` 首发能力矩阵 |
| `database/` | Prisma 连接；`seed.ts`；运营/审核 staff 引导 |
| `health/` | `/health` 存活、`/health/ready` 依赖就绪 |
| `metrics/` | 鉴权后的 Prometheus 指标 |
| `auth/` | 微信小程序登录、短信（生产 `none`）、JWT、staff 登录、身份墓碑防重绑 |
| `users/` | 当前用户、资料、法律同意、成年资格、注销执行 worker、公开互动身份门禁 |
| `account-governance/` | 数据导出、发票、账号申诉、治理工单（用户侧 + admin） |
| `companions/` | 陪伴者资料、商品 SKU、排班规则、可约窗口、周期草稿物化 |
| `recommendations/` | 可解释推荐与运营位（admin 控制器在同模块） |
| `favorites/` | 收藏与可约提醒流水线（candidate → 预约 → 投递 → 终态） |
| `orders/` | 下单、接单、改期过期 worker、退款申请、履约时间线、体验反馈 |
| `payments/` | 预支付、微信回调、退款审核、支付投诉、日对账 worker、账单解析 |
| `commercial/` | 陪伴者商业档案、生命周期、结算/追偿、漏斗、动作过期 worker |
| `conversations/` | 会话、消息、媒体直传预约、屏蔽、通知偏好、未来预约边界 |
| `community/` | 广场动态与用户举报（只回执，不泄漏案件） |
| `reviews/` | 订单评价（注意与 `review/` 审核部门区分） |
| `moderation/` | 内容安全：RuleEngine、案件、聊天限制；`ai/` 外部模型接口（生产禁止传用户原文）；`media/` 媒体资产与受控证据 |
| `review/` | **独立审核部门**：独立 JWT/TOTP、队列、处置、标注导出、审核员停用 |
| `admin/` | 运营后台 API：账号状态、身份核验复核、staff 离职、商用与对账入口 |
| `support/` | 用户建单 + 运营处理、事实、退款发起 |
| `attendance-disputes/` | 出席争议 |
| `notifications/` | 站内通知 + 微信订阅消息投递 worker |
| `crisis-intervention/` | 危机资源/记录（不替代官方救援） |
| `legal/` | 协议版本、法律页、留存 worker、legal hold |
| `voice/` | 订单语音房控制与关房 worker |
| `common/` | 信封、错误、审计、限流、脱敏日志、有界擦除、注销/履约/申诉策略、敏感文本校验 |

`auth/` 内关键文件：`auth.controller.ts` / `auth.service.ts` 登录主路径；`auth-identity-tombstone.service.ts` 注销后防重绑；`guards/` JWT 与角色；`sms/` mock 与 disabled provider。

`payments/wechat/`：`real-wechat-pay.provider.ts` 生产；`mock-wechat-pay.provider.ts` 仅 development；`disabled-wechat-pay.provider.ts` 未配置时 fail-closed。

### 3.3 `prisma/`

| 路径 | 用途 |
|------|------|
| `schema.prisma` | 数据模型唯一源 |
| `migrations/` | 已提交的顺序 SQL（约百余条）；生产只 `migrate deploy`，不要改已应用文件 |

### 3.4 `public/` 静态工作台与法律页

| 路径 | 用途 |
|------|------|
| `public/admin/index.html` + `assets/` | 运营后台 SPA（账号、订单、商用、对账） |
| `public/review/index.html` + `assets/` | 独立审核工作台（与用户 JWT 隔离） |
| `public/legal/privacy.html` `terms.html` | 隐私政策与用户协议 HTML；稳定入口会跳到当前版本 |

### 3.5 `scripts/` 与 `test/`

`scripts/` 里 `*.mjs` / `*.sh` 是门禁与运维入口；同名 `*.test.mjs` 锁住脚本契约。

| 脚本（非测试） | 用途 |
|----------------|------|
| `acceptance-smoke.sh` | 开发/mock 冒烟，**不能**证明 staging/真实支付 |
| `production-smoke.sh` | 生产只读冒烟 |
| `deployment-preflight.mjs` | 部署前配置检查 |
| `verify-production-artifacts.mjs` | 产物不含 seed/mock 泄漏 |
| `run-isolated-e2e.mjs` | 一次性 disposable Postgres 上跑 e2e |
| `run-migration-compatibility.mjs` | migration 前向兼容 |
| `isolated-postgres-preflight-environment.mjs` | 隔离库环境断言 |
| `assert-disposable-e2e-environment.cjs` | 禁止打到默认/生产库 |
| `e2e-teardown-guard.cjs` / `e2e-target-ownership.cjs` | e2e 所有权与拆除保护 |
| `db-backup.sh` | 备份辅助 |
| `generate-totp-secret.mjs` | staff/review TOTP |
| `copy-public-assets.mjs` | 构建时拷贝 `public/` |
| `voice-release-artifacts.mjs` | 语音发行产物检查 |
| `validate-cloudbase-template.mjs` | 云托管模板校验 |

`test/*.e2e-spec.ts`：HTTP 级 e2e（auth、订单支付、会话、审核、法律同意等）。`test/setup-e2e.ts` 与 fixture 只服务这些测试。

`config/transactional-template-manifest.js`：微信订阅消息模板清单。

---

## 4. `shared/contracts/`

| 文件 | 用途 |
|------|------|
| `README.md` | v1 冻结规则、信封、允许/禁止的变更 |
| `openapi/v1.yaml` | 用户/陪伴者/运营 `/api/v1` 契约 |
| `openapi/review-v1.yaml` | 审核部门独立契约 |

改行为时必须同步 OpenAPI 与对应 `docs/*-api.md`。破坏性变更需要新前缀或书面批准。

---

## 5. `infra/`

| 路径 | 用途 |
|------|------|
| `docker-compose.yml` | 本地 API + Postgres + Redis |
| `docker-compose.prod.yml` | 生产编排样例（`DEPLOY_ENV_FILE`） |
| `docker-compose.e2e.yml` | e2e 一次性依赖 |
| `docker-compose.migration-compatibility.yml` | migration 兼容性作业 |
| `nginx/talk-and-talk.conf.example` | TLS 反代样例（admin/review 访问控制） |
| `nginx/assert-commercial-surface.mjs` | 核对网关暴露面 |
| `observability/alertmanager-payment-rules.sample.yml` | 支付告警样例 |
| `cloudbase/cloudbaserc.voice-ready.template.json` | 微信云托管语音就绪模板 |
| `secrets/README.md` | 商户私钥如何挂载（真密钥不入库） |
| `secrets/mock-private-key.txt` | **仅本地 mock**，不是生产密钥 |

---

## 6. `docs/`

| 文件 | 用途 |
|------|------|
| `GUIDE.md` | 产品与协作总指引 |
| `COMMERCIAL_RELEASE.md` | 商用交易模型、代码控制、外部 P0、放行流程 |
| `commercial-interface-closure.md` | 商用接口闭环证据 |
| `core-tolerance-and-expansion-matrix.md` | 核心宽容度、硬边界、放量规则 |
| `production-checklist.md` | 生产检查清单 |
| `staging-acceptance.md` | Staging 与小程序联调 |
| `deploy-rollback.md` | 部署与回滚（含 G2 授权要求） |
| `auth-api.md` | Auth 人读说明 |
| `admin-moderation-api.md` | 运营审核 API |
| `review-department.md` | 审核部门边界、账号、TOTP、上线操作 |
| `staff-operations.md` | 运营 staff 日常操作 |
| `chat-moderation-v2.md` | 聊天审核流水线 |
| `companion-recommendation-v1.md` | 推荐 v1 |
| `backend-migration.md` | 路由清单与迁移说明 |
| `wechat-backend-selection.md` | 微信后端/云托管选型 |
| `app-store-metadata.md` | 历史 iOS App Store 元数据 |
| `miniprogram-release-readiness-report.md` | 小程序发行就绪报告 |
| `miniprogram-verification.md` | 历史双端验证记录（非当前证据） |
| `realtime-voice-release-checklist.md` | 语音发行清单 |
| `release-readiness-report.md` | 发行就绪总报告 |
| `gate-results.md` | 门禁结果记录 |
| `product-gap-roadmap.md` | 产品缺口路线 |
| `marketization-adjustment-plan.md` | 市场化调整 |
| `NEXT_CODEX.md` | 给后续 AI/协作者的交接 |
| `runbooks/backup-restore.md` | 备份恢复 |
| `runbooks/migration-release-job.md` | migration 发布作业 |
| `commercial-market-cross-audit-*.md` | 市场交叉复审快照（以最新日期为准） |
| `cto-self-audit/` | CTO 可重复审查控制目录，见下 |

### `docs/cto-self-audit/`

长期审查方法，不替代当次工作树证据。最新执行包：[2026-08-26 商用闭环](./docs/cto-self-audit/runs/2026-08-26-commercial-closure/state.md)。

| 路径 | 用途 |
|------|------|
| `README.md` | 目录说明与范围 |
| `00`–`10` 编号文档 | 方法、对标、产品、架构、安全、资金、信任安全、SRE、合规、治理、长任务 |
| `registers/` | 控制项、风险、决策、当轮评估 |
| `templates/` | 审查 run / 证据 / 长任务状态模板 |
| `evidence/` | 证据包结构（敏感原件不进 Git） |
| `runs/` | 各次执行包（scope、state、validation、handoff） |

---

## 7. `scripts/`（仓库根，候选控制面）

与 `backend/api/scripts` 不同：这里锁的是 **G1/G2 候选身份、SBOM、OCI 保管、浏览器证据卡片**。

| 文件 | 用途 |
|------|------|
| `prepare-g1-candidate-runtime.sh` | 准备 G1 候选运行时 |
| `verify-ci-candidate-identity.mjs` | CI 候选身份校验 |
| `candidate-input-policy.mjs` | 候选输入允许/拒绝 |
| `candidate-source-tree.mjs` | 候选源树清单 |
| `candidate-evidence.mjs` | 证据打包 |
| `generate-candidate-sbom.mjs` | SBOM |
| `oci-builder-custody-contract.mjs` | OCI 构建保管契约 |
| `g2-browser-evidence-card-contract.mjs` | G2 浏览器证据卡片契约 |
| 各 `*.test.mjs` | 锁住上述脚本行为 |

---

## 8. `.github/`

| 文件 | 用途 |
|------|------|
| `workflows/api.yml` | 后端构建、单测、静态 preflight、产物门禁 |
| `workflows/miniprogram.yml` | 小程序 validate / tsc / smoke |
| `workflows/web.yml` | 官网 `npm run check` |
| `workflows/ios.yml` | 历史 iOS 构建（不作为当前放行） |
| `workflows/g1-candidate.yml` | G1 候选流水线 |
| `workflows/g1-candidate-control-plane.yml` | G1 控制面 |
| `dependabot.yml` | 依赖更新 |

CI 绿灯 **不能**替代微信真机上传、真实支付回调或外部资质签字。

---

## 按需求找文件

| 需求 | 优先位置 |
|------|----------|
| 微信登录 | `backend/api/src/auth` · 小程序 `utils/api.ts` · `pages/consent` |
| 发现/推荐 | `backend/api/src/recommendations` · `companions` · 小程序 `pages/home` `pages/discover` |
| 下单/容量 | `backend/api/src/orders` · `companions` · 小程序 `pages/companion/detail` `pages/order` |
| JSAPI 支付/退款/对账 | `backend/api/src/payments` · 小程序 `pages/order/payment` |
| 陪伴者入驻/商品/排班/收益 | `backend/api/src/commercial` · `companions` · 小程序 `pages/companion/*` |
| 聊天与内容审核 | `conversations` · `moderation` · 小程序 `pages/chat` |
| 独立审核工作台 | `backend/api/src/review` · `public/review` · `docs/review-department.md` |
| 运营后台 | `backend/api/src/admin` · `public/admin` |
| 注销/擦除/legal hold | `users` · `account-governance` · `legal` · `common/privacy` |
| 法律页 | `public/legal` · `src/legal` · 小程序 `pages/legal` |
| OpenAPI | `shared/contracts/openapi/v1.yaml` |
| 本地联调小程序 | `frontend/miniprogram/scripts/create-local-copy.mjs` |
| 官网文案/导流 | `frontend/web/app` · `components/*Screen.tsx` |
| iOS（仅参考） | `frontend/ios/Sources` |
| 部署 | `infra/` · `docs/deploy-rollback.md` · `backend/api/scripts/deployment-preflight.mjs` |

---

## 不要在这些地方找权威答案

| 误区 | 权威在哪 |
|------|----------|
| iOS 页面在，所以能力已首发 | 以小程序 + NestJS + OpenAPI 为准 |
| 官网延期路由能打开 | 生产 surface policy 关闭；不能当交易证据 |
| `miniprogram-local` 可上传 | 只能联调；上传必须用 `frontend/miniprogram` |
| `acceptance-smoke.sh` 过了就能上 staging | 该脚本只覆盖 development/mock |
| 改已应用的 prisma migration | 只能新增 migration |
| 把用户原文交给 DeepSeek | 当前版本全环境禁止 |
