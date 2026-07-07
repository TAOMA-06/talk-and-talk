# Talk&Talk

女性友好的线上陪伴服务 **演示工程**（iOS App + 本机后端 + Web 审核后台）。

**新人请先读 → [GUIDE.md](./GUIDE.md)**（产品是什么、**AI 内容识别干什么**、三端架构、常见误区）。

---

## 快速开始

### iOS App

```bash
open TalkAndTalk.xcodeproj
# Xcode → TalkAndTalk scheme → 模拟器运行
```

工程由 XcodeGen 生成：`xcodegen generate`

### 后端 + Web 审核后台

```bash
cd BackendDemo
cp .env.example .env   # 填入 DEEPSEEK_API_KEY
npm start
```

浏览器打开 http://localhost:8787

> 注意：后端在 **`BackendDemo/`** 目录，不要在仓库根目录执行 `npm start`。

---

## 仓库结构

| 路径 | 说明 |
|------|------|
| [GUIDE.md](./GUIDE.md) | **项目总指引**（必读） |
| `Sources/` | iOS SwiftUI 源码 |
| [BackendDemo/](./BackendDemo/) | Node 聊天/审查 API + 审核后台页面 |
| [BackendDemo/DEMO.md](./BackendDemo/DEMO.md) | 老板演示脚本 |
| `review.md` | iOS 代码逐文件说明（部分描述已过时，架构以 GUIDE 为准） |
| `Archive/` | 旧实验，非主工程 |

---

## 双端联调（iOS + 后端）

1. 终端启动 `BackendDemo`（见上）
2. Xcode 运行 iOS 模拟器
3. 打开与 **林屿 (c1)** 的聊天 → 应显示 **「后端已连接」**
4. 发 `我们加微信聊吧` → App 拦截；Web 后台刷新可见工单

模拟器默认后端地址：`http://127.0.0.1:8787`（可用 Scheme 环境变量 `BACKEND_BASE_URL` 覆盖）。

真机调试：将 `BACKEND_BASE_URL` 设为 Mac 局域网 IP，例如 `http://192.168.1.10:8787`。

---

## 当前能力边界

- **已接后端**：林屿/许澈/周映（`c1`/`c2`/`c3`）聊天 + 内容审查（规则 + DeepSeek）
- **本地 mock**：其他陪伴者、订单、支付、社区发帖等

部署目标：iOS 18+；iOS 26+ 使用 Liquid Glass API（低版本 Material 回退）。
