# Phase 0 范围与基线

## 当前仓库

- Branch：`main`
- Baseline SHA：`9cf5e3849a9654ddfddb8046bf29a580533fa268`
- 当前工作树：dirty，全部 dirty 路径在本长期任务启动前已存在。
- 本任务状态目录：`docs/cto-self-audit/runs/2026-08-04-web-miniprogram-g0/`。

## 产品范围候选

| 面 | Phase 0 候选责任 | 暂不承担 |
|---|---|---|
| 官网 `frontend/web` | 品牌、产品说明、服务边界、安全、公示、合作和小程序导流 | 真实预约、支付、聊天、售后和 Web 交易闭环 |
| 小程序 `frontend/miniprogram` | 当前真实服务入口：登录、发现、预约、支付、订单、消息、举报、售后、数据权利及陪伴者工作台；个性化推荐治理未闭环前只保留不依赖个人特征的手动发现 | 媒体、TRTC 语音、直播、群聊、站外交易和默认个性化排序 |
| API/契约 | 只有在客户端主链需要时才进入支持切片；价格、资格、权限、订单、支付、审核和消息以服务端为准 | 为 Web 或 Mini 复制第二套业务事实 |
| 延期 Web App | 代码保留，生产候选明确禁用，未来单独立项 | 进入官网导航、SEO、公开承诺或本次 G1/G2 主链 |

## 既有 dirty ownership

基线 hash 和逐路径清单见 `state.md` 的 Dirty ownership map。当前策略是：

- `frontend/web/**` 所有 19 个 tracked 修改和 9 个 untracked Web 资产均为 pre-existing user Web change；Phase 0 只读检查，不 reset、stash、删除、格式化或覆盖。
- `docs/cto-self-audit/*`（不含本次 `runs/`）是上一轮审查文档，manifest baseline 为 `cde165a9d3c307a602f7d6f476850d8cbdb91b95a2cb6dd2713e7462f4fd20ea`；只保留，不重写。
- 本任务只拥有 `runs/2026-08-04-web-miniprogram-g0/**`，任何业务文件 lease 均未取得。
- 第一次业务修改前必须重新计算所有 dirty path 的 current hash；未登记或无法解释的 divergence 是 hard stop。

## 发现的冲突

1. 当前 Web marketing 首页已经表达“官网说明规则与边界，真实服务请进入微信小程序”，但 `frontend/web/README.md` 仍把 Web 描述为完整用户/陪伴者交易客户端。
2. Web 交易路由和 BFF 仍存在；`robots/noindex` 不能作为访问控制或关闭证据。
3. Web README 的本地默认 API 指向 production，后续任何联调必须显式使用隔离 development API。
4. Mini Program 正式 `config.ts` 规定 develop/trial 使用 staging、release 使用 production，`project.config.json` 为 `urlCheck: true`；本机调试必须使用 `create-local-copy.mjs`。
5. Mini Program `app.json` 当前 31 pages、5 tabs，包含 voice 页面但 `COMMERCIAL_TEXT_ONLY_DEFAULT = true`；后续必须验证 dormant voice/media 入口不可达。
6. 共享契约已存在个性化推荐接口和行为标签字段，但 `P0-14` 适用性结论未闭环；候选必须先默认关闭个性化排序，保留明确关键词/目录手动发现。

## Phase 0 只读证据

- `E0-BASELINE-20260804`：HEAD、branch、status、dirty hash map。
- `E0-CODEGRAPH-20260804`：官网 marketing/BFF/服务端事实关系。
- `E0-CONFIG-20260804`：root/Web/Mini README、`app.json`、`config.ts`、`project.config.json`、package manifests。
