# WeChat Developer Tools 会话注入交接

本轮不操作 Developer Tools GUI。已准备两种等价的开发期注入方式，token、手机号和验证码只存在 `/private/tmp`。

## 运行时文件

- 本地项目：`/var/folders/pz/sz1jvfhx5m3fsqc7j3f63rwm0000gn/T/talktalk-miniprogram-full-20260828-ea11230f-project`
- 会话：`/private/tmp/talktalk-miniprogram-full-20260828-ea11230f/runtime/customer-session.json`
- 精确 storage payload：`/private/tmp/talktalk-miniprogram-full-20260828-ea11230f/runtime/devtools-storage-payload.json`

两个 JSON 权限均应为 `0600`。不要复制到截图、录屏、仓库或聊天。

## 支持的自动注入

在主代理已用 Developer Tools 打开上述本地项目、并开启自动化端口后执行：

```bash
env \
  MINIPROGRAM_AUTOMATOR_ROOT=/private/tmp/talktalk-miniprogram-automator \
  MINIPROGRAM_AUTOMATION_PORT=<DevTools automation port> \
  DEMO_RUNTIME_DIR=/private/tmp/talktalk-miniprogram-full-20260828-ea11230f \
  node "/Users/taoma/Documents/talk and talk/artifacts/practical-demo/miniprogram-full-scenarios-20260828/verification/inject-devtools-session.mjs"
```

脚本通过官方 `miniprogram-automator` 通道逐项调用：

```text
wx.setStorageSync("talkandtalk.accessToken", ...)
wx.setStorageSync("talkandtalk.refreshToken", ...)
wx.setStorageSync("talkandtalk.user", ...)
wx.setStorageSync("talkandtalk.legalConsent", ...)
```

## 手工控制台注入

若不启用 automator，只能在 Developer Tools 调试控制台读取临时 payload 后逐项执行同样的 `wx.setStorageSync`。不要在录屏开始后打开或打印 payload。

注入后重新编译或重新进入首页，先确认 `GET /api/v1/me` 与 `GET /api/v1/support/tickets/me` 成功，再开始录制。
