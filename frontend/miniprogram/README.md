# Talk&Talk 微信小程序

原生 TypeScript 小程序，复用 `backend/api` 的 `/api/v1` 契约；不包含管理后台。核心能力包括微信登录、发现、广场、订单和 JSAPI 支付、站内聊天/举报、评价、通知，以及已审核陪伴者的服务状态流转。首发不开放自助入驻。

## 本机后端联调（微信开发者工具）

**不要编辑** [`utils/config.ts`](./utils/config.ts) 或 [`project.config.json`](./project.config.json)。这两个受发行门禁保护，必须始终使用 production HTTPS 地址和 `urlCheck: true`。

当本机 API 已启动在 `http://127.0.0.1:3000` 时，从仓库根目录生成独立的开发者工具副本：

```bash
node frontend/miniprogram/scripts/create-local-copy.mjs \
  --api-base-url http://127.0.0.1:3000/api/v1
```

随后在微信开发者工具中**导入 `frontend/miniprogram-local`，而不是原始的 `frontend/miniprogram`**。生成副本会：

- 将 API 与协议页切换到本机后端；
- 仅在 HTTP 本机/私网地址时设置 `urlCheck: false`；
- 使用 `talk-and-talk-local-do-not-upload` 工程名，并写入明显的“不可上传”说明；
- 不复制 AppID、`project.private.config.json`、`miniprogram_npm` 或任何服务器机密；
- 被 Git 忽略。重复执行命令只会替换此前由该脚本生成的副本，绝不改动正式源目录。

`127.0.0.1` 指向运行开发者工具的这台 Mac，因此该模式只用于桌面开发者工具联调。真机无法访问它；真机/体验版必须使用已配置合法域名的 HTTPS staging 地址，例如：

```bash
node frontend/miniprogram/scripts/create-local-copy.mjs \
  --api-base-url https://api-staging.example.com/api/v1
```

HTTPS staging 副本会保留 `urlCheck: true`。脚本拒绝把公共 HTTP 地址写入开发副本，也拒绝 URL 中的账号、密码、查询参数或片段。

仓库不保存 AppID；CI 只使用 `WECHAT_MINIPROGRAM_APP_ID` 做发行结构门禁，不生成签名包或自动上传。开发者工具内的本机请求不替代真实微信登录、真实支付回调、体验版上传或真机验收。

提交前可在仓库根目录运行：

```bash
node frontend/miniprogram/scripts/validate.mjs
backend/api/node_modules/.bin/tsc -p frontend/miniprogram/tsconfig.json --noEmit
node frontend/miniprogram/scripts/smoke.mjs
```

第一条检查页面注册、首次协议门槛、法律文件入口、前后端性别枚举、HTTPS API 和客户端密钥泄露；第二条检查全部 TypeScript；第三条会加载编译后的页面，模拟首次同意、微信登录、正式 API envelope、预约下单、订单、会话/消息，以及 mock 与真实 `wx.requestPayment` 分支。开发环境缺少 AppID 只警告；发行门禁使用 `MINIPROGRAM_RELEASE=1`，缺少有效的外部 AppID 会失败。

生成副本的隔离与反向发行校验可单独验证：

```bash
node frontend/miniprogram/scripts/test-local-build.mjs
```

该测试会在系统临时目录生成本机与 HTTPS staging 副本，确认原始 production 文件未被改动，并确认发行校验会拒绝本机 HTTP 副本。

## 上线前配置

- 后端填写 `WECHAT_MINIPROGRAM_APP_ID` 和 `WECHAT_MINIPROGRAM_APP_SECRET`；AppSecret 只保存在服务器环境变量中。
- 在 GitHub Actions 仓库变量中填写公开标识 `WECHAT_MINIPROGRAM_APP_ID`。项目文件保持空 AppID，禁止提交真实 AppID 或任何 AppSecret。
- 将小程序 AppID 绑定到微信支付商户号，并完成 JSAPI 支付权限开通；后端复用既有商户证书和回调地址。
- 在小程序后台配置隐私政策，隐私链接使用 `https://api.talkandtalk.app/legal/privacy.html`；将 `https://api.talkandtalk.app` 同时配置为业务域名，确保小程序内的用户协议和隐私政策 `web-view` 可打开。首次同意前不会登录或请求 API，聊天和支付还会调用平台隐私授权接口。
- 上传前只允许导入原始 `frontend/miniprogram`，并在真机验证微信登录、真实小额支付、退款、订单会话与审核提示；禁止上传 `frontend/miniprogram-local`。
- 当前发行步骤是：官方微信开发者工具导入目录 → 选择真实 AppID → 关闭“不校验合法域名” → 编译/预览 → 上传体验版 → 真机验收 → 提交审核。未配置 `miniprogram-ci` 私钥前，GitHub Actions 的绿灯不能替代这条签名上传链路。

## 设计约束

- 微信账户首发独立于 Apple 账户；服务端不会按昵称、手机号或 UnionID 自动合并。
- 客户端不保存 AppSecret、微信支付商户私钥或任何支付签名原文之外的调起参数。
- 支付成功以微信服务端回调更新订单为准；小程序支付完成后只刷新订单状态。
