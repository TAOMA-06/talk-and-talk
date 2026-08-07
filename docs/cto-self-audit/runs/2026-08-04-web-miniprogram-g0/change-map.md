# G0 变更地图

2026-08-07：SHARED-01 / WEB-01 / MP-01 已实现并完成本地门禁；G2 外部动作仍 blocked。

| Slice ID | 结果 | 预计面 | 预计文件/接口 | 并发规则 | 状态 |
|---|---|---|---|---|---|
| `G0-BASELINE-01` | 基线、dirty ownership、G0 决策台账可恢复 | shared/docs | `runs/2026-08-04-web-miniprogram-g0/**` | 仅 root；已取得唯一 lease | completed / PASS |
| `WEB-01` | 形成官网公共/延期路由 disposition，并准备真实生产禁用实现 | web | clean route pages、BFF/session routes、sitemap/README、surface policy + tests、miniprogram-entry；既有 dirty public components 只读未改 | 全局最多一个 Web slice；不触碰 dirty user files | completed / `E1-WEB-01-IMPL-20260807` |
| `MP-01` | 小程序身份/协议/服务入口/text-only capability matrix | mini | consent、config、detail/onboarding/services/orders、error mapping、smoke | 可与 WEB-01 并行，仅文件不重叠且各自 lease | completed / `E1-MP-01-IMPL-20260807` |
| `SHARED-01` | OpenAPI/DTO/error/权限事实统一 | shared/backend | identity gate、community/conversations services+specs、recommendations default-off、OpenAPI 403、capability matrix、prisma personalization default migration | 与 Web/Mini 实现互斥；全局唯一 shared slice | completed / `E1-SHARED-01-IMPL-20260807` |
| `QA-01` | G1 验证、证据、回滚和候选 manifest | shared/docs | `validation.md`、evidence、handoff、`candidate-manifest.md` | 只读复核；不能把本地绿灯写成外部通过 | completed / G2 BLOCKED |
| `G2-OPTIONAL-01` | HTTPS staging、体验版、双角色真机 E3 | external | staging/微信平台/设备 | 需要逐项精确授权；默认不执行 | blocked |

## 共享权威

- 服务端：`backend/api`。
- 契约：`shared/contracts/openapi/v1.yaml`。
- 小程序发行源：`frontend/miniprogram`；本机联调副本：脚本生成的 `frontend/miniprogram-local`。
- 官网公共面：`frontend/web` public routes；延期 Web App 与 BFF 不计入当前公共官网完成条件。

## WEB-01 只读 route disposition

| 路由/能力 | 当前代码证据 | 默认处置 | 生产候选要求 | 计划修改面 |
|---|---|---|---|---|
| `/`、`/how-it-works`、`/safety`、`/about`、`/partners` | 各自 page metadata + marketing components；部分 component/page 为 pre-existing dirty | 官网公共交付 | 保持可访问、可索引；CTA 只导向已验证小程序或诚实 fallback | dirty public files 仅保留/审查，不纳入 WEB-01 写入 |
| `/business`、`/demo` | clean route pages；`DemoExperience` 为既有 dirty component | 默认私密/条件公开 | 未有主体/案例/演示证据时 production 404/跳转；不进入 sitemap/主导航 | `app/business/page.tsx`、`app/demo/page.tsx` |
| `/discover`、`/companions/[id]`、`/login`、`/community`、`/orders`、`/messages`、`/profile`、`/workbench` | 当前 page 仍渲染完整交易/账户组件，仅设置 `robots: noindex` | production 暂停，隔离 development 可选 | 直接访问 production candidate 必须 feature gate 后 404/跳转；不能仅隐藏导航或依赖 robots | 8 个 clean route page files |
| `/api/backend/[...path]` | BFF 会代理非阻断路径，保留 cookie refresh；当前无 production surface gate | 隔离 development 保留 | 非 development 或未显式启用时返回明确 `ROUTE_NOT_ALLOWED`/404；不能触达默认 production API | BFF route |
| `/api/session/*` | login/logout/send-code/session route 仍可调用 API | 隔离 development 保留 | 非 development 或未显式启用时拒绝会话写入；不触碰公共官网主链 | 4 个 session route files |
| `robots.ts` / `sitemap.ts` | 已 disallow 交易路由，但 sitemap 仍包含 `/business`、`/demo` | SEO 辅助，不是访问控制 | sitemap 与最终公开 disposition 一致；`robots` 不替代 gate | robots/sitemap |
| `MiniprogramCta` / `lib/miniprogram-entry.ts` | CTA 使用 `NEXT_PUBLIC_MINIPROGRAM_PATH/QR_URL`，缺失时复制搜索名 | 公共官网入口 | allowlist 协议/域名；配置缺失显示诚实 fallback；既有 dirty CTA 组件先不改 | `lib/miniprogram-entry.ts` 先审查，CTA 另开 slice |

## WEB-01 短计划（尚未编码）

1. 新增 server-only surface policy：production/staging 默认关闭延期 Web App、BFF/session；只有显式隔离 development 开关且 API base URL 通过非生产 allowlist 时才允许。
2. 在上述 clean route pages 加 gate；`/business`、`/demo` 与交易路由分别遵循 confirmed disposition。
3. 清理/同步 sitemap 与 README 的产品责任描述；不修改既有 dirty 官网内容文件。
4. 为 route gate、BFF refusal、sitemap disposition 增加定向测试；负例必须覆盖“开关打开但 API 未配置/指向 production 仍拒绝”。现有 dirty `rendered-html.test.mjs` 不在本 slice 内覆盖写入。
5. 运行 `frontend/web` 的 `npm run check`；独立 reviewer 检查 404/redirect、默认 API 不可达、CTA fallback 和 dirty hash。

## WEB-01 文件 lease

以下 19 个现有 clean 文件在取得 writer gate 后可修改；取得时必须重新核对 clean status。baseline manifest：`d52c1fb0ae3f13aaa014828b1f69ebbb152af7ebcae818f5f6651d59fa24a823`。

```text
frontend/web/README.md
frontend/web/app/api/backend/[...path]/route.ts
frontend/web/app/api/session/{route.ts,login/route.ts,logout/route.ts,send-code/route.ts}
frontend/web/app/business/page.tsx
frontend/web/app/community/page.tsx
frontend/web/app/companions/[id]/page.tsx
frontend/web/app/demo/page.tsx
frontend/web/app/discover/page.tsx
frontend/web/app/login/page.tsx
frontend/web/app/messages/page.tsx
frontend/web/app/orders/page.tsx
frontend/web/app/profile/page.tsx
frontend/web/app/robots.ts
frontend/web/app/sitemap.ts
frontend/web/app/workbench/page.tsx
frontend/web/lib/miniprogram-entry.ts
```

既有 dirty 文件（`app/layout.tsx`、公共 page/components、`globals.css`、`MiniprogramCta.tsx`、rendered HTML tests 等）只读；不得在本 slice 混改。

新增/运行时依赖也必须提前登记：

| 组 | 文件 | baseline |
|---|---|---|
| API allowlist | `frontend/web/lib/server-api.ts` | clean manifest `e510c859c1d9db3906198195670f754513ebb8936fde0b019faa11a31d89dbb1` |
| Runtime/config | `frontend/web/.dev.vars.example`、`.env.example`、`frontend/web/package.json`、`frontend/web/worker/index.ts` | 同上 |
| New policy | `frontend/web/lib/web-surface-policy.ts` | NEW；Luna gate 后创建 |
| New targeted test | `frontend/web/tests/web-surface-policy.test.mjs` | NEW；Luna gate 后创建 |

`worker/index.ts` 若注入 runtime binding，必须只注入显式 non-production allowlisted API；缺失或 production API 不能因 development flag 自动放行。

## MP-01 只读 capability/error matrix（2026-08-05）

| 能力 | 当前证据 | 当前判断 | 必须补的负例/外部证据 |
|---|---|---|---|
| 首次协议、隐私和成年确认 | `app.json` 首页为 `pages/consent/index`；`privacy.ts` 校验版本、协议 URL、隐私授权和 `adultConfirmed`；登录后必须上传服务端 consent receipt | 保留；客户端首用门存在 | 协议过期/服务端 receipt 缺失必须清 session 并回 consent；本轮 smoke 已通过，真实微信仍未验证 |
| 微信登录和会话恢复 | `wx.login` → `/auth/wechat/mini-program`；服务端不持久化 session_key；`ensureSession` 先协议再 refresh/login | 保留；真实身份仍未闭环 | 缺 AppID/Secret、微信登录失败、旧 refresh、账号不可用；真实微信登录和 staging 未验证 |
| 成年资格与付费门 | `assertCurrentCustomerAdultEligibility` 拒绝无记录、pending、ineligible、expired、validity-too-short；订单创建/支付预付/履约路径调用 | 服务端付费门存在 | 逐状态拒绝 create/prepay/start；真实双角色和远端 API 未验证 |
| 发现→详情→服务商品→可约时段 | `home`/`discover`/`companion/detail` 使用 `ensureSession`、服务端 catalog/availability、结构化 SKU 和时段；客户端拒绝无效或 legacy 时段 | 保留；服务端事实优先 | API 契约异常、过期/重叠时段、弱网和重复点击；本轮 runtime smoke 已通过，真实远端仍未验证 |
| 个性化推荐与手动发现 | OpenAPI 暴露 `/recommendations/*`，Mini smoke 仍以 `personalizationEnabled: true` 和行为标签模拟；共享契约声明可关闭个性化且保留显式搜索/目录 | P0：算法治理/适用性结论未闭环前，候选默认必须关闭个性化排序；手动发现、明确关键词和当前可售目录仍可用 | 服务端默认/发布配置为关闭；行为标签、近 90 日订单/点击不得参与排序；补关闭状态、手动发现保留和无行为标签排序负例，取得适用性书面结论后再重新决定 | 
| 订单、支付和支付后状态 | Mini API 有 `createOrder`、`prepay`、`syncPayment`；服务端 `syncPayment` 对非 SUCCESS 返回 `PENDING`，成功以微信查询/回调为准 | 保留；不能宣称真钱可用 | `requestPayment` 成功但服务端仍 pending 不得展示 paid；真实支付/退款/回调未验证 |
| 站内文字消息、举报、售后 | 页面/API 覆盖 chat、community report、support、aftercare；服务端 moderation、chat restriction、订单服务窗口存在 | 功能路径存在，但有 P0 身份硬门缺口 | 未实名普通用户发帖/发消息必须稳定 403 且无写入；当前后端普通 community post 和 conversation send 未强制实名硬门 |
| text-only、媒体和 TRTC | `COMMERCIAL_TEXT_ONLY_DEFAULT=true`；聊天新增附件与 voice SKU 默认关闭；但语音介绍播放、历史聊天附件、客服/履约争议/陪伴者事件媒体入口仍存在，且 consent 文案提及当前 TRTC | P0：若 G0“首发不开放媒体”按全局口径，当前入口可达；后端 fail-closed 不能替代 UI 入口不可达 | 全局 media read/write、voice intro、历史附件和相关上传/播放负例；移除 release 可写 override；修正文案并验证服务端 fail-closed |
| 陪伴者入驻、审核、商品、排班、履约 | onboarding、services、availability、schedule、workbench；排班写入要求 commercial profile `verified`；资料说明要求外部 KYC/成年/合同/税务/收款双人复核 | 保留为履约链候选；外部资格未知 | 普通用户不可进入陪伴者写入口；verified/suspended/未复核矩阵；真实 KYC、结算、双角色真机未验证 |
| 收益冻结和申诉 | earnings 页面展示 held/暂缓原因；现有 companion commercial API 无 earning 级冻结申诉资源 | P1：不满足 Phase 4“收益事实、冻结、申诉”完整闭环 | `earningId + holdReason + deadline + status + resolution` 的本人隔离、幂等 API/UI 和跨账号负例 |
| 陪伴者写操作权限 | 客户端按角色/状态隐藏订单服务操作；页面存在 `/orders/service/:id/{confirm,reject,start,complete}` 调用 | P1 待负例：客户端隐藏不是服务端权限证据 | 普通用户令牌直调四端点必须 403 且订单版本/审计零变化；suspended/reviewExpired 同样拒绝 |
| voice SKU 语义 | text-only 下 services 页面可编辑历史 voice SKU，存在静默映射为 text 与重新上架风险 | P1：不能让 dormant voice 在首发候选重新激活 | voice SKU 在 text-only 下不可编辑/上架；服务端 delivery mode 不可被客户端重写 |
| 本机联调和发行源隔离 | `create-local-copy.mjs` 生成临时副本；`test-local-build.mjs` 验证正式 `config.ts`/`project.config.json` 不变且 release validator 拒绝本机 HTTP | 保留；本轮已通过 | 继续保持正式源与临时副本隔离；不得把本地副本上传或当体验版证据 |

### MP-01 当前 P0

1. `CommunityService.create` 对普通 `femaleRequest` 未强制真实身份硬门；只对 `malePromotion` 检查陪伴者资料。
2. `ConversationsService.send` 只读取 `profile.isVerified` 作为 moderation 输入，没有拒绝未实名用户。
3. `consent/index.wxml` 仍把实时语音/TRTC 写成当前处理范围，与首发 text-only 口径冲突。
4. 若“首发不开放媒体”按全局口径，语音介绍/历史附件/客服、履约争议和陪伴者事件媒体入口仍可达；当前 smoke 只证明部分新增入口关闭。
5. OpenAPI 与负例测试尚未提供普通用户实名/成年拒绝的稳定错误码、零写入和审计不变证据，必须由后续 `SHARED-01` 串行补齐。
6. `P0-14` 个性化推荐治理结论未闭环；候选必须默认关闭个性化排序，保留不依赖个人特征的手动发现路径，不能把现有推荐 smoke 的 `personalizationEnabled: true` 当作放行证据。

### MP-01 只读 lease

`frontend/miniprogram` 当前 clean manifest：`a777f8267cfe3a9fb17828fea802794ee6e106cbb3f152f31dfbcbe2f873114f`。该 lease 仅允许只读调查；任何实现前必须重新核对 status/hash，并取得 Luna max/Ultra writer gate。共享 `backend/api`/`shared/contracts` 的身份硬门属于后续 `SHARED-01`，与 MP-01 实现互斥。

## SHARED-01 实现前契约草案（只读登记，未编码）

### 目标与不做事项

- 目标：把“公开发帖”和“即时通讯”前的真实身份门变成服务端唯一事实，并用共享契约暴露稳定、可测试的拒绝结果；同步冻结首发 text-only 能力矩阵。
- 不做：不引入新的 KYC 提供方、不决定采集字段或法律依据、不把客户端 `profile.isVerified` 或成年复选框当作独立实名证明、不扩展 Web 交易、不执行远端或真实账号验证。

### 当前权威入口（基于 2026-08-05 CodeGraph/source review）

| 能力 | 当前写入口 | 当前缺口 | 实现前必须保留的边界 |
|---|---|---|---|
| 普通公开发帖 | `CommunityService.create` → `POST /community/posts` | `femaleRequest` 只走 moderation/rate-limit，未在任何写入前检查实名硬门 | 服务端在 moderation/transaction 前拒绝；拒绝路径不得创建 post、moderation case、通知或审计副作用 |
| 即时文字消息 | `ConversationsService.send` → `POST /conversations/:id/messages` | 只检查会话交互限制；`profile.isVerified` 作为 moderation 输入不是授权门 | 服务端在消息/附件/通知写入前拒绝；会话、订单和售后读取不应被误伤 |
| 成年/付费资格 | `assertCurrentCustomerAdultEligibility` 及现有 `CUSTOMER_ADULT_ELIGIBILITY_*` 错误族 | 这是付费成年资格，不等价于公开互动实名 | 保留现有状态/恢复语义；实名门必须有独立、可解释的契约字段和错误码 |
| 媒体上传 | `ReserveMediaUploadDto` 与 conversations media-upload 入口；另有语音介绍、历史附件、案件举证路径 | text-only 当前只关闭部分新增入口，无法证明全局不可达 | 在产品口径确认后，服务端、页面、历史资源、SDK 和 release override 必须同一 fail-closed 矩阵；例外必须单独登记 |

### 身份权威与恢复路径（MP-D08，未决策、不得自行选 KYC）

- 当前 `profile.isVerified` 是布尔资料字段，不能直接证明普通用户真实身份；微信 OpenID/session 也不是实名证明。
- 在选择任何提供方、采集字段或法律依据前，必须由用户/合规 owner 明确：实名权威状态来源、角色适用范围、状态枚举、复核有效期、恢复入口、错误 `details` 和状态变更审计。
- 最小待决策枚举可包含 `notSubmitted / pending / approved / rejected / expired / suspended`，但这只是契约候选，不是当前代码事实；`pending/rejected/expired/suspended` 的公开发帖/即时通讯处理必须先定义，已有成年资格状态继续独立处理。
- 恢复入口必须是服务端可追踪的自助提交/人工复核路径；普通用户只能看到可执行的恢复提示，不得把“身份未核验”当作已闭环。

### 跨端权威矩阵（SHARED-01 完整范围）

| 事实组 | 唯一权威 | Web/Mini 可读取字段 | 当前状态 | G1 必须补的证据 |
|---|---|---|---|---|
| 法律同意、年龄与实名 | backend identity/legal services + shared errors | version、status、verifiedAt、validUntil、recoveryPath | 实名权威未定义；成年资格已有独立服务 | OpenAPI/DTO、状态负例、恢复链和审计 |
| 价格、SKU、时长、交付方式 | backend catalog/order snapshot | offeringId、deliveryMode、duration、price、sellability | Mini 读取服务端 catalog；voice SKU 语义仍有风险 | 同一快照契约、历史 SKU 禁激活/改写负例 |
| 可售时段与容量 | backend availability/order transaction | structured slot、capacity、expiresAt | 结构化路径存在 | 过期/占用/并发/重复点击 E2E |
| 订单、支付、退款 | backend order/payment state machine | order status、payment status、refund status | `syncPayment` 非 SUCCESS 返回 pending | 回调乱序、provider unknown、状态不可越级 |
| 消息、审核、举报、危机 | backend conversation/moderation/safety | message status、restriction、report receipt、crisis resources | 文字链存在；实名门缺口 | 403 零写入、拉黑与售后隔离、审核故障 fail-closed |
| 个性化推荐与行为标签 | backend recommendation policy | personalizationEnabled、algorithmVersion、manual search | P0-14 未闭环；候选默认关闭 | 关闭默认、手动发现可用、行为标签不参与排序 |
| 数据权利与注销 | backend account-governance/legal | request status、export/deletion receipt | 有页面/API，但真实链路未验证 | 访问/更正/导出/注销状态和保留边界 |
| 发布面与运行环境 | Web surface policy + release config | surface status、API allowlist、build SHA | Web gate 尚未实现 | 同 SHA、生产拒绝、CI 和排除面 manifest |

### 最小契约与负例（待模型门禁后实现）

1. 共享错误契约：为实名门定义稳定 error code、HTTP status、用户可恢复提示和 `recoveryPath`；OpenAPI、后端 `AppException`、Web/Mini 客户端映射必须一致。不得用通用 401/500 或仅靠文案判断。
2. 普通用户负例：未通过实名状态的 token 直调 `POST /community/posts`（`femaleRequest`）和文字消息端点，均得到稳定 403；数据库 post/message、moderation case、通知、审计计数和订单状态保持不变。
3. 状态矩阵：`notSubmitted / pending / rejected-or-ineligible / expired / suspended` 均拒绝；`approved` 仅在满足服务端当前状态时放行。成年资格 pending/expired 仍使用现有独立错误族。
4. 直调权限负例：普通用户 token 直调陪伴者订单 `confirm/reject/start/complete`，均 403 且订单版本、审计和通知零变化；客户端隐藏不得作为证据。
5. text-only 负例：按 MP-D05 的最终口径，覆盖语音介绍读/写、历史附件读/播放、客服/履约争议/陪伴者事件上传、TRTC/UserSig/voice SKU 和可写 global override；任何入口可达都不能通过 G1。
6. 自动化范围：共享切片期间补 API/OpenAPI、隔离 PostgreSQL/Redis 测试和稳定错误响应快照；Mini/Web 客户端映射另登记为后续不重叠 lease，客户端实现暂停，避免契约两端并行漂移。

### 进入实现的前置条件

- 用户确认 `MP-D05` 的全局 text-only 或明确的最小例外；
- `SHARED-01` lease 只登记上表列出的精确服务/测试/契约文件；新的实名 gate service 路径在 MP-D08 决策后单独登记，禁止以 `backend/api/**` 或 `shared/contracts/**` 宽泛 glob 持有 lease；与 Web/Mini lease 不重叠；
- writer slot 重新探测到 Luna max/Ultra，或有明确 fallback Evidence ID；
- 重新核对当前 SHA、dirty ownership 和所有 lease；任何未登记 diff 立即停止。
