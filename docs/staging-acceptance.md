# Staging 联调验收

从**空数据库**开始，验证 TestFlight 前关键路径。

## 准备

从仓库根目录：

```bash
cp services/api/.env.staging.example services/api/.env.staging
# 配置 DATABASE_URL / JWT / WECHAT_PAY_*（沙箱）

DEPLOY_ENV_FILE=./services/api/.env.staging \
  docker compose -f docker-compose.prod.yml --env-file services/api/.env.staging up -d --build
```

`DEPLOY_ENV_FILE` 控制 API 容器加载的配置文件（默认 production 使用 `.env.production`）。

或本地：

```bash
npx prisma migrate deploy
npm run db:seed
npm run start:dev
```

## 验收清单

| # | 步骤 | 期望 |
|---|------|------|
| 1 | `migrate deploy` + `seed` | 5 陪伴者；admin `13800000001`、moderator `13800000002` |
| 2 | `POST /api/v1/auth/sms/send-code` + `phone/login` | 返回 access/refresh token |
| 3 | `GET /api/v1/companions` | 返回 seed 陪伴者列表 |
| 4 | `POST /api/v1/orders` → `prepay` | `payment.mock=true`（staging） |
| 5 | iOS 微信沙箱唤起 **或** `POST /payments/wechat/mock-notify` | 订单 `paid`，会话激活 |
| 6 | `POST /conversations/c1/messages` 正常文案 | `decision=allow`，有 `companionReply` |
| 7 | 发送「加微信私下聊」等违规文案 | `decision=block`，`safetyMessage`，创建 ModerationCase |
| 8 | Web `http://<host>/admin/` moderator 登录处置 | `confirmViolation` / `dismiss` 写入 ActionLog |
| 9 | `GET /api/v1/health` | `metrics` 含请求数、错误率、AI/微信计数 |

## 自动化冒烟

```bash
./services/api/scripts/acceptance-smoke.sh http://127.0.0.1:3000
```

## iOS（Release / TestFlight 前）

1. Archive Release（`BACKEND_BASE_URL` 指向 staging 或 production）。
2. 登录 → 发现页拉陪伴者 → 下单 → 微信支付沙箱 → 进入聊天。
3. 发送正常消息、违规消息，确认服务端拦截与提示。
4. Release 构建不出现「开发模式」「本地保护」「安全工作台」入口。