# Talk&Talk 发行审查报告

| 字段 | 值 |
|------|-----|
| 审查日期 | 2026-07-09 |
| 审查范围 | 仓库静态审查 + 本机可执行质量门禁 |
| Git | `main`（工作区干净快照起点；本报告为新增文档） |
| 口径 | 生产级 Critical Gate；结论拆三档 |
| 范围约定 | 只审查与报告；未改业务代码、未提交密钥 |

---

## 1. 总结判定

### 总判定：**Conditional Go**

工程已具备 **v0.1 / staging 演示闭环** 与 **TestFlight 提交准备度（配置补齐后）** 的骨架；**不可**作为「完整商业 production」上线（真实收款、生产级登录与支付安全硬化未完成）。

| 档位 | 结论 | 一句话 |
|------|------|--------|
| **v0.1 / staging** | **Conditional Go** | 契约、mock 支付/SMS、审核与文档闭环完整；本机 unit/build/iOS 单测通过。**须在有 Postgres+Redis 的环境补跑 e2e + smoke 后升为 Go。** |
| **TestFlight** | **Conditional Go** | Release URL / DEBUG 隔离 / 单元测试到位；**Team、`WECHAT_APP_ID`、staging 后端可达、Archive 签名** 为提交前 Critical 配置项。 |
| **完整商业 production** | **No-Go** | 真实微信预支付为壳、生产可回落 Mock 支付、真实短信未实现、metrics/admin 网络隔离与 compose 默认 SEED 等运维硬化不足。 |

---

## 2. 范围与发行定义

对照 `README.md`、`NEXT_PHASE.md`、`docs/production-checklist.md`、`docs/staging-acceptance.md`。

| 能力 | v0.1 范围 | TestFlight | 商业 production | 是否阻塞商业发行 |
|------|-----------|------------|-----------------|------------------|
| `/api/v1` 契约冻结 | ✅ | ✅ | ✅ | — |
| 手机 mock 登录 | ✅ | ✅（staging） | ❌ 生产禁 mock | 是（或书面「仅 Apple」） |
| 真实短信 | ❌ NEXT_PHASE | 非必须 | 需要（或仅 Apple） | **Blocker / 策略 Critical** |
| Apple 登录 | ✅ | ✅ | ✅（需配置） | 配置项 |
| 订单 + mock 支付 | ✅ | ✅ | ❌ | **Blocker** |
| 真实微信收款 | ❌ NEXT_PHASE | 非必须 | 必须 | **Blocker** |
| 聊天审核 c1–c3 + Admin | ✅ | ✅ | ✅ + 网络隔离 | Critical（暴露面） |
| 应用内通知 | ✅ | ✅ | ✅ | — |
| APNs 推送 | ❌ | 非必须 | 建议 | Major |
| 完整社区 / 评价服务端 | ❌ | 非必须 | 建议 | Major |
| CI | ❌ | 非必须 | 强烈建议 | Major |
| 部署/回滚/备份文档 | ✅ | ✅ | ✅ + 演练 | Critical 若未演练 |
| 人脸/实名核验 | 本地 UX only | 同左 | 非公安核身 | Major（合规视场景） |

**明确非 v0.1 阻塞项（文档已声明）：** 真实短信、真实微信完整预支付、CI、监控鉴权 hardening、完整社区、APNs、UITests 全量。

**明确商业 production 阻塞项：** 真实收款闭环、生产支付不可伪造、可用登录策略（真实 SMS 或书面仅 Apple）、生产配置/暴露面硬化。

---

## 3. 阻塞项与问题清单（按严重级）

### Blocker

#### B1. 真实微信支付未实现

| | |
|--|--|
| **影响** | 配置齐全仍无法真实预支付/验签回调；商业不可收款。 |
| **证据** | `backend/api/src/payments/wechat/real-wechat-pay.provider.ts`：`createAppPrepay` 抛 `WECHAT_PAY_NOT_IMPLEMENTED`；`verifyNotifySignature` 结构占位后 **恒 `return false`**；资源解密未接 `apiV3Key`。`NEXT_PHASE.md` / `docs/production-checklist.md` 已承认。 |
| **修复建议** | 实现微信 App 下单 HTTP 客户端、平台证书拉取与验签、回调解密；集成测试用沙箱；失败勿静默回 mock。 |

#### B2. 生产未配微信时回落 Mock 提供商（支付伪造面）

| | |
|--|--|
| **影响** | `NODE_ENV=production` 且微信字段不全时使用 `MockWeChatPayProvider`；官方 notify 路径在 Mock 下接受弱签名（`MOCK_OK` / mock token），可能伪造支付成功。`mock-notify` 虽在 `APP_ENV=production` 403，**不能覆盖** `/payments/wechat/notify`。 |
| **证据** | `payments.module.ts` 工厂；`mock-wechat-pay.provider.ts` `verifyNotifySignature`；`payments.service.ts` 仅 `mockNotify` 检查 `APP_ENV`。单元测试用 `wechatpay-signature: MOCK_OK` 完成履约（`payments.service.spec.ts`）。 |
| **修复建议** | production 下：未完整配置微信则 **拒绝 prepay**（503），**禁止** 选择 Mock；Real 验签未就绪前勿对公网开放 notify。 |

#### B3. 真实短信未实现；生产手机号登录实质不可用

| | |
|--|--|
| **影响** | 生产禁止 `SMS_PROVIDER=mock`；实现仅 `mock`/`none` 且均落到 `MockSmsProvider`（只打脱敏日志）。生产不返回 `devCode` → 用户收不到验证码。商业「手机号登录」不可用。 |
| **证据** | `auth/sms/sms.module.ts`；`configuration.ts` 生产拒 mock；`auth.service.ts` 仅非 production + mock 返回 `devCode`。 |
| **修复建议** | 接入阿里云/腾讯 SMS；或 **产品书面策略：production 仅 Apple 登录**，并在 App 隐藏/降级手机登录。未二选一前视为商业 Blocker。 |

---

### Critical

#### C1. `infra/docker-compose.prod.yml` 默认 `SEED_ON_STARTUP=true`

| | |
|--|--|
| **影响** | `environment: SEED_ON_STARTUP: ${SEED_ON_STARTUP:-true}` 在宿主机未 export 变量时覆盖 `.env.production` 中的 `false`，生产可能反复 seed、默认 staff 手机号残留。 |
| **证据** | `infra/docker-compose.prod.yml` L20–21 vs `backend/api/.env.production.example` `SEED_ON_STARTUP=false`。 |
| **修复建议** | 默认改为 `false`；仅 staging 显式 true；首次上线 runbook 单独 seed。 |

#### C2. Metrics / Admin 无网络层隔离

| | |
|--|--|
| **影响** | `GET /api/v1/metrics` 无鉴权；nginx 示例全量反代 `/`，metrics 与 `/admin/` Web 可对公网。Admin **API** 有 JWT+Roles，但 UI 与指标仍暴露。 |
| **证据** | `metrics.controller.ts`；`infra/nginx/talk-and-talk.conf.example`；`docs/production-checklist.md` 要求内网。 |
| **修复建议** | nginx 对 `/api/v1/metrics`、`/admin/` 限制内网/VPN 或 basic auth；或应用层 token。 |

#### C3. Redis 无默认密码；微信私钥未挂载

| | |
|--|--|
| **影响** | 生产 compose 注释要求手工 `requirepass`；私钥路径示例有、volume 无。依赖部署者自觉。 |
| **证据** | `infra/docker-compose.prod.yml` redis 段注释；`.env.production.example` `WECHAT_PAY_PRIVATE_KEY_PATH`。 |
| **修复建议** | compose 强制 redis 密码与 `REDIS_URL` 一致；secrets volume 模板化。 |

#### C4. iOS 发行配置未填

| | |
|--|--|
| **影响** | TestFlight/真机微信无法完成；Archive 需 Team。 |
| **证据** | `frontend/ios/Config/Shared.xcconfig`：`WECHAT_APP_ID` 空；`DEVELOPMENT_TEAM` 注释。Debug Info.plist 实测 `WECHAT_APP_ID=""`，`BACKEND_BASE_URL=http://127.0.0.1:3000`。 |
| **修复建议** | 提交前填 Team + 微信 AppID；Staging 构建指向 `api-staging`（`Staging.xcconfig` 已有 URL，但 `project.yml` 未挂 Staging 配置）。 |

#### C5. 依赖漏洞（npm audit）

| | |
|--|--|
| **影响** | 生产依赖树报告 **13** 条（10 moderate / 3 high：lodash、multer 等，多经 Nest/Prisma 传递）。 |
| **证据** | 本机 `npm audit --omit=dev` exit 1（2026-07-09）。 |
| **修复建议** | 评估升级 `@nestjs/*` / prisma 大版本或 `npm audit fix`（avoid 盲目 `--force`）；商业上线前再扫。 |

---

### Major

| ID | 问题 | 影响 | 证据 | 建议 |
|----|------|------|------|------|
| M1 | 无 CI | 回归靠人工 | 无 `.github/` | 加 Actions：api test + iOS test |
| M2 | 无 APNs | 仅应用内通知 | `NEXT_PHASE.md` | 商业运营前规划 |
| M3 | 社区/评价未服务端契约 | 产品不完整 | GUIDE / NEXT_PHASE | 排期 |
| M4 | UITests 未进门禁 | 手工回归成本 | staging-acceptance | 对齐登录门控后纳入 |
| M5 | `docs/review.md` STALE | 易误导 | 文件头声明 | 归档或删除链接 |
| M6 | e2e/smoke 本机未跑通 | v0.1 不能完全 Go | 无 Postgres/Redis/Docker | 在有依赖环境补跑 |
| M7 | 证书目录缺失 | 无法按示例起 TLS | `infra/nginx/certs` 不存在 | 部署时 ACME/自签 |

### Minor

| ID | 问题 | 建议 |
|----|------|------|
| m1 | `TalkAndTalk 2.xcodeproj` 并存 | 文档已警告；可移入 archive |
| m2 | Staging.xcconfig 未进 project.yml | 增加 Staging 配置或文档说明用 Scheme 覆盖 |
| m3 | OpenAPI 手写不同步风险 | 契约变更 checklist |
| m4 | Release 模拟器构建偶发 codesign xattr | 清理 DerivedData xattr；非逻辑缺陷 |

---

## 4. 已通过的构建 / 测试 / 验收

| 命令 | 结果 | 备注 |
|------|------|------|
| `cd backend/api && npm run build` | **PASS** | prisma generate + tsc |
| `cd backend/api && npm test` | **PASS** | 22 suites / **84** tests |
| `cd backend/api && npm audit --omit=dev` | **FAIL（有漏洞）** | 13 条，见 C5；未阻断 unit |
| iOS `xcodebuild test … -only-testing:TalkAndTalkTests` | **PASS** | **40** tests，0 failures；destination `iPhone 17, OS 26.5`；xcresult `DerivedData/Logs/Test/Test-TalkAndTalk-2026.07.09_16-40-09-+0800.xcresult` |
| 配置单元测试（JWT/CORS/SMS mock 拒绝） | **PASS**（含在 unit） | `configuration.spec.ts` |
| 支付 mock 履约 / 幂等 unit | **PASS** | `payments.service.spec.ts` |
| 日志脱敏 unit | **PASS** | `redact.spec.ts` |
| RolesGuard unit | **PASS** | `roles.guard.spec.ts` |

### 静态审查通过项（无命令，有代码证据）

- 生产 JWT / CORS 强制校验；生产禁 `SMS_PROVIDER=mock`。
- `APP_ENV=production` 时 `mock-notify` → `MOCK_PAY_DISABLED`。
- iOS Admin / 安全工作台 / 开发模式本地兜底均 `#if DEBUG`（`AdminView.swift`、`ContentView.swift`、`AppStore.swift`、`ProfileView.swift`）。
- Bundle ID `com.talkandtalk.app`；版本 `0.1.0`；Release `BACKEND_BASE_URL=https://api.talkandtalk.app`。
- Sign in with Apple + associated domains（api / staging）。
- 法律页静态资源：`public/legal/privacy.html`、`terms.html`；Admin Web：`public/admin/index.html`。
- 注销申请 API + iOS 设置页；helmet、IP 限流、审计、备份脚本与回滚文档存在。
- OpenAPI 覆盖 auth / companions / orders / payments / conversations / admin / metrics。
- prod compose：**未**把 Postgres/Redis publish 到宿主端口（优于 dev compose 的 5432/6379 暴露）。

---

## 5. 未执行项及原因

| 项 | 原因 |
|----|------|
| `npm run test:e2e` | 本机无 Postgres/Redis；进程挂起后终止。e2e 套件代码存在（7 个 `*.e2e-spec.ts`）。 |
| `./scripts/acceptance-smoke.sh` | API 未监听；`curl :3000` 失败。 |
| `docker compose -f infra/docker-compose.prod.yml config/up` | **Docker CLI 不可用**（`docker` / `docker-compose` / colima / orbstack 均无）。 |
| 生产 HTTPS health / 证书 | 无域名、无 `infra/nginx/certs`。 |
| 真实微信 / 短信沙箱联调 | 无商户号与厂商账号（且代码为壳）。 |
| iOS Archive / TestFlight 上传 | 无 `DEVELOPMENT_TEAM`；审查不代签。 |
| 手工 UI 全链路（登录→下单→聊天→注销） | 需运行中后端 + 真机/模拟器人工；本报告以自动化 + 静态为准。 |
| 备份 restore 演练 | 无运行中 DB。 |
| Release 模拟器完整 codesign | 本环境 WechatOpenSDK/DerivedData **xattr** 导致 codesign 失败（Debug test 清 xattr 后已通过）。 |

---

## 6. 三档结论详述

### 6.1 v0.1 / staging — Conditional Go

**满足：** 冻结契约、mock 登录与支付文档路径、审核与 Admin、通知与注销申请、单元测试与 iOS 单测、部署文档。

**升为 Go 的条件（最短）：**

1. 在有 Postgres+Redis 的机器执行：`npm run test:e2e` 全绿。  
2. `npm run start:dev`（或 compose）后 `./scripts/acceptance-smoke.sh http://127.0.0.1:3000` 全绿。  
3. 按 `docs/staging-acceptance.md` 勾选 iOS 手工回归（可 mock）。

**不阻塞 v0.1：** 真实微信、真实短信、CI、APNs、完整社区。

### 6.2 TestFlight — Conditional Go

**满足：** 主工程可测、Release 基址指向 production API、DEBUG 入口剥离、App Store 元数据稿、隐私/协议资源。

**提交前必须：**

1. Xcode Team + 证书/描述文件。  
2. 填写 `WECHAT_APP_ID`（或接受「未配置微信」错误文案、仅测非支付路径）。  
3. 构建指向 **staging** 后端（推荐：Scheme / `BACKEND_BASE_URL`），staging 上 seed + smoke。  
4. Apple Sign In 在 Developer 启用与 Bundle ID 一致。  
5. Archive 成功；确认 Release 无「安全工作台 / 开发模式」文案。

### 6.3 完整商业 production — No-Go

任一商业定义（真实用户可登录 + 可收款 + 可审核 + 可回滚 + 可监控）当前不满足：

- 不可真实收款（B1）  
- 生产 Mock 回落支付风险（B2）  
- 手机登录生产不可用且无强制「仅 Apple」策略落地（B3）  
- SEED/metrics/admin/Redis 硬化不足（C1–C3）  
- e2e/smoke/备份演练未在目标环境证明  

---

## 7. 最短可发行路径

### A. 先发 v0.1（内部 / staging / 可 TestFlight）

```text
1. 启动 Postgres + Redis + API（docker compose 或本地）
2. backend/api: npm test && npm run test:e2e && acceptance-smoke
3. iOS: TalkAndTalkTests + staging-acceptance 手工清单
4. 配置 Apple Team；可选 WECHAT_APP_ID
5. Staging 部署：.env.staging + compose.prod + smoke
6. TestFlight 指向 staging（支付走 mock-notify 闭环）
```

**预期结果：** Conditional → Go（v0.1）；用户可见 mock/演示支付与 mock 短信（或 Apple）。

### B. 完整商业发行还需补齐

| 优先级 | 项 |
|--------|-----|
| P0 | 真实微信 prepay + 平台证书验签 + 回调解密 |
| P0 | production **禁止** Mock 支付提供商；未配置则硬失败 |
| P0 | 真实 SMS **或** 产品+客户端「仅 Apple 登录」并隐藏 SMS |
| P0 | 修复 compose `SEED_ON_STARTUP` 默认；轮换默认 staff |
| P0 | nginx/网络隔离 metrics 与 admin；Redis 密码；微信私钥 secret |
| P1 | 依赖 audit 治理；health/metrics 告警；备份 cron + restore 演练 |
| P1 | CI（api + iOS）；生产域名 TLS + smoke |
| P2 | APNs、社区后端化、评价 API、CI 覆盖率 |

---

## 8. 安全与支付路径摘要（审查笔记）

```text
prepay
  → WECHAT provider = (production && configured) ? Real : Mock
  → Real.createAppPrepay → 始终 503 WECHAT_PAY_NOT_IMPLEMENTED
  → Mock.createAppPrepay → mock clientParams（staging/dev 闭环 OK）

POST /payments/wechat/mock-notify
  → APP_ENV=production → 403 MOCK_PAY_DISABLED  ✅
  → 否则 JWT 用户 + fulfill

POST /payments/wechat/notify
  → verifyNotifySignature
       Real → 当前恒 false → 无法履约（配置齐也不可收款）
       Mock → MOCK_OK / mock token 可通过 → 风险 ⚠️
```

SMS：

```text
SMS_PROVIDER mock|none → MockSmsProvider
production + mock → 启动失败 ✅
production + none → 可启动，但用户无验证码 → 手机登录死 ✅/❌（产品）
```

---

## 9. 审查环境

| 项 | 值 |
|----|-----|
| OS | macOS |
| Node | v22.22.3 |
| xcodebuild | 可用；iPhone 17 / iOS 26.5 模拟器 |
| Docker | **不可用** |
| Postgres / Redis | **本机未运行** |
| 仓库路径 | `/Users/taoma/Documents/talk and talk` |

---

## 10. 结论复述

| | |
|--|--|
| **总判定** | **Conditional Go** |
| **v0.1 / staging** | **Conditional Go**（补 e2e + smoke 后可 Go） |
| **TestFlight** | **Conditional Go**（Team / 微信 / staging 后端 / Archive） |
| **完整商业 production** | **No-Go**（真实支付、支付伪造面、短信/登录策略、运维硬化） |

本报告为发行决策依据；实现修复请另开任务，勿与本审查混为同一变更集。
