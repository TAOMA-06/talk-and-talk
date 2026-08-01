# 微信小程序后端方案选型与部署验收

更新时间：2026-07-25

## 结论

Talk&Talk 推荐使用 **微信云托管 / CloudBase 云托管（容器模式）** 运行现有 NestJS API，并使用同一 VPC 内的托管 PostgreSQL 与 Redis。

截至本次核对，CloudBase 云托管官方概述标注支持地域为上海，并说明低谷可自动缩到 0；正式创建环境时以控制台可选地域为准。这个部署地域与 TRTC 服务端关房请求中的 `TRTC_CONTROL_REGION` 不是同一概念：后者按 TRTC 接口要求只能填 `ap-beijing` 或 `ap-guangzhou`，即使 API 容器运行在上海也不能填 `ap-shanghai`。特别是启用 TRTC 时，不可依赖缩到 0 的策略，必须保留至少一个常驻实例用于服务窗口到期扫描。[CloudBase 云托管概述](https://docs.cloudbase.net/run/introduction)、[TRTC 解散字符串房间接口](https://cloud.tencent.com/document/product/647/37088)

部署后保留两个入口：

- 小程序优先使用 `wx.cloud.callContainer` 访问云托管服务，不需要配置 request 合法域名，并走微信私有链路。
- iOS、Web 管理后台、法律页和微信支付回调继续使用 `https://api.talkandtalk.app` 公网入口。

两种入口都进入同一个容器和 `/api/v1` 契约，不维护两套业务后端。

## 方案对比

| 方案 | 对现有工程的改造 | 适配度 | 结论 |
|---|---:|---:|---|
| 微信云托管容器 | 直接使用现有 `backend/api/Dockerfile` | 高 | **推荐** |
| 云函数 + 云开发数据库 | 需要拆分 NestJS、迁移 Prisma/PostgreSQL 数据模型并重写部署和事务 | 低 | 不选 |
| 自建 CVM/轻量服务器 + Docker Compose | 代码可直接运行，但 TLS、扩缩容、补丁、容灾和监控均需自行维护 | 中 | 仅成本或特殊网络要求明确时选择 |
| 仅第三方公网 API | 小程序可通过 `wx.request` 使用，但仍需备案域名和合法域名配置 | 中 | 作为公网兼容入口保留 |

官方资料：

- [CloudBase 云托管概述](https://docs.cloudbase.net/run/introduction)
- [微信小程序通过 callContainer 访问云托管](https://docs.cloudbase.net/run/develop/access/mini)
- [云托管服务设置与公网/内网入口](https://docs.cloudbase.net/run/deploy/service-setting)
- [云托管 VPC 访问 PostgreSQL、Redis 等资源](https://docs.cloudbase.net/run/develop/resource-integration/tencentcloud)

## 为什么适合当前项目

现有后端具备以下特征：

- NestJS 单体 REST API，已经有生产 Dockerfile 和健康检查。
- Prisma 使用 PostgreSQL，并依赖 Redis 做验证码限流等状态管理。
- iOS 与小程序共用 `/api/v1`，不能把后端做成只允许小程序访问的孤岛。
- 微信支付需要公网 HTTPS 回调；Apple 登录、微信 code2Session、支付和内容审核还需要安全的公网出向访问。
- 容器是无状态的，持久数据都在 PostgreSQL/Redis，符合云托管横向扩缩容要求。

## 仓库内已经完成的适配

- 小程序会按 `develop`、`trial`、`release` 自动选择 staging/production HTTPS 地址。
- `utils/api.ts` 同时支持 `wx.request` 和 `wx.cloud.callContainer`，继续复用 JWT、刷新令牌和统一 envelope。
- `callContainer` 自动携带 `X-WX-SERVICE: talk-and-talk-api`，路径仍为 `/api/v1/*`。
- 后端支持 `wx.login` code 换取 OpenID、`wechatMiniProgram` 身份、JWT 与刷新令牌。
- JSAPI 预支付、回调验签/解密、退款和生产禁用 Mock 已有自动化测试。

## 云托管部署参数

在 CloudBase 创建 staging 与 production 两个环境，每个环境创建服务 `talk-and-talk-api`：

当前官方文档说明，连接腾讯云账号 VPC 内 PostgreSQL/Redis 的“内网互联”需要标准版及以上套餐；选购时必须把这一项计入成本，不能按个人版能力估算。

| 配置 | 值 |
|---|---|
| 构建目录 | `backend/api` |
| Dockerfile | `backend/api/Dockerfile`（以构建目录为根时填写 `Dockerfile`） |
| 监听端口 | `3000` |
| 健康检查 | `GET /api/v1/health` |
| 最小实例 | 常规 staging 可为 0；一旦验收或启用实时语音，staging 与 production 都至少为 1。production 语音上线时这是硬门禁，因为到期关房 worker 不能随容器缩到 0 一起停止。 |
| 私有网络 | 绑定 PostgreSQL、Redis 所在 VPC 与子网 |
| 公网入口 | 开启；绑定已备案的 `api-staging.talkandtalk.app` / `api.talkandtalk.app` |

### 可审查的 CloudBase 模板（不执行部署）

仓库提供 [语音就绪 CloudBase 模板](../infra/cloudbase/cloudbaserc.voice-ready.template.json)。它固定使用现有的 `backend/api/Dockerfile`、服务名 `talk-and-talk-api`、端口 `3000`、高可用模式和至少一个常驻实例；因此不会把启用语音的服务误配成缩到 0。

在本地运行下列只读校验：

```bash
cd backend/api
npm run verify:cloudbase-template
```

模板中的 `__REPLACE_WITH_CLOUDBASE_ENV_ID__` 不是可部署的真实环境。发布负责人必须在受控 CI 工作目录或 CloudBase 控制台外部配置中生成实际 `cloudbaserc.json`，再填入 staging / production 的环境 ID；真实清单已被 `.gitignore` 排除，不能提交。模板故意不含 `envVariables`，所有运行时变量和密钥仍只进入 CloudBase 的加密环境变量/密钥管理。

模板校验也**不会**登录 CloudBase、创建环境、上传镜像、执行迁移或开启公网入口。每个环境的公网域名、VPC、加密变量和流量策略仍需由有权限的发布负责人在控制台逐项复核。

环境变量直接依据 `.env.staging.example` 与 `.env.production.example` 配置到云托管的加密变量中。至少补齐：

- `DATABASE_URL`、`REDIS_URL`
- `JWT_ACCESS_SECRET`、`JWT_REFRESH_SECRET`
- `AUTH_IDENTITY_TOMBSTONE_HMAC_KEYS`、`AUTH_IDENTITY_TOMBSTONE_ACTIVE_KEY_ID`、`AUTH_IDENTITY_REREGISTRATION_POLICY=after_tombstone_expiry`；换钥时保留所有仍覆盖有效墓碑的旧密钥
- `WECHAT_MINIPROGRAM_APP_ID`、`WECHAT_MINIPROGRAM_APP_SECRET`
- `WECHAT_PAY_*`；CloudBase 优先把 PEM 配到加密环境变量 `WECHAT_PAY_PRIVATE_KEY`，本地容器也可挂载文件并使用 `WECHAT_PAY_PRIVATE_KEY_PATH`
- 实时语音已验收后才配置 `TRTC_*` 与 `TENCENTCLOUD_*`；默认保持 `TRTC_ENABLED=false`、`TRTC_ROOM_CONTROL_ENABLED=false`、`TRTC_EMERGENCY_STOP_ENABLED=false`。TRTC SDK 密钥和 CAM 密钥都只放云托管加密变量，绝不进入小程序包。
- `WECHAT_PAY_NOTIFY_BASE_URL`
- `CORS_ORIGINS`、`APP_ENV`、`SEED_ON_STARTUP=false`

部署前在本地副本上执行严格检查（不会打印密钥值）：

```bash
cd backend/api
npm run preflight:deployment -- .env.production
```

商户私钥只能存在于后端机密配置中，不得提交到仓库或放进小程序包。`WECHAT_PAY_PRIVATE_KEY` 支持真实换行或字面量 `\n`；它与 `WECHAT_PAY_PRIVATE_KEY_PATH` 二选一即可。CloudBase 服务设置原生支持环境变量，因此云托管推荐前者；Compose 的本地/自建部署可继续使用后者。

若云托管绑定 VPC 后关闭默认公网出向，需要配置 NAT 网关。否则后端无法访问 `api.weixin.qq.com`、微信支付 API、Apple JWKS 或内容审核提供商；启用实时语音后还要允许后端访问 `https://trtc.tencentcloudapi.com/`，以便在退款、服务结束和紧急清场时调用服务端关房接口。

## 小程序启用 callContainer

1. 在微信/CloudBase 控制台把真实小程序 AppID 与 staging、production 环境关联。
2. 在 `frontend/miniprogram/utils/config.ts` 填入三个环境对应的 CloudBase 环境 ID。
3. 先只把 `develop`、`trial` 的 `USE_CLOUD_RUN` 改为 `true`，完成体验版验证。
4. 体验版全部通过后，再启用 `release`。
5. `project.config.json` 的 `touristappid` 改为真实 AppID；AppSecret 只配置在后端。

公网 HTTPS 入口仍需保持，因为 iOS 和微信支付回调不使用 `callContainer`。

## 上线验收顺序

1. 云托管发布 staging，确认 migration 执行成功，`/api/v1/health` 的 database/redis 均为 `ok`。
   同时检查 `/api/v1/auth/wechat/mini-program/status` 为 `configured=true`，`/api/v1/payments/status` 与目标环境一致。
2. 对 staging 公网域名运行后端 smoke；确认 iOS 能登录并读取真实数据。
3. 小程序体验版启用 `callContainer`，关闭开发工具的域名跳过校验。
4. 真机执行：首次 `wx.login`、刷新令牌、个人资料、发现、下单、聊天、举报、通知。
5. 使用已绑定小程序 AppID 的商户号完成一笔小额 JSAPI 支付，检查支付回调、订单履约和退款。
6. 实时语音启用前，执行 [实时语音上线核对表](./realtime-voice-release-checklist.md) 的两台真机步骤；特别验证退款、服务完成和紧急清场会让已入房用户退出。
7. 检查云托管日志中没有 AppSecret、session_key、JWT、手机号、支付私钥、TRTC SDK 密钥、CAM 密钥、`UserSig` 或 `PrivateMapKey` 泄露。
8. production 先灰度发布；健康检查和关键链路通过后再切换 100% 流量。
9. 切流前执行 `./backend/api/scripts/production-smoke.sh https://api.talkandtalk.app`，不得接受 degraded 依赖或 Mock/Disabled 支付 provider。

## 当前外部阻塞

仓库没有真实小程序 AppID/AppSecret、CloudBase 环境 ID、已备案域名控制权、商户号与证书。因此本地可以证明代码、契约和两种传输都工作，但不能替代控制台关联、官方开发者工具编译和真机支付验收。
