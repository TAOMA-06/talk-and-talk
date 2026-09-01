# Talk&Talk v0.1

Talk&Talk 是一款微信小程序优先的线上陪伴产品。v0.1 已将小程序、公开 Web、API、Admin 和 Independent Review 统一到浅彩卡牌剧场风格。

`main` 是当前 v0.1 的主发行代码分支。

![Talk&Talk v0.1 UI4 总览](./artifacts/v0.1/ui4-overview.png)

[v0.1 更新说明](./docs/releases/v0.1.md) · [本地验收](./docs/2026-09-01-ui4-final-validation.md) · [UI4 设计系统](./frontend/miniprogram/UI4_DESIGN_SYSTEM.md)

## 产品方向

v0.1 的核心是浅色、低饱和、多元卡牌：用叠卡制造空间感，用克制动效完成反馈，用更少文字保留当前事实和下一步动作。支付、退款、身份、审核、安全和用户协议等内容放在对应的政策或运营界面里，不挤占主界面。

![Talk&Talk v0.1 动效预览](./artifacts/v0.1/ui4-motion-demo.gif)

[播放 MP4](./artifacts/v0.1/talktalk-v0.1-motion-demo.mp4) · [查看小程序截图](./artifacts/v0.1/screens/README.md) · [媒体清单](./artifacts/v0.1/manifest.json)

## 发行范围

| 表面 | v0.1 范围 |
| --- | --- |
| 微信小程序 | 31 个用户与陪伴者页面，18 个共享组件 |
| 公开 Web | `/`、`/how-it-works`、`/safety`、`/about`、`/partners` |
| API | NestJS `/api/v1`，PostgreSQL 与 Redis |
| Admin | 商业运营后台 |
| Independent Review | 独立审核台与独立身份域 |

## 仓库结构

```text
frontend/miniprogram/  微信小程序正式源
frontend/web/          公开 Web 路由
backend/api/           API、Admin、Review 与法律页
shared/contracts/      OpenAPI v1 契约
infra/                 本地与部署参考
docs/                  发布说明、验收与运行手册
artifacts/v0.1/        v0.1 精简媒体包
```

## 快速开始

需要 Node.js 22+、PostgreSQL、Redis 和微信开发者工具。

```bash
cd backend/api
npm install
cp .env.example .env
npm run prisma:migrate
npm run start:dev
```

```bash
npm --prefix frontend/miniprogram install
node frontend/miniprogram/scripts/create-local-copy.mjs \
  --api-base-url http://127.0.0.1:3000/api/v1
```

在微信开发者工具中导入 `frontend/miniprogram-local` 做本地测试。可上传的正式源仍是 `frontend/miniprogram`。

```bash
cd frontend/web
npm install
npm run dev
```

## 验证

```bash
# Mini Program
backend/api/node_modules/.bin/tsc -p frontend/miniprogram/tsconfig.json --noEmit
node frontend/miniprogram/scripts/validate.mjs
node frontend/miniprogram/scripts/smoke.mjs
node frontend/miniprogram/scripts/ui2-audit.mjs
node frontend/miniprogram/scripts/ui3-contrast-audit.mjs
node frontend/miniprogram/scripts/ui4-copy-audit.mjs

# Public Web
npm --prefix frontend/web run check

# API / Admin / Review static gate
npm --prefix backend/api run build
npm --prefix backend/api run test:preflight:static
npm --prefix backend/api run verify:prod-artifacts
```

当前 v0.1 证据属于本地验收证据。创建 Git tag / GitHub Release、微信 Preview / Upload / 审核、真实微信登录、支付回调与退款、真机性能、生产基础设施、监控和合规审批，都需要单独授权和独立证据。

更多入口：[项目指南](./docs/GUIDE.md) · [小程序开发](./frontend/miniprogram/README.md) · [部署与回滚](./docs/deploy-rollback.md) · [下一阶段](./NEXT_PHASE.md)
