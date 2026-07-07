# Talk&Talk 项目指引

> **新人 / 协作者 / AI 助手请先读本文**，再改代码或回答问题。  
> 若只关心怎么跑 demo，见 [README.md](./README.md)；老板演示脚本见 [BackendDemo/DEMO.md](./BackendDemo/DEMO.md)。

---

## 1. 这是什么产品？

**Talk&Talk** 是一个「女性友好的线上陪伴服务」平台 demo（类似：情绪倾听、职场减压、睡前陪伴等 **纯线上** 服务）。

核心约束（产品红线）：

- 所有沟通必须在 **平台内** 完成
- **禁止** 引导私联（微信/电话）、线下见面、私下转账
- 需要 **内容安全审查**，保护用户（尤其女性用户）不被骚扰、诱骗或引流到平台外

当前仓库是 **演示用代码**，不是生产环境：支付、实名、数据库多为本地 mock，但 **内容审查链路是真实可跑的**。

---

## 2. AI 识别是干什么的？（必读）

### 业务目的

当用户在 App 里 **发聊天消息** 或 **发社区帖子** 时，系统要自动判断这条内容是否违规，并决定：

| 决策 | 含义 | 对用户的表现 |
|------|------|----------------|
| **allow** | 正常内容 | 消息正常发出 |
| **review** | 疑似广告/边界内容 | 先发出去，进入人工复核队列 |
| **warn** | 隐私索取、轻度越界 | 发出 + 安全提醒，可能扣安全分 |
| **block** | 高风险（私联/线下/转账等） | **拦截不发**，显示安全提醒，生成审核工单 |

**AI（DeepSeek）的作用**：在规则引擎之后，对 **边界模糊** 的文案做补充判断（例如「代理兼职」「变相邀约」），提高准确率；**高风险关键词** 仍由规则直接 block，不依赖 AI。

### 不是什么

- **不是** 通用聊天机器人（陪伴者回复是 demo 里的固定话术/后端简单回复）
- **不是** 人脸识别、图片审核（当前只做 **文本**）
- **不是** 替用户自动聊天，而是 **审查用户发出的文字是否违反平台规则**

### 一句话给外部协作者

> 「AI 识别 = 平台的内容安全员：自动读用户发的文字，拦住私联/线下/转账，把拿不准的交给人工在审核后台处理。」

---

## 3. 仓库里有哪些部分？

```
talk-and-talk/
├── Sources/              # iOS App（SwiftUI，主前端）
├── BackendDemo/          # 本机 Node 后端 + Web 审核后台
├── Tests/                # iOS 单元测试
├── project.yml           # XcodeGen 配置
├── TalkAndTalk.xcodeproj # 用 xcodegen generate 生成
├── GUIDE.md              # 本文
├── README.md             # 构建与双端演示快速入口
├── review.md             # iOS 代码逐文件说明（偏细，部分描述已过时）
└── Archive/              # 旧实验（H5、旧 Swift 结构），勿当主工程
```

| 模块 | 技术 | 当前状态 |
|------|------|----------|
| **iOS App** | SwiftUI, iOS 18+ | 发现/下单/社区等多为本地 mock |
| **BackendDemo** | Node 22, 无 npm 依赖 | 聊天 API + 审查 + Web 管理台 |
| **Web 审核后台** | `BackendDemo/public/index.html` | 工单队列、违规示例、会话证据、样本标注 |
| **AI 审查** | DeepSeek API + 规则引擎 | 配置在 `BackendDemo/.env` |

---

## 4. 三端怎么协作？

```text
┌─────────────────┐     HTTP API      ┌──────────────────────┐
│  iOS App        │ ────────────────► │  BackendDemo         │
│  (用户发消息)    │ ◄──────────────── │  (审查 + 存会话)      │
└─────────────────┘                   └──────────┬───────────┘
                                                 │
                                    同一进程内    │  GET 工单/消息
                                                 ▼
                                      ┌──────────────────────┐
                                      │  Web 审核后台           │
                                      │  localhost:8787         │
                                      │  (管理员看工单、处置)    │
                                      └──────────────────────┘
```

### 已接后端的能力（iOS ↔ BackendDemo）

仅 **林屿 / 许澈 / 周映**（陪伴者 ID：`c1` / `c2` / `c3`）的聊天：

- 进入聊天页 → 从后端拉历史消息
- 用户发消息 → `POST /api/conversations/:id/messages`
- 后端做规则 + DeepSeek 审查 → 返回是否拦截、安全提醒、陪伴者回复
- 违规会写入后端内存里的 **审核工单**，Web 后台刷新可见

相关代码：

- iOS：`Sources/Services/BackendConfig.swift`、`BackendDemoClient.swift`，`AppStore.sendMessageViaBackend`
- 后端：`BackendDemo/src/server.js` 的 `moderateText()`、`deepseekModeration()`

### 仍是本地 mock 的能力

- 其他陪伴者（`c4`/`c5`）、社区私信
- 订单、支付、实名（除演示流程外）
- 社区发帖审查（iOS 本地 `HybridModerationService`，未走后端）

---

## 5. 内容审查技术流程

```text
用户文本
   │
   ▼
规则引擎（关键词：加微信、线下、转账…）
   │
   ├─ 命中 block ──► 直接拦截，不调 AI
   │
   └─ 其他 ──► DeepSeek API（风险分 0~1）
                 │
                 ▼
           与规则分取 max → allow / review / warn / block
                 │
                 ▼
           写消息 / 安全提醒 / 审核工单
```

配置：

- `BackendDemo/.env` → `DEEPSEEK_API_KEY`
- 离线/测试：`DISABLE_DEEPSEEK=1 npm start`（仅规则）

---

## 6. 五分钟上手

### 启动后端

```bash
cd BackendDemo
cp .env.example .env    # 填入 DEEPSEEK_API_KEY
npm start
```

浏览器打开 http://localhost:8787 → Web 审核后台。

### 启动 iOS（模拟器）

1. `open TalkAndTalk.xcodeproj`
2. 运行 `TalkAndTalk` scheme
3. 消息 Tab → 打开 **林屿** 聊天
4. 顶部应显示 **「后端已连接 · deepseek-chat」**

### 验证审查是否工作

| 在 iOS 发送 | 预期 |
|-------------|------|
| `今天有点累` | 正常发出 + 陪伴者回复 |
| `我们加微信聊吧` | 拦截 + 安全提醒；Web 后台出现 block 工单 |

### 跑测试

```bash
# 后端
cd BackendDemo && npm test

# iOS（需 Xcode）
xcodebuild test -scheme TalkAndTalk \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5' \
  -only-testing:TalkAndTalkTests
```

---

## 7. 常见误区（给 AI 助手）

| 误区 | 正确理解 |
|------|----------|
| 「整个 App 都接了后端」 | 只有 c1/c2/c3 聊天接 BackendDemo |
| 「AI 是陪用户聊天的」 | AI 只负责 **审查** 用户输入是否违规 |
| 「在根目录 npm start」 | 必须在 **`BackendDemo/`** 目录下启动 |
| 「Ollama 本地模型」 | 已移除，现用 **DeepSeek API** |
| 「review.md 说完全本地」 | 已过时；以本文和 README 为准 |

---

## 8. 文档索引

| 文档 | 用途 |
|------|------|
| [GUIDE.md](./GUIDE.md) | 项目定位、AI 审查目的、架构（本文） |
| [README.md](./README.md) | 构建 iOS、双端演示命令 |
| [BackendDemo/README.md](./BackendDemo/README.md) | 后端 API、环境变量 |
| [BackendDemo/DEMO.md](./BackendDemo/DEMO.md) | 给老板演示的逐步脚本 |
| [review.md](./review.md) | iOS 源码逐文件导读（细节多，架构以 GUIDE 为准） |

---

## 9. 改代码时建议动哪里？

| 需求 | 建议修改位置 |
|------|----------------|
| 调整违规关键词 / 规则 | `BackendDemo/src/server.js` → `blockRules` / `warnRules`；iOS 侧 `RuleBasedModerationEngine.swift` |
| 换 AI 模型或 prompt | `BackendDemo/src/server.js` → `deepseekModeration()` |
| iOS 接更多会话 | `BackendConfig.supportedCompanionIds` + 后端 `initialState` 会话数据 |
| 审核后台 UI | `BackendDemo/public/index.html` |
| 演示脚本/话术 | `BackendDemo/DEMO.md` |

改完审查逻辑后，用「正常 / 违规 / 边界」三条文案各测一次（见第 6 节）。
