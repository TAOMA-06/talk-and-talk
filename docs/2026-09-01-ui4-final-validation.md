# Talk&Talk UI4 浅彩卡牌剧场最终本地验收

- 日期：2026-09-01（Asia/Shanghai）
- 结论：**本地目标通过；外部发布继续 No-Go**
- 范围：微信小程序 31 页、5 个公开 Web 路由、Commercial Admin、Independent Review
- 操作边界：未提交、未推送、未 Preview、未 Upload、未真机调试、未部署

## 1. 目标完成情况

| 要求 | 结果 | 权威证据 |
|---|---|---|
| 小程序 31 页及共享组件 UI4 重构 | PASS | 31 pages / 18 components strict audit |
| 流畅有限动效、立体叠卡、克制卡通 | PASS | 首页 5 帧、发现 3 帧；静止帧一致；后层卡实际点击 |
| text-only、身份、支付退款、安全危机、权限审计 | PASS | 894 次 runtime smoke；95/95 backend static preflight |
| Light / Dark | PASS | 三个设备的 31 个页面 light/dark 图像均不同 |
| 320 / 390 / 430 | PASS | 6 组 × 31 页 = 186 张 DevTools 截图 |
| 减少动效 | PASS | live AppService `motionOff=true`；0ms 终态两帧相隔 1.2 秒一致 |
| 发现筛选与后层卡命中 | PASS | Computer Use 可访问树与交互截图 |
| 5 个公开 Web 路由 | PASS | Web full check；390/1280 浏览器实测 |
| Admin / Review | PASS（本地静态） | 95/95 static preflight；390/1280 登录页；身份域分离 |
| 主 UI 文案最小化 | PASS | Mini -48.7%；Web 五路由 -64.1%；copy audits |

## 2. 小程序最终证据

最终自动门：

- TypeScript PASS；
- 31 页 / 5 tabs 结构与 WXML 平衡 PASS；
- runtime smoke PASS，894 次 API 调用；
- UI4 strict audit PASS，31 页 / 18 组件；
- 亮暗主题、透明度合成、TabBar、焦点与共享组件文字对比度 PASS；
- copy-density audit PASS：18,172 → 9,324，可见文字减少 8,848（48.7%）；
- local-build isolation PASS；
- `git diff --check` PASS。

真实微信开发者工具：Stable 2.01.2510290，基础库 3.17.2。

| 设备 / 主题 | 路由 | 失败 | 独立图像 | 实际截图尺寸 |
|---|---:|---:|---:|---|
| 320 light | 31/31 | 0 | 30 | 640×912 / 640×1008 |
| 320 dark | 31/31 | 0 | 30 | 640×912 / 640×1008 |
| 390 light | 31/31 | 0 | 30 | 780×1342 / 780×1506 |
| 390 dark | 31/31 | 0 | 30 | 780×1342 / 780×1506 |
| 430 light | 31/31 | 0 | 30 | 860×1504 / 860×1668 |
| 430 dark | 31/31 | 0 | 30 | 860×1504 / 860×1668 |

`verify-full-matrix.mjs` 校验文件名、实际路由、manifest、SHA-256、尺寸和主题差异；总计 186/186。每个尺寸 31/31 页面 light 与 dark 图像均不同。

运行态：

- 首页后层“工作压力很大”场景卡从 `Value 0` 变为 `Value 1` 并显示已选择；
- 发现筛选面板实际打开，选择中文后“查看结果”关闭面板并保留 `pages/discover/index`；
- live AppService 设置 `motionOff=true`，即时帧与 1.2 秒后截图 SHA 完全一致；
- 首页入场 5 个不同帧、发现过渡 3 个不同帧；两者稳定后帧均一致，没有无限动画。

最终生成副本：

- 最终逐文件一致性校验使用系统临时目录中的隔离副本，避免 Documents 同步服务在 DevTools 退出后恢复冲突文件；
- 工作区内受污染的生成副本已完整移至系统临时目录保留，没有直接删除；
- 275 个普通文件与正式源逐文件一致；
- 最终隔离副本记录名：`system-temp/talktalk-ui4-v0.1-final-local-20260901-1215`；
- source/local digest：`aaf718cd943eb3bbedd433aa16495bd22665b2ceface2a9db88fe026906de638`；
- 无存储 AppID；
- local-only marker、工程名与说明完整；
- 仅 `project.config.json`、`utils/config.ts` 和两个本地说明文件属于预期生成差异；
- 该副本只在本地测试 AppID 下由微信开发者工具自动化打开；未 Preview、Upload、真机调试或部署。

截图后修复：

- 31 页 × 6 组合的矩阵批次关联旧隔离摘要 digest `a71141ad…`；原始矩阵 manifest 本身未嵌入源 digest，因此不把它描述为最终源 SHA 绑定证据；
- 随后真实 DevTools 首次打开暴露 `tt-action-bar` 的组件 WXSS 标签选择器警告；`.motion-off button` 已改为两个既有按钮 class 的等价选择器；
- `ui2-audit.mjs` 新增并自测组件 WXSS tag / ID / attribute selector 拒绝门；
- 该变更只影响 `motionOff=true` 选择器，默认态截图像素不受影响；审计脚本不进入产品 UI；
- 最终隔离副本重新打开 `pages/consent/index`，源码选择器警告为 0；同一最终副本重新设置 `motionOff=true`，两帧相隔 1.2 秒仍字节一致；
- 因此保留 186 张默认态矩阵，并以独立 post-capture remediation 记录绑定最终 digest；这不是声称原始截图 manifest 已直接绑定最终源。

证据入口：

- `artifacts/ui4-visual-evidence/evidence-summary.json`
- `artifacts/ui4-visual-evidence/matrix/`
- `artifacts/ui4-visual-evidence/dynamic/`
- `artifacts/ui4-visual-evidence/interaction/`
- `artifacts/ui4-visual-evidence/post-capture-remediation.json`
- `artifacts/v0.1/post-fix-devtools.json`

## 3. 文案减法与法律承接

- Mini：31/31 审查，29 页直接精简；可见文字 -48.7%；
- 公开 Web：五路由 4,325 → 1,554，-64.1%；
- Admin：-6.2%；Review：-22.7%；后台保留资金、身份、权限、证据与未知状态；
- 新增统一 `PublicRuleLinks`，连接安全说明、用户协议与隐私政策；
- FAQ、品牌解释长文、重复边界列表、隐藏重复文案已从真实 DOM 删除；
- 现有协议已覆盖服务范围、支付退款、内容规则、隐私处理和用户权利，无需编造新法律条款。

仍然内联的关键事实包括：支付金额/时间/退款窗口/规则版本、`用户协议与完整退款条款`、`平台客服`、110/120、身份/权限拒绝、失败/未知、举报/申诉/退款/投诉，以及正式 TRTC 提供方、字段和用途。

## 4. Web 最终结果

五个公开路由 `/`、`/how-it-works`、`/safety`、`/about`、`/partners` 完成 UI4 与文案减法。

最终 `npm run check`：

- TypeScript / ESLint / 所有构建 PASS；
- policy 19/19；
- open render 26/26；
- default locked surface 27/27；
- production hostile-reopen lock 27/27；
- Worker image runtime 1/1；
- 合计 100 个 Node 测试，零失败、零跳过。

文案减法后重新完成 5 路由 × 390/1280 浏览器截图；每个路由 document overflow 为 0，私有路由链接为 0。

## 5. Admin / Review 最终结果

- Admin 与 Review 登录故事区采用不同 UI4 身份色；
- 登录后的案件、证据、支付、身份、安全、审计和受控操作维持 M0/M1；
- JavaScript syntax PASS；
- backend static preflight 95/95，零跳过；
- API build 和 production artifact verification PASS；
- 文案减法后 Admin/Review 390/1280 均无横向溢出，CTA 50px；
- `portalView` 在未认证截图中不可见；没有伪造角色数据。

## 6. 独立质量与发布边界

本轮本地 UI4 目标 P0=0、P1=0。当前工作树仍包含大量未提交 UI3/UI4 文件，不是干净发布候选，也没有发布授权。

以下外部证据仍未运行，因此发布保持 **No-Go**：

- 真实消费者、陪伴者、Admin、Review 角色流程；
- 真实微信登录、身份授权、小额支付、服务端回调与退款；
- 微信真机帧率、长列表、系统字体、原生控件和触控；
- staging / 体验版 / 生产域名、CDN、监控和合规审批；
- 干净候选 SHA、提交、推送、Preview、Upload 与部署。

上述发布缺口不否定本目标的本地实现完成，也不能被本地截图或测试替代。
