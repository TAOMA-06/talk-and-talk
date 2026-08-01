# App Store Connect 元数据（v0.1 提交稿）

> **历史/后续 iOS 提交草稿，不属于当前微信小程序商用发行。** 不得用本文的账号、流程或旧客户端能力证明当前放行；若未来重新启动 iOS 发布，须按当期客户端、隐私文本和真实环境重新验收。当前发行真相见 [生产检查清单](./production-checklist.md)。

材料齐备清单，**不代替**在 App Store Connect 中实际上传。  
域名以正式环境为准；staging 仅用于内部 TestFlight。

## 基本信息

| 字段 | 建议值 |
|------|--------|
| App 名称 | Talk&Talk |
| 副标题 | 女性友好的线上陪伴 |
| Bundle ID | `com.talkandtalk.app` |
| 主语言 | 简体中文 |
| 类别 | 社交 / 生活（择一主类） |
| 年龄分级 | 17+（社交互动、用户生成内容、付费） |

## 描述（可粘贴）

**Talk&Talk** 提供线上情绪倾听、职场减压与睡前陪伴等沟通服务。所有沟通在平台内完成，支持内容安全审核与举报，禁止引导私联与线下交易。

主要功能：

- 手机号 / Apple 登录
- 发现与了解陪伴者
- 下单与支付状态查询
- 平台内聊天与安全提醒
- 订单、通知与账号设置

不提供医疗诊断、线下见面撮合或担保线下安全。

## 关键词（示例，注意长度限制）

`陪伴,倾听,情绪,聊天,线上,安全,减压`

## 截图建议（5.5" / 6.7"）

按顺序各一组：

1. 登录页  
2. 发现 / 陪伴者列表  
3. 陪伴者详情  
4. 聊天（正常消息 + 可截安全提示 UI，勿含真实隐私）  
5. 订单列表  

## 法律链接

部署 API 后默认可访问（nginx 反代到 API 静态资源）：

| 文档 | URL |
|------|-----|
| 隐私政策 | `https://api.talkandtalk.app/legal/privacy.html` |
| 用户协议 | `https://api.talkandtalk.app/legal/terms.html` |

Staging：`https://api-staging.talkandtalk.app/legal/...`

App 内设置页同步展示全文，并可打开上述 URL。

## 支持与营销

| 字段 | 占位 |
|------|------|
| 技术支持 URL | `https://api.talkandtalk.app/legal/terms.html`（正式站点上线后替换） |
| 营销 URL | 可选，正式官网 |

## 测试账号（审核备注用）

**Staging / 审核包若指向 staging：**

| 项 | 值 |
|----|-----|
| 手机号 | `13800138000`（或审核专用号） |
| 验证码 | `SMS_PROVIDER=mock` 时见 API 日志；勿对审核员写死生产码 |
| Apple | 使用审核员自己的 Apple ID 测试 Sign in with Apple |
| Staff（勿给审核） | 独立 Web 后台密码 + TOTP；不得向小程序审核员提供 |

若审核包指向 production 且 SMS 为 `none`，审核备注必须说明 **仅支持 Apple 登录**。

## 审核备注（模板）

```text
Talk&Talk 是线上陪伴沟通 App。审核账号请使用「Sign in with Apple」，或联系我们获取 staging 短信登录说明。

核心路径：登录 → 发现 → 选择陪伴者 → 下单 → 支付（若环境为 mock/沙箱会自动模拟成功）→ 进入聊天。

内容安全：聊天消息只由服务端本地规则与授权人工复核处理；用户原文不会发送给 DeepSeek 或其他外部生成式 AI，边界或高风险内容不会自动公开。
账号注销：通过应用内账号与隐私入口提交；申请状态和处理结果须以当期客户端实际验收为准。

不提供线下见面；社区广场在本版本可能数据较少/本地能力有限。
后端需可达：Release 默认 https://api.talkandtalk.app
```

## 隐私营养标签（摘要）

可能收集并用于 App 功能：

- 联系信息（手机号）
- 用户内容（聊天、举报说明）
- 购买信息（订单）
- 标识符（设备 / 账号 ID）

不用于第三方追踪广告（当前无 ATT 追踪实现）。提交前按实际 SDK（含微信）在 App Store Connect 再核对。

## 导出合规

工程配置 `ITSAppUsesNonExemptEncryption = NO`（仅 HTTPS 标准加密）。若后续引入自定义加密需重新评估。

## Archive 操作说明

1. 仅打开 `frontend/ios/TalkAndTalk.xcodeproj`（修改 `project.yml` 后先 `xcodegen generate`）。
2. Xcode → Signing & Capabilities → 选择 **Team**（`DEVELOPMENT_TEAM` 可写在 `Config/Shared.xcconfig`）。
3. 确认 `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION`（当前 0.1.0 / 1）。
4. 填写 `WECHAT_APP_ID`（Shared.xcconfig）后 Product → Archive。
5. 若本机 codesign 报 `resource fork / Finder information`：对产物与资源执行 `xattr -cr` 后 Clean Build Folder 再试。
6. 真机 Archive 需有效 Apple Developer 证书与描述文件；本仓库不提交 Team ID。
