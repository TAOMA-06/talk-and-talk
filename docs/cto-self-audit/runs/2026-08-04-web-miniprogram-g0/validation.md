# G0 验证日志

> append-only。当前状态和 Gate 结论只维护在 `state.md`；本文件只追加命令、环境、结果和 Evidence ID。

## 2026-08-04 / Asia/Shanghai

| Evidence ID | 命令/场景 | 环境 | 结果 | 备注 |
|---|---|---|---|---|
| `E0-BASELINE-20260804` | `git rev-parse HEAD`; `git branch --show-current`; `git status --short`; dirty file SHA/hash map | local read-only | PASS | `main@9cf5e3849a96`；19 tracked Web changes + 12 untracked paths captured |
| `E0-CODEGRAPH-20260804` | `codegraph explore` 官网 marketing、BFF、服务端事实和 Mini 相关 symbols | indexed workspace | PASS | 未改代码；确认 Web marketing 与完整交易客户端文档存在边界冲突 |
| `E0-CONFIG-20260804` | 读取 root/Web/Mini README、Web/Mini package manifests、`app.json`、`utils/config.ts`、`project.config.json` | local read-only | PASS | 31 pages、5 tabs；develop/trial staging；release production；`urlCheck: true`；text-only default |
| `E0-SCOPE-20260804` | Web `npm run check`；Mini validate/tsc/smoke；API E2E；真机/staging | not run | SKIP | Phase 0 只建立范围与状态，避免生成产物或触发外部依赖；G0 Go 后按切片执行 |
| `E0-G0-CONFIRM-20260804` | 用户确认 G0-D01～D04 默认 | current task turn | PASS | 官网解释/导流、小程序真实服务、延期 Web、production disable 方案、`/business`/`/demo` 默认私密、BFF 仅隔离 development |
| `E1-WEB-01-ROUTE-20260804` | CodeGraph route map；读取 route/page/CTA/robots/sitemap/README；clean file status + blob manifest | indexed/local read-only | PASS | 公共面、延期路由、BFF/session、CTA依赖和 19 个 clean 候选文件已登记；未写业务文件 |

## 当前未验证

- Web 公共页面构建、渲染、320/390/768/1440px、键盘/对比度/reduced-motion/性能。
- Web 延期交易路由在候选 production 模式下的真实拒绝策略。
- API 隔离 E2E、staging DNS/TLS、体验版、真实微信登录、双角色真机、真钱和回滚。

## 2026-08-05 / Asia/Shanghai — Phase 0 重验

| Evidence ID | 命令/场景 | 环境 | 结果 | 备注 |
|---|---|---|---|---|
| `E0-REVALIDATE-20260805` | `git rev-parse HEAD`; `git branch --show-current`; `git status --short`; clean lease diff；既有 Web dirty path SHA-256 recheck | local read-only | PASS | `main@9cf5e3849a96`；19 个 tracked Web 修改、9 个 untracked Web 资产与既有 hash 一致；run 状态文件单独归本任务；clean lease 无 diff |
| `E0-CODEGRAPH-REVALIDATE-20260805` | `codegraph explore` route/BFF/session/CTA；读取 Mini `app.json`、`utils/config.ts`、`project.config.json` | indexed/local read-only | PASS | 延期 BFF/session 仍无生产 surface gate；sitemap 仍含 `/business`、`/demo`；Mini 31 pages/5 tabs、develop/trial staging、release production、`urlCheck:true`、text-only default 保持 |
| `E0-MODEL-20260805` | current runtime/model-options audit | local runtime capability | BLOCKED | 当前未暴露实际 planner model ID；无可调用 Luna max/Ultra。不得开始写代码；需 Luna 能力或用户以 Evidence ID 批准 fallback |
| `E1-MP-01-ROUTE-20260805` | CodeGraph/source audit of Mini consent/login/adult gate/catalog/order/payment/chat/community/text-only/companion surfaces | indexed/local read-only | PARTIAL | 首次协议和 server consent receipt、WeChat login/session、付费成年资格、结构化 catalog/availability、支付 sync、moderation/support、local-copy isolation 已有代码证据；普通社区发帖/消息仍缺服务端真实身份硬门，consent 文案仍含当前 TRTC |
| `E1-MP-01-MANIFEST-20260805` | `git status --short -- frontend/miniprogram`; sorted source SHA-256 manifest | local read-only | PASS | Mini source clean；manifest `a777f8267cfe3a9fb17828fea802794ee6e106cbb3f152f31dfbcbe2f873114f`；只登记 read-only lease，未改文件 |
| `E1-MP-01-CHECKS-20260805` | `node frontend/miniprogram/scripts/validate.mjs`; `backend/api/node_modules/.bin/tsc -p frontend/miniprogram/tsconfig.json --noEmit`; `node frontend/miniprogram/scripts/smoke.mjs`; `node frontend/miniprogram/scripts/test-local-build.mjs` | local read-only / temp isolation | PASS（结构检查带 AppID warning） | 31 pages/5 tabs；TypeScript 通过；runtime smoke 通过（835 API calls，consent/legal、payment branches、HTTPS/Cloud Run）；local-copy isolation 通过；未证明真实 AppID、远端、真机或支付 |

### 重验后仍未验证

- Web `npm run check`、公共页面渲染/无障碍/性能及延期路由 production refusal。
- API 隔离 E2E、staging DNS/TLS、体验版、真实微信登录、双角色真机、真钱和回滚。
- MP-01 的完整服务端负例、稳定错误契约、全局 text-only 入口关闭和真实链路；独立 Sol Ultra 复核已完成并记录为 `E1-MP-01-SUBAUDIT-20260805`，结论为 G1-blocked。

## 2026-08-05 / Asia/Shanghai — MP-01 独立只读复核

| Evidence ID | 命令/场景 | 环境 | 结果 | 备注 |
|---|---|---|---|---|
| `E1-MP-01-SUBAUDIT-20260805` | 独立 Sol Ultra capability/error review；Mini 定向后端负例/链路审阅 | indexed/local read-only；未写文件、未触发外部系统 | FAIL（G1-blocking findings） | 普通社区发帖与即时消息缺服务端真实身份硬门；OpenAPI/稳定拒绝负例不足；首用同意页仍描述当前 TRTC；全局 text-only 下语音介绍、历史附件、案件举证等媒体入口仍可达；收益冻结申诉、普通用户直调陪伴者订单写接口和 voice SKU 语义有 P1 缺口。独立审阅同时报告 6 个后端定向 suite / 98 tests 本地通过；不证明体验版、真实微信、真机、staging 或真钱。 |
| `E0-STATE-RECHECK-20260805` | `git diff --check`; `git diff --name-only -- frontend/miniprogram backend/api shared/contracts .github`; run docs non-empty check | local read-only | PASS：无 whitespace error；业务目录无本任务 diff；状态、变更地图、验证和交接文件均非空 | pass 1 / fail 0 / skip 0 | 仅更新 run 状态文件；既有 Web dirty ownership 未触碰 |
| `E1-SHARED-01-DESIGN-20260805` | CodeGraph/source review of `CommunityService.create`、`ConversationsService.send`、现有成年资格错误族和 `ReserveMediaUploadDto`；登记最小契约/负例矩阵 | indexed/local read-only；未写文件、未触发外部系统 | PASS（设计登记，不是实现通过） | 确认普通发帖/消息服务端实名门缺口、成年资格不能替代实名门、媒体入口范围和直调权限负例；草案写入 `change-map.md`，等待 MP-D05 与 writer gate |
| `E2-PACKAGE-SKELETON-20260805` | 在 `handoff.md` 建立 G2-ready 外部授权模板、场景矩阵、证据字段和退出条件 | local docs-only | PASS（材料骨架） | 未填真实 AppID/账号/密钥/域名，未执行任何 Phase 7 外部动作；G2 仍 BLOCKED，骨架须在 G1 后填入候选 SHA 和实际证据 |
| `E1-RUN-DOC-REVIEW-20260805` | 独立 Sol Ultra 复核 SHARED-01 草案、G2 包和 run 状态一致性 | indexed/local read-only；未写业务文件、未触发外部系统 | PASS（发现并已登记修正项） | 补录 P0-14 个性化推荐关闭、MP-D08 实名权威未决策、精确 shared lease、完整 G1 prerequisite matrix、账号/数据/设备准备要求、外部授权回滚字段，并修正 Mini 门禁和切片状态措辞；当前仍不满足实现/G2-ready |
| `E1-P0-14-RECOMMENDATION-20260805` | 读取当前推荐 OpenAPI、Mini README/smoke 和 P0-14 台账 | indexed/local read-only；未写文件、未触发外部系统 | PARTIAL / BLOCKED | 现有契约支持关闭个性化并保留手动发现，但模拟默认仍为 `personalizationEnabled:true`；未取得算法适用性结论，不能把推荐链写成 G1 通过 |

## 2026-08-06 / Asia/Shanghai — Hermes 续跑重验（只读）

| Evidence ID | 命令/场景 | 环境 | 结果 | 备注 |
|---|---|---|---|---|
| `E0-REVALIDATE-20260806` | `git rev-parse HEAD`; `git branch --show-current`; `git status --short`; 19 tracked + 8 单文件 untracked dirty path SHA-256 recheck；`frontend/miniprogram`/`backend/api`/`shared/contracts`/`.github` diff；`git diff --check` | local read-only；Node v22.22.3 / npm 10.9.8 | PASS（文件级） | `main@9cf5e3849a96`；19 tracked Web dirty + 8 单文件 untracked Web 资产与既有 current hash **全部匹配**；业务目录无本任务 diff；无 whitespace error。`frontend/web/public/brand/` 目录旧 manifest 算法不可复现，已改为 per-file + 文档化 shasum 聚合（见下）；非内容漂移 hard-stop。 |
| `E0-LEASE-METHOD-20260806` | 复算 clean Web / API-runtime / Mini clean lease manifest；核对 WT vs HEAD 内容同一性 | local read-only | PASS（内容） / EXPLAINED（旧聚合算法） | Mini `git ls-files` + `sha256sum` 行聚合仍精确匹配 `a777f826…`。Web clean 19 文件与 API/runtime 5 文件 **逐文件 WT==HEAD@9cf5e38**，无内容漂移。旧 clean/API 聚合 hash 算法未在 run 中固化，今日起统一方法：`sorted paths` → 行格式 `SHA256  path\n` → 再对全文做 SHA-256；新值 clean=`cdc0790ff9f1…`，API=`4f284ac0ad7b…`，brand=`a164f5b682ef…`。`miniprogram_npm/` 受 gitignore，不计入 lease。 |
| `E0-MODEL-20260806` | Hermes runtime/model capability probe：`hermes status`；config/auth/provider cache（不暴露密钥）；OpenRouter/Codex/Luna 可调用性 | local runtime | BLOCKED for writer | 当前会话实际模型=`grok-4.5` / provider=`xai-oauth`（桌面会话元数据）。Catalog 可见 `openai/gpt-5.6-luna` 与 `openai/gpt-5.6-luna-pro`，但 OpenRouter API key 未对 Hermes 生效（status: not set；credential_pool.openrouter 空；suppressed）、OpenAI Codex 未登录。**无可调用 Luna Ultra/max writer**。Planner 侧本环境未暴露 `gpt-5.6-sol` runtime ID（与既有 `E0-MODEL-20260805` 一致）。不得开始业务编码。 |
| `E0-STATE-RECHECK-20260806` | 仅更新 `runs/2026-08-04-web-miniprogram-g0/**`；确认无业务文件写入 | local docs-only | PASS | 续跑只读重验 + 状态落盘；不修改 `frontend/**`、`backend/**`、`shared/**`、`.github/**`。 |


## 2026-08-07 / Asia/Shanghai — Grok long-running implementer (model gates waived)

| Evidence ID | 命令/场景 | 环境 | 结果 | 备注 |
|---|---|---|---|---|
| `E0-REVALIDATE-20260807` | `git rev-parse HEAD`; `git status --short`; dirty Web SHA-256 recheck; business-dir diff | local | PASS | `main@9cf5e3849a96`；19 tracked + untracked Web dirty hashes 与 ownership map 一致；业务目录无无关漂移；MODEL-D06 按 OBJECTIVE 放弃 |
| `E1-SHARED-01-IMPL-20260807` | identity gate + community/conversations wiring + personalization default-off + text-only matrix unit tests | local Jest | PASS | `PUBLIC_INTERACTION_IDENTITY_REQUIRED` 403 零写入；`personalizationEnabled` 默认 false；capability matrix fail-closed；OpenAPI 403 契约 |
| `E1-WEB-01-IMPL-20260807` | surface policy + route gates + miniprogram-entry + `npm run check` x2 | local Node | PASS | `WEB_SURFACE_MODE=production` 拒绝延期交易/BFF；CTA allowlist/fallback；两次 check 一致绿 |
| `E1-MP-01-IMPL-20260807` | consent text-only、voice/media 入口、identity error mapping、companion order role fail-closed；validate/tsc/smoke/local-copy | local | PASS | 结构 AppID warning only；smoke 835 API calls；首用文案不再宣称当前 TRTC |
| `E1-API-GATES-20260807` | `npm run test:preflight`；`npm run build`；`npm test`（1298） | local Nest | PASS | identity/order/payment e2e 未改远端；隔离 e2e 未另起 Postgres（unit 覆盖主路径） |
| `E1-CANDIDATE-20260807` | candidate-manifest + residual + rollback + G2-ready fields | docs | PASS（G2 BLOCKED） | `candidate-manifest.md`；evidence/* 日志；G2 仍 BLOCKED，G3 No-Go |

### 环境记录
- Node: v22.x；npm from package engines
- No git push/PR/deploy/DNS/WeChat upload/real money
- Writer: Grok 4.5 (MODEL-D06 waived by goal OBJECTIVE)


## 2026-08-07 / Asia/Shanghai — adversarial re-verification (post skeptic timeout)

| Evidence ID | 命令/场景 | 环境 | 结果 | 备注 |
|---|---|---|---|---|
| `E0-REVALIDATE-20260807B` | ownership hash recheck; external wait table | local | PASS | dirty Web hashes unchanged vs map; G2/G3 still BLOCKED |
| `E1-SHARED-P0-RERUN-20260807` | Jest shipped community/conversations/recommendations/identity/matrix/delivery | local | PASS 60/60 | drives real `CommunityService.create` / `ConversationsService.send` / `asPreference` |
| `E1-WEB-RERUN-20260807` | surface-policy unit + `npm run check` x2 | local | PASS | production disposition unit-tested; check consistent exit 0 |
| `E1-MINI-RERUN-20260807` | validate/tsc/smoke/local-build | local | PASS | VALIDATE/TSC/SMOKE/LOCAL all exit 0 |
| `E1-API-RERUN-20260807` | preflight + build + full jest; e2e env probe | local | PASS unit; e2e SKIP | no DATABASE_URL; recorded in Risks; 1298 tests green |
| `E1-PACKAGE-RERUN-20260807` | candidate-manifest + evidence refresh + structural grep | docs | PASS | G2 BLOCKED explicit; package ready for adversarial review |

### E2E inability (honest)
```
DATABASE_URL: unset
psql default DB: FATAL database "taoma" does not exist
redis-cli: PONG
Decision: keep unit-level zero-write identity/media/personalization tests + full API suite; do not fabricate e2e green.
```


## 2026-08-07 / Asia/Shanghai — skeptic voice-intro fail-closed fix

| Evidence ID | 命令/场景 | 环境 | 结果 | 备注 |
|---|---|---|---|---|
| `E1-VOICE-INTRO-SERVER-20260807` | `CompanionsService.updateOwn` under `COMMERCIAL_SURFACE=text_only` with voiceIntroAssetRef+duration | Jest real service | PASS | throws `VOICE_INTRO_UNAVAILABLE` 409; `companionProfile.update` not called; matrix used via `isFirstReleaseCapabilityEnabled("voiceIntro")` |
| `E1-VOICE-INTRO-DTO-20260807` | `getPublished` with approved historical voice intro under text_only | Jest real service | PASS | `voiceIntro.available=false`, playback unavailable |
| `E1-VOICE-INTRO-UI-20260807` | onboarding wxml `wx:if="{{voiceIntroEnabled}}"` + smoke structural assert | Mini smoke | PASS | fields unreachable when text-only; smoke + tsc green |
| `E1-SHARED-P0-RERUN-VOICE-20260807` | shared P0 suite + companions.service.spec | local | PASS 115 tests | evidence/shared-p0-tests.log |


## 2026-08-07 / Asia/Shanghai — review-fix pass

| Evidence ID | 改动 | 结果 |
|---|---|---|
| `E1-REVIEW-FIX-ENTRY-20260807` | Mini CTA host allowlist + reject credentials/query/fragment | web unit pass |
| `E1-REVIEW-FIX-SURFACE-20260807` | `NODE_ENV=production` fail-closed; tests use `WEB_SURFACE_MODE=open` | web check pass |
| `E1-REVIEW-FIX-P014-20260807` | ranking personalization requires `RECOMMENDATION_PERSONALIZATION_ENABLED` | jest pass |
| `E1-REVIEW-FIX-MATRIX-20260807` | matrix wired into media/voice/orders/companions | jest pass |
| `E1-REVIEW-FIX-RECOVERY-20260807` | recoveryPath → `/pages/profile/index` + Mini modal navigation | mini smoke pass |
| `E1-REVIEW-FIX-OPENAPI-20260807` | `VOICE_INTRO_UNAVAILABLE` 409 on updateOwnCompanionProfile | docs |

Logs: `evidence/review-fix-*.log`
