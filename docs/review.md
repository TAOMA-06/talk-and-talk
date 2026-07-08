# Talk&Talk iOS Demo 代码总览

> **架构与「AI 识别干什么」请以 [GUIDE.md](./GUIDE.md) 为准。** 本文档侧重 iOS 逐文件说明；其中「完全本地、不接后端」等描述已部分过时（c1/c2/c3 聊天现已接 BackendDemo）。

## 1. 项目概述

Talk&Talk 是一个面向 iOS 18+ 的 SwiftUI 前端演示应用，模拟“女性友好的线上陪伴服务”平台。当前版本完全本地运行，不连接真实后端、不采集真实身份、不发起真实支付。

核心功能：
- 发现陪伴者（按主题、距离、价格、在线状态筛选）
- 下单与平台内沟通（文字 + 模拟语音）
- 18+ 实名认证流程
- 社区发帖与审核
- 实时内容风控与信用分体系
- 安全中心与演示后台

项目结构由 `project.yml` 通过 XcodeGen 生成 `TalkAndTalk.xcodeproj`。

---

## 2. 根目录文件

| 文件/目录 | 作用 |
|---|---|
| `README.md` | 项目说明：如何打开、构建、当前结构说明。 |
| `project.yml` | XcodeGen 配置文件，定义应用、单元测试、UI 测试三个 target。 |
| `TalkAndTalk.xcodeproj` | 由 XcodeGen 生成的 Xcode 工程，可直接打开运行。 |
| `.gitignore` | 忽略 .DS_Store、.codegraph、DerivedData、xcuserdata、Archive 中的构建产物等。 |
| `Archive/` | 存放旧版本/实验性项目结构，仅作参考，不参与主工程编译。 |

---

## 3. Sources 源代码

### 3.1 入口与全局状态

#### `Sources/TalkAndTalkApp.swift`
应用入口。创建 `AppStore` 实例并通过 `environmentObject` 注入到 `ContentView`，供所有子视图共享状态。

#### `Sources/Models/Models.swift`
全应用的数据模型与枚举定义。包括：
- 导航/状态枚举：`AppTab`、`AppRoute`、`ListPreset`
- 业务枚举：`AvailabilityStatus`、`OrderStatus`、`AccountStatus`、`RiskLevel`、`ModerationDecision`、`ModerationSource`、`ModerationCaseStatus`、`CommunityModerationStatus`、`AdminAction`
- 模型：`User`、`Theme`、`Companion`、`Order`、`Review`、`Message`、`CommunityPost`、`ModerationCase`
- 风控与信用结构体：`ModerationResult`、`ModerationContext`、`AccountRestrictions`、`CreditEvent`、`AgreementPrompt`
- 平台协议文案：`PlatformAgreement`
- `Companion` 扩展：计算每小时价格与可用状态颜色。

#### `Sources/Stores/AppStore.swift`
核心状态管理器（`ObservableObject`），职责：
- 持有所有 `@Published` 状态：当前 tab、各 tab 导航路径、用户、陪伴者、订单、消息、社区帖子、风控工单、信用事件等。
- 提供基于 `MockData` 的本地示例数据。
- 实现页面导航 `navigate(_:)` 与返回根页 `popToRoot()`。
- 实现业务方法：下单 `createOrder`、实名 `verifyUser`、发消息 `sendMessage`、发帖 `submitCommunityPost`、评价 `submitReview`、举报 `report`、处理工单 `resolveModerationCase`。
- 集成 `HybridModerationService` 与 `CreditService`，在聊天/社区/举报时进行内容审核并更新安全分。
- 实现“两次提醒不扣分”的 warn 缓冲机制（`applyWarnGraceIfNeeded`）。

### 3.2 视图层（Views）

#### `Sources/Views/ContentView.swift`
应用主骨架。使用 `TabView` 包裹 5 个 `NavigationStack`，分别对应发现、社区、订单、消息、我的。通过 `.withRoutes()` 统一注册 `AppRoute` 导航目标。还负责以 sheet 形式弹出 `UserAgreementSheet` 协议提醒。

#### `Sources/Views/HomeView.swift`
发现页首页。包含：
- 顶部问候栏与实名状态胶囊
- 主视觉卡片（Hero）：文案、可用人数、CTA
- 智能匹配条：在线人数、快捷主题标签
- 主题轨道（ThemeRail）：横向滚动主题入口
- 推荐陪伴者列表（RecommendedCompanions）
- 工具栏入口：演示后台

#### `Sources/Views/CompanionListView.swift`
陪伴者列表页。支持：
- 按主题或列表预设进入（nearby / availableTonight / budgetFriendly）
- 过滤：全部、在线、已认证、附近、今晚可约、预算内
- 排序：推荐、距离、评分、价格
- 空状态提示

#### `Sources/Views/CompanionDetailView.swift`
陪伴者详情页。结构：
- `ProfileHero`：头像、名字、角色、状态、评分、标签、关键指标
- `TrustFoldSection`：可展开的“为什么信任她”
- `BoundaryNotice`：服务边界提示
- `BioPanel`：个人介绍、语言、可约时间、专长
- `ReviewPreview`：最近 3 条评价
- `BottomActionBar`：价格、举报、发起沟通
- `ReportSheet`：举报弹窗

#### `Sources/Views/OrderView.swift`
订单确认页。流程：
- 展示陪伴者头部信息
- 平台信任点（线上沟通 / 18+ / 平台担保 / 可举报）
- 实名门槛提示
- 选择沟通主题与时长
- 价格面板与规则同意开关
- 模拟支付后进入聊天

#### `Sources/Views/ChatView.swift`
聊天沟通页。功能：
- 消息气泡列表（区分当前用户/对方/系统/安全提醒）
- 顶部安全头：陪伴者信息、模拟语音通话开关、举报
- 输入框与发送按钮
- 风控反馈条、账号受限提示
- 模拟语音通话悬浮面板
- 结束沟通并跳转到评价

#### `Sources/Views/ReviewView.swift`
评价页。用户可对已完成订单打分（1-5 星）并填写评价内容，提交后显示成功面板并返回发现页。

#### `Sources/Views/OrdersView.swift`
订单列表页。展示所有本地模拟订单，支持根据订单状态进入沟通。

#### `Sources/Views/MessagesView.swift`
消息会话列表页。聚合所有有聊天记录的陪伴者，显示最后一条消息与时间。

#### `Sources/Views/CommunityView.swift`
社区页。包括：
- 归属感头图与社区氛围说明
- 审核中帖子区域
- 已审核帖子流（她的故事）
- 发布故事的 sheet：选择话题、输入内容、提交后经过内容审核

#### `Sources/Views/ProfileView.swift`
我的页面。包括：
- 用户面板：头像、姓名、实名状态
- 安全分面板：当前分数、等级、账号状态、最近信用变动
- 菜单面板：安全中心、实名认证、演示后台、平台规范
- Demo 说明

#### `Sources/Views/VerifyView.swift`
18+ 实名认证流程。分三步：
1. 身份年龄确认
2. 模拟人脸核验
3. 手机号与验证码绑定
完成后更新用户实名状态并提升基础安全分。

#### `Sources/Views/SafetyCenterView.swift`
安全中心。以可折叠卡片形式展示 5 大安全体系：
- 三层实名认证
- 平台担保交易
- 紧急安全机制
- 信用档案规则
- 保险兜底说明

#### `Sources/Views/AdminView.swift`
演示后台/风控控制台。展示：
- 待审工单、今日拦截、受限用户、AI 模式开关
- 审核队列列表
- 每条工单的 AI 分数、风险等级、处理按钮（确认违规 / 误报驳回 / 升级人工）

#### `Sources/Views/DesignSystem.swift`
设计系统基础库。定义：
- 间距 `DS.Space`、圆角 `DS.Radius`、动画时长 `DS.Motion`
- 字体辅助 `DSTypography`
- 全局颜色：`dsBackground`、`dsSurface`、`dsPrimary`、`dsSuccess`、`dsWarning`、`dsDanger` 等
- 通用组件：`DSCard`、`DSPrimaryButton`、`DSSecondaryButton`、`DSListRow`、`DSBadge`、`DSLoadingView`、`DSErrorView`、`DSToast`、`DSSectionHeader`、`DSInputField`

#### `Sources/Views/SharedViews.swift`
更上层的共享视图组件，很多是对 `DesignSystem.swift` 的别名或组合：
- `AppBackground`、`AppScaffold`：通用页面背景与滚动容器
- `SoftCard` / `GlassSurface` / `GlassPanel`：卡片别名
- `GlassCapsule`、`PrimaryActionButton`、`ModernHero`、`ActionDock`
- `CompanionAvatar`、`StatusPill`、`AvailabilityBadge`、`DistanceLabel`、`TrustMicroBadge`、`TagChip`
- `SectionHeader`、`EmptyStateView`
- `FlowLayout`：自定义流式布局
- `UserAgreementSheet`：用户协议弹窗，支持强制阅读倒计时
- `liquidGlass` 扩展占位：为 iOS 26+ Liquid Glass 预留的兼容方法（当前为空实现）

### 3.3 服务层（Services）

#### `Sources/Services/ModerationService.swift`
定义 `ModerationService` 协议：统一的内容审核接口。`ModerationScoring` 提供分数到决策/风险等级的映射，以及构造 `ModerationResult` 的工厂方法。

#### `Sources/Services/RuleBasedModerationEngine.swift`
本地规则引擎。包含：
- block 规则：加微信、线下见面、私下转账、低俗越界等
- warn 规则：PUA、索要隐私、变相线下邀约
- review 规则：广告引流、攻击性表达
- 上下文风险累积：连续风险表达会提升分数
- 社区广告特殊规则
- 文本归一化：去除空格、同形词替换（如 vx → 微信）

#### `Sources/Services/APIModerationClient.swift`
可选的 AI 审核客户端。当配置 `MODERATION_API_KEY` 时，调用 OpenAI Moderations API，将分类分数映射为本地的 `ModerationResult`。

#### `Sources/Services/ModerationConfig.swift`
配置读取。优先从环境变量 `MODERATION_API_KEY` 读取，其次从 Info.plist 读取，决定 AI 审核是否启用。

#### `Sources/Services/HybridModerationService.swift`
混合审核服务。先跑本地规则引擎；若规则判定为 block 直接返回；否则如启用 AI，再调用 API 并合并分数与原因。

#### `Sources/Services/CreditService.swift`
信用分/账号状态服务。职责：
- 根据账号状态计算权限限制（发消息、发帖、匹配权重）
- 实名认证、完成订单、风控结果、后台处置对安全分的影响
- 根据分数与违规次数刷新 `accountStatus`（active / restricted / banned）

---

## 4. 测试

#### `Tests/ModerationTests.swift`
单元测试，覆盖：
- 关键词拦截（加微信、vx、私下转账等）
- 变体与空格绕过检测
- 正常情绪表达放行
- 社区广告内容识别
- 分数到决策映射
- `CreditService` 扣分与违规次数导致受限
- warn 缓冲计数初始值

#### `UITests/TalkAndTalkUITests.swift`
UI 测试，覆盖：
- 首页启动与主要 Tab 存在性
- 社区页头图展示
- 发送违规消息被拦截且安全分下降
- 完整主流程：认证 → 选择陪伴者 → 下单 → 进入聊天 → 结束并评价

---

## 5. 资源文件

#### `Resources/LaunchScreen.storyboard`
启动屏，仅显示居中的 “Talk&Talk” 品牌文字。

#### `Resources/ModerationConfig.example.plist`
配置示例文件，说明如何填入 `MODERATION_API_KEY` 以启用 AI 内容审核。真实 key 不应提交到仓库。

---

## 6. 核心数据流

1. **下单沟通流**：`HomeView` / `CompanionListView` → `CompanionDetailView` → `OrderView` → `ChatView` → `ReviewView`。
2. **导航流**：`ContentView` 维护 5 个 tab 的 `NavigationPath`，`AppStore.navigate(_:)` 根据当前 tab 压入对应 `AppRoute`。
3. **风控流**：`AppStore.sendMessage` / `submitCommunityPost` / `report` 调用 `HybridModerationService`，根据结果决定是否拦截、提醒或生成 `ModerationCase`。
4. **信用分流**：`CreditService` 根据风控结果或后台处置调整 `user.safetyScore` 与 `accountStatus`，进而影响用户能否发消息/发帖。
5. **协议提醒流**：首次/第二次 warn 时弹出 `UserAgreementSheet`，第二次要求强制阅读 15 秒。

---

## 7. 补充说明

- `Archive/` 目录包含旧版 Swift Package、Swift Executable、Web Demo 等实验代码，不参与当前主工程。
- 当前为前端演示，所有“支付”“认证”“AI 审核”均为本地模拟。
- iOS 26+ 的 Liquid Glass API 在 `SharedViews.swift` 中预留了空扩展，当前以 Material 设计为主。
- 项目使用 Swift 6.0，`SWIFT_STRICT_CONCURRENCY` 设置为 minimal。
