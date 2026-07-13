# 微信小程序与 iOS 双端验证记录

更新时间：2026-07-13

## 当前已验证

| 验证项 | 结果 | 证据 |
|---|---|---|
| 小程序工程完整性 | 通过 | `scripts/validate.mjs` 验证 7 个页面、5 个 Tab、WXML 事件、页面跳转、HTTPS API 与客户端密钥边界 |
| 小程序 TypeScript | 通过 | `tsc --noEmit` 零错误；`project.config.json` 已启用 `typescript` 编译插件 |
| 小程序页面运行时烟测 | 通过 | 编译并加载页面模块，模拟 `wx.login`、正式 API envelope、发现/预约、广场、订单、会话/消息、profile、mock 支付，以及 HTTPS/Cloud Run 双传输 |
| 后端微信登录/JSAPI 支付 | 通过 | 27 个测试套件、109 项测试全部通过；包含控制器/DTO/就绪探针、code2Session、OpenID 身份、双支付通道、CloudBase 私钥注入、社区与评价 |
| 云端部署预检 | 通过 | 4 项预检测试覆盖完整生产配置、占位密钥、Redis 密码、JWT 隔离、微信支付字段和 staging Mock 策略 |
| 微信云托管代码适配 | 通过 | `develop/trial/release` 环境隔离、`wx.cloud.callContainer`、`X-WX-SERVICE` 与 `/api/v1` 路径已通过自动烟测 |
| iOS Debug | 通过 | iPhone 17 Pro / iOS 26.5 模拟器实际构建启动，运行时 UI 可见发现、广场、订单、消息、我的 5 个 Tab |
| iOS 单元测试 | 通过 | `TalkAndTalkTests` 52 项通过，0 失败 |
| iOS Release 编译 | 通过 | `TalkAndTalk` Release 模拟器构建成功，Apple 登录主线程隔离警告已清零 |
| 双端配置隔离 | 通过 | iOS 保持 `com.talkandtalk.app`、`WECHAT_APP_ID` 和独立 xcconfig；小程序使用 `WECHAT_MINIPROGRAM_*` 与独立工程目录 |

## 官方开发者工具验证状态

本次已获授权临时开启 CLI 服务端口，但官方 IDE 未能在当前 macOS 27 环境完成启动：

- 官方稳定版 `2.01.2510290`（ARM64/NW.js）即使使用软件渲染参数仍因 GPU 进程启动失败而退出。
- 官方版本接口提供的 Electron Nightly `2.02.2607102` 更适配新系统，但 ARM64 与 x64 安装包均未通过 macOS 安装器签名校验；为避免绕过系统信任，未安装该版本。
- 因 IDE 未启动，CLI 服务没有实际开启。收尾时 `cli islogin` 明确返回“工具的服务端口已关闭”，并在启用提示中选择 `No`。

因此，仓库级编译、类型检查、运行时烟测和双端回归均已通过，但不能把这些结果表述为“已通过微信开发者工具官方编译”。建议在受支持的稳定版 macOS，或微信发布签名有效的 Electron 稳定版后，补做官方 IDE 验证。

## 尚需真实微信环境证明

仓库没有真实小程序 AppID、AppSecret 或商户私钥，以下项目仍不能由本地模拟替代：

1. 在兼容的官方开发者工具中临时开启 CLI 服务端口，使用真实 AppID 执行官方编译、预览并在真机打开；完成后再次关闭服务端口。
2. 后端部署 migration 后，用真实 `wx.login` code 验证 code2Session。
3. 将已备案的 staging API 配成 request 合法域名，关闭“跳过域名校验”后回归所有请求。
4. 绑定商户号与小程序 AppID，完成一笔真实小额 JSAPI 支付、支付回调和退款。
5. 在小程序后台配置隐私保护指引并提交体验版审核。

这些是小程序正式发布前的外部验收门禁，不影响 iOS 工程继续独立开发和后续发布。具体真机步骤见 [staging-acceptance.md](./staging-acceptance.md)。
