# Talk&Talk 微信小程序

原生 TypeScript 小程序，复用 `backend/api` 的 `/api/v1` 契约；不包含管理后台。核心能力包括微信登录、发现、广场、订单和 JSAPI 支付、站内聊天/举报、评价、通知，以及陪伴者申请和服务状态流转。

## 本地打开

1. 在微信开发者工具导入本目录；开发期可使用 `touristappid`，联调前在工具中选择实际小程序 AppID。
2. [`utils/config.ts`](./utils/config.ts) 会让开发版/体验版使用 staging、正式版使用 production；如已创建微信云托管环境，可填入环境 ID 并启用 `callContainer`。
3. 在小程序后台配置 request/upload/download 合法域名，并填写隐私保护指引。生产使用 `https://api.talkandtalk.app`。

提交前可在仓库根目录运行：

```bash
node frontend/miniprogram/scripts/validate.mjs
backend/api/node_modules/.bin/tsc -p frontend/miniprogram/tsconfig.json --noEmit
node frontend/miniprogram/scripts/smoke.mjs
```

第一条检查页面注册、WXML 事件绑定、跳转目标、HTTPS/云托管传输和客户端密钥泄露；第二条检查全部 TypeScript；第三条会加载编译后的页面，模拟微信登录、正式 API envelope、预约下单、订单、会话/消息、mock 支付，并验证 `wx.request` 与 `wx.cloud.callContainer` 两条入口。CI 会执行相同门禁。

## 上线前配置

- 后端填写 `WECHAT_MINIPROGRAM_APP_ID` 和 `WECHAT_MINIPROGRAM_APP_SECRET`；AppSecret 只保存在服务器环境变量中。
- 推荐把现有 Docker 后端部署到微信云托管容器，PostgreSQL/Redis 放在同一 VPC；完整选型与验收见 [`docs/wechat-backend-selection.md`](../../docs/wechat-backend-selection.md)。
- 将小程序 AppID 绑定到微信支付商户号，并完成 JSAPI 支付权限开通；后端复用既有商户证书和回调地址。
- 在小程序后台配置隐私政策，隐私链接使用 `https://api.talkandtalk.app/legal/privacy.html`；涉及聊天和支付的操作会调用平台隐私授权接口。
- 上传前恢复 `utils/config.ts` 为 production 域名，并在真机验证微信登录、真实小额支付、退款、订单会话与审核提示。

## 设计约束

- 微信账户首发独立于 Apple 账户；服务端不会按昵称、手机号或 UnionID 自动合并。
- 客户端不保存 AppSecret、微信支付商户私钥或任何支付签名原文之外的调起参数。
- 支付成功以微信服务端回调更新订单为准；小程序支付完成后只刷新订单状态。
