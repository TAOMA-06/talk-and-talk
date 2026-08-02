# Talk&Talk Web

Talk&Talk 的响应式网站客户端。普通用户与陪伴者共用同一套账号和导航；陪伴者登录后会在个人中心看到工作台入口，并可在用户视角与接单视角之间切换。

## 已接入能力

- 公开发现页、主题筛选、陪伴者资料与真实可约时间
- 手机验证码登录、法律同意回执与 HttpOnly 会话
- 预约创建、用户订单、广场、平台内消息与通知
- 陪伴者资料、服务商品、可约时段与服务订单工作台
- 安全规则、协议入口、举报与售后边界说明
- 服务端代理后端 API，浏览器不保存访问令牌

## 本地运行

需要 Node.js `>=22.13.0`。

```bash
cp .env.example .env.local
cp .dev.vars.example .dev.vars
npm install
npm run dev
```

默认连接正式 API。Cloudflare/Vinext 本地运行时通过 `.dev.vars` 读取服务端绑定；需要连接本地或预发布环境时，修改：

```dotenv
TALKTALK_API_BASE_URL=http://127.0.0.1:3101/api/v1
```

## 交付验证

```bash
npm run check
```

该命令会完成严格类型检查、代码规范检查、生产构建、多路由服务端渲染和 BFF 安全边界验证，并确认初始化占位内容已经完全移除。

真实后端联调使用独立的开发 API、PostgreSQL 与 Redis，启动连接本地 API 的网页后执行：

```bash
WEB_BASE_URL=http://127.0.0.1:3010 \
API_BASE_URL=http://127.0.0.1:3101/api/v1 \
npm run test:integration
```

该测试通过网站的 HttpOnly 会话与服务端代理完成公开资料、网页法律同意、普通用户与陪伴者双角色登录、工作台、预约确认、微信 Native Pay 模拟回调、双向消息、退款和退出登录。仅可指向 `APP_ENV=development` 的隔离环境。

## 上线注意

- 后端必须先执行 `20260727213000_add_web_legal_consent_source` 数据库迁移。
- 正式 API 地址默认为 `https://api.talkandtalk.app/api/v1`，也可通过环境变量覆盖。
- 正式支付使用微信 Native Pay 扫码通道；商户后台需为当前 AppID/商户号开通 Native 支付。
