# 原小程序浏览器容器

这个目录不实现第二套业务界面。`build.mjs` 从 `../miniprogram` 读取现有 31 个页面、18 个组件，使用微信官方开源 glass-easel 编译 WXML、WXSS、TypeScript，再输出到 `../web/public/mini`。

- 手机显示完整宽度；电脑使用 430px 竖屏容器。
- 页面业务 TypeScript 和 WXSS 直接来自小程序；不修改原小程序目录。
- 编译时只适配页面样式隔离、内联 rpx 单位、基础控件注册，以及自定义组件转发 tap 时的重复冒泡。
- 浏览器基础控件、导航栈、生命周期和平台接口位于 `primitives.mjs`、`platform.cjs`。
- 真实数据仍由现有腾讯云后端提供。登录复用现有同域 BFF，真实凭证只存于 HttpOnly Cookie。原逻辑看到的会话标记不是访问令牌，不能用于调用后端。
- 测试口令不会写入浏览器代码或构建产物。浏览器协议收据的服务端来源记为 `web`。
- 微信支付、微信订阅消息、实时语音不是浏览器容器自动获得的能力。未接入的功能返回明确失败，不模拟支付成功或微信授权。

## 本地运行

安装依赖后执行 `npm run build`。在仓库根目录运行已有 `node scripts/run-partner-web.mjs dev --host 127.0.0.1 --port 3025`，打开 `http://localhost:3025/mini/index.html`。

`node smoke.mjs` 使用独立测试浏览器验证原页面、协议、账号、输入、导航和聊天；需要本地已配置的合伙人测试账号。`PLAYWRIGHT_MODULE` 可指定 Playwright 安装位置。

构建输出的 `source-manifest.json` 记录每个原始文件的 SHA-256，可与小程序目录逐个比对。编译成功不等于所有业务功能完成验收；实际通过项以 `artifacts/delivery/miniprogram-browser/smoke-report.json` 为准。
