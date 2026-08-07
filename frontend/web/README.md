# Talk&Talk Web

Talk&Talk 官方网站。公共面负责品牌、产品说明、安全与公示，以及把访客可靠地导流到微信小程序；**不作为**真实预约、支付、聊天或售后完成面的证据。

延期 Web App（发现、登录、订单、消息、社区、资料、工作台）与 BFF/session 代码保留，仅在隔离开发中可选启用；生产候选必须用 surface policy 真实禁用（feature flag / 404 / 拒绝），不能只靠 `robots` / `noindex`。

## 产品责任（G0）

| 面 | 责任 |
|---|---|
| 公共营销路由 `/` `/how-it-works` `/safety` `/about` `/partners` | 官网交付 |
| `/business` `/demo` | 默认私密；需 `WEB_ENABLE_PRIVATE_SURFACES=true` 或非生产候选 |
| `/discover` `/login` `/community` `/orders` `/messages` `/profile` `/workbench` `/companions/*` | 生产暂停的延期 Web App |
| `/api/session/*` `/api/backend/*` | 仅隔离开发联调 |

生产候选默认 fail-closed：`NODE_ENV=production` 即锁定延期交易面与 BFF。
也可显式设置：

```dotenv
WEB_SURFACE_MODE=production
```

本地 HTML/联调需要延期面时再打开：

```dotenv
WEB_SURFACE_MODE=open
```

隔离开发启用延期交易面时，还需要：

```dotenv
WEB_SURFACE_MODE=development
WEB_ENABLE_DEFERRED_SURFACES=true
TALKTALK_API_BASE_URL=http://127.0.0.1:3101/api/v1
```

禁止在生产候选中把 `TALKTALK_API_BASE_URL` 指向正式 API 后打开延期面，除非另有 `WEB_ALLOW_PRODUCTION_API` 的精确授权。

## 小程序入口

可选环境变量：

- `NEXT_PUBLIC_MINIPROGRAM_PATH`：allowlist 协议（`weixin:` / `https:`）
- `NEXT_PUBLIC_MINIPROGRAM_QR_URL`：allowlist HTTPS 主机
- `NEXT_PUBLIC_MINIPROGRAM_SEARCH_NAME`：配置缺失时的诚实搜索 fallback（默认 `Talk&Talk`）

## 本地运行

需要 Node.js `>=22.13.0`。

```bash
cp .env.example .env.local
cp .dev.vars.example .dev.vars
npm install
npm run dev
```

Cloudflare/Vinext 本地运行时通过 `.dev.vars` 读取服务端绑定。默认不要把生产候选开关打开。

## 交付验证

```bash
npm run check
```

该命令会完成严格类型检查、代码规范检查、surface policy 单测、生产构建和渲染验证。

生产候选拒绝证据由 `tests/web-surface-policy.test.mjs` 驱动已上线的 `lib/web-surface-policy.ts`（`WEB_SURFACE_MODE=production`）。

真实后端联调使用独立的开发 API、PostgreSQL 与 Redis，并显式打开延期面开关：

```bash
WEB_BASE_URL=http://127.0.0.1:3010 \
API_BASE_URL=http://127.0.0.1:3101/api/v1 \
npm run test:integration
```

仅可指向 `APP_ENV=development` 的隔离环境。

## 上线注意

- 生产候选：`WEB_SURFACE_MODE=production`；sitemap 仅含公共营销路径。
- 后端必须先执行需要的数据库迁移。
- 正式 API 地址默认为 `https://api.talkandtalk.app/api/v1`，官网生产候选不应代理交易写路径。
