# Talk&Talk 实用客服工单测试与媒体证据

## 结论

**有条件通过。** 第二次隔离工单的真实 API、PostgreSQL、审计和通知链路为 21 / 21 断言通过；真实后台静态资源经 artifact-local 同源代理成功捕获登录、匿名队列和受控认领弹窗。UI 在提交 claim 前停止，后续认领和结案由真实 API 完成并独立断言，没有伪称为全程 UI 操作。

- 新工单：`185f79f1-0bf3-4a68-ab50-57fe437d2594`
- 源码 SHA：`ea11230f19b169863e5579b5992796228d0ac222`
- 隔离数据库：`talk_and_talk_demo_support_20260827_ea11230f_01`，按要求保留
- 认领前断言：7 / 7 通过
- 认领、隔离、结案、审计与通知：14 / 14 通过
- 真实应用截图：3 张
- 明示证据卡：2 张
- MP4：`video/talktalk-support-ticket-local-practical-demo.mp4`，37.8 秒、1920 × 1080、30 fps、H.264；结果卡明确为“阻断”

## 代理边界

由于真实 Nest 地址 `http://127.0.0.1:3000/admin/` 存在 `302 Location: /admin/` 自循环，本轮新增了仅位于本 artifact 的小型代理：

- `http://127.0.0.1:3100/admin/` 直接读取仓库里的 `backend/api/public/admin/index.html`、`assets/app.js` 和 `assets/styles.css`，不复制、不修改产品文件。
- 同源 `/api/v1/*` 原样反向代理到真实 NestJS `http://127.0.0.1:3000`。
- 代理设置 CSP、安全头与原始内容类型，只用于本地证据采集。
- 该代理不是产品修复、部署方案或生产证据。

实现见 `verification/admin-proxy.mjs`，请求日志见 `logs/admin-proxy.log`。

## 实际执行流程

1. 新开发客户通过真实 SMS mock、登录和法律同意 API 建立会话；token 只保存在 `/private/tmp`。
2. 通过真实客户 API 创建新工单，数据库为 `open / unassigned`。
3. Chrome 使用真实运营账号登录代理后的原始后台资源。
4. Chrome 显示匿名待认领卡；正文、请求人和订单身份均未出现。
5. Chrome 打开“认领匿名客服工单”受控操作弹窗。
6. 在时间盒内没有 claim POST 到达代理；数据库仍为 `open / unassigned`，因此 UI 流程在此明确记为 blocked，未重试。
7. 同一新工单通过真实 API 完成 claim：201 / `inProgress`。
8. 第二名客服读取详情为不可探测 404，再认领为 `409 SUPPORT_TICKET_ALREADY_ASSIGNED`。
9. 当前受理人通过真实 API resolve：200 / `resolved / noRefund`。
10. 三条审计、显式主体边、客户未读通知和 `supportUpdate` 投递意图均持久化。

## 截图清单与来源

### 真实应用界面

- `screenshots/01-admin-login.png`：代理提供的原始 admin 登录页；截图时所有凭据字段为空。
- `screenshots/02-admin-anonymous-queue.png`：原始后台通过代理读取真实 claimable/assigned API；新工单只以匿名卡出现。
- `screenshots/03-admin-claim-dialog.png`：原始后台为新工单打开的受控认领弹窗；操作理由与确认输入为空。

### 证据卡，不是应用界面

- `screenshots/08-evidence-run-summary.png`：由新工单 21 项实际断言 JSON 生成，顶部明确标注 `EVIDENCE CARD · NOT APPLICATION UI`。
- `screenshots/09-evidence-audit-notification.png`：由审计与通知 JSON 生成，明确说明 `pending` 不是微信送达。

全部 PNG 均为 1440 × 810，已逐张使用 `view_image` 检查。哈希、来源和隐私检查见 `verification/screenshot-inspection.json`。

## 演示视频

- 成片：`video/talktalk-support-ticket-local-practical-demo.mp4`
- 镜头清单：`video/shot-manifest.json`
- 时长与规格：37.8 秒，1920 × 1080，30 fps，H.264 / `avc1`，无音轨
- 文件大小：39,685,090 bytes
- SHA-256：`b47ffc87132391caf1e3fc90dc9e16c27a8d9a7d3a2467b5aa5c29ef04f1ebc3`
- 结果状态：`blocked`；没有把 API / DB 通过扩大成端到端 UI 或微信通过
- AVFoundation 报告：`verification/video-report.json`
- `avmediainfo`：`verification/avmediainfo.txt`，0 error
- 视频联系表：`verification/video-contact-sheet.png`
- 关键帧：`verification/video-frame-start.png`、`video-frame-middle.png`、`video-frame-end.png`
- 完整校验和：`verification/checksums.sha256`

成片仅使用本目录五张已核验真实截图/证据卡，没有 synthetic 占位图。已使用 `view_image` 检查联系表及 2.0 秒、18.9 秒、35.0 秒的实际视频帧；中文排版完整，没有缺图、破图、synthetic 标记或可见凭据。媒体与视觉元数据见 `verification/video-metadata.json`。

视频叙事明确说明：本地隔离 API / PostgreSQL 21 / 21 断言通过；Admin UI 只走到受控认领弹窗，UI claim 提交与后续详情/结案未完成；同一工单随后由真实 API 完成认领 201 和结案 200；Mini Program UI 被阻断，外部微信送达未运行。它不是 staging、生产、真机或真实微信证明。

## 通过、阻塞、未运行

### 通过

- 新工单真实 API / PostgreSQL 流程。
- 认领前五字段隐私 allowlist 与不可探测 404。
- API 认领、第二客服隔离、API 结案。
- `support.ticket_created / claimed / resolved` 审计与主体边。
- 客户站内未读通知与事务投递意图。
- 代理后的真实 admin 登录、匿名队列和受控弹窗画面。
- 两张脱敏证据卡与五张截图的视觉/敏感信息检查。
- 37.8 秒 H.264 演示视频的媒体轨、联系表和开头/中段/结尾视觉检查。

### 阻塞

- 真实 Nest `/admin/`：302 自循环。
- 代理 admin 的 claim 提交：时间盒内未发出 POST；后续 UI 详情/结案未运行。
- Mini Program UI：没有真实截图，未重试。

### 未运行

- 真实微信订阅授权与外部 provider 送达。

## 关键证据

- `verification/media-api-preclaim-assertions.json`
- `verification/media-api-final-assertions.json`
- `verification/media-ui-flow.json`
- `verification/ui-capture.json`
- `verification/evidence-card-capture.json`
- `verification/screenshot-inspection.json`
- `video/shot-manifest.json`
- `verification/video-report.json`
- `verification/video-metadata.json`
- `verification/video-contact-sheet.png`
- `verification/checksums.sha256`
- `manifest.json`

## 证据边界

这是本地隔离工程与媒体素材证据，不是 staging、生产、微信真机、外部消息送达或发布放行证据。凭据、密码、TOTP、JWT 和手机号均未写入 shareable artifact；临时运行目录在结束时删除。
