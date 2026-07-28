# 部署与回滚

配套：[production-checklist.md](./production-checklist.md)、[staging-acceptance.md](./staging-acceptance.md)、根 [README.md](../README.md)。

当前对外后端的标准路径是 **CloudBase 云托管容器**；本文件保留 Docker Compose 命令，供本地/自建兼容环境使用，不代表小程序正式环境需要部署在本机。云托管的具体入口、VPC 与环境变量见 [微信小程序后端方案选型与部署验收](./wechat-backend-selection.md)。

## 部署前

1. 记录即将发布的 **git tag / commit** 与 `APP_VERSION`。
2. 备份数据库：`DATABASE_URL=... ./backend/api/scripts/db-backup.sh`
3. 确认目标环境 env 文件已填写且 **未提交 git**（`.env.staging` / `.env.production`）。
4. 执行 `cd backend/api && npm run preflight:deployment -- .env.production`（staging 换相应文件）。
5. 执行 `cd backend/api && npm run verify:cloudbase-template`，确认语音就绪模板仍指向现有 Dockerfile、端口 3000、最少一个实例，并且没有把任何运行时变量写进仓库。
6. 生产过一遍 [production-checklist.md](./production-checklist.md)。
7. 若本次包含实时语音，先按 [实时语音上线核对表](./realtime-voice-release-checklist.md) 确认 npm 构建、迁移、CAM、出站网络和两台真机均已通过；**不允许**只因代码构建成功就打开 TRTC。

## CloudBase 云托管标准发布顺序

1. 从 [语音就绪 CloudBase 模板](../infra/cloudbase/cloudbaserc.voice-ready.template.json) 在受控 CI 工作目录生成实际清单：填入目标环境 ID，但不把密钥或运行时变量写进该清单或仓库。控制台先设置 VPC、已备案公网域名和加密变量。
2. 将 API 镜像发布到 staging，首次保持 `TRTC_ENABLED=false`、`TRTC_ROOM_CONTROL_ENABLED=false`。
3. 通过受控 CI 或一次性迁移 Job 执行 `cd backend/api && npm run prisma:deploy`。先备份，再确认 `20260720193000_voice_sessions` 和 `20260720200000_voice_room_control_dispatch_lease` 都已记录在 `_prisma_migrations`；不要用手工 SQL 跳过 Prisma 迁移历史。
4. 在 staging 以真实 CloudBase 密钥变量运行 `npm run preflight:deployment -- .env.staging`，确认没有在构建日志、容器日志或小程序包中出现 SDK 密钥、CAM 密钥、`UserSig`、`PrivateMapKey`。
5. 完成支付回调、退款、人工接单/开始服务和双真机语音验收；仅在全部通过后，才把 staging 的 `TRTC_ENABLED` 与 `TRTC_ROOM_CONTROL_ENABLED` 一起切为 `true`。
6. production 先发布同一已经通过 staging 的镜像和迁移，再灰度流量；语音开关最后开启。任一门禁未通过，就保持两个主开关为 `false`，而不是删代码或修改订单流程。

## Staging

```bash
cp backend/api/.env.staging.example backend/api/.env.staging
# 填写 JWT、数据库密码、微信沙箱等

DEPLOY_ENV_FILE=../backend/api/.env.staging \
  docker compose -f infra/docker-compose.prod.yml --env-file backend/api/.env.staging up -d --build

curl -fsS https://api-staging.talkandtalk.app/api/v1/health
./backend/api/scripts/acceptance-smoke.sh https://api-staging.talkandtalk.app
```

- 首次部署可 `SEED_ON_STARTUP=true`；数据就绪后改为 `false` 并重启 API。
- TLS：将证书放到 `infra/nginx/certs/`（`fullchain.pem` / `privkey.pem`），配置见 `infra/nginx/talk-and-talk.conf.example`。

## Production

```bash
cp backend/api/.env.production.example backend/api/.env.production
# 强密码 JWT、DB、CORS、微信小程序与商户支付配置

docker compose -f infra/docker-compose.prod.yml --env-file backend/api/.env.production up -d --build

curl -fsS https://api.talkandtalk.app/api/v1/health
./backend/api/scripts/production-smoke.sh https://api.talkandtalk.app
```

生产注意：

| 项 | 要求 |
|----|------|
| `SEED_ON_STARTUP` | `false` |
| `SMS_PROVIDER` | 禁止 `mock`；真实厂商未就绪时见 NEXT_PHASE |
| `mock-notify` | 生产应不可用或拒绝 |
| 微信私钥 | CloudBase 使用加密环境变量 `WECHAT_PAY_PRIVATE_KEY`；Compose 使用 `WECHAT_PAY_PRIVATE_KEY_HOST_PATH` 指向 host PEM，并只读挂载到 `WECHAT_PAY_PRIVATE_KEY_PATH` |
| Redis | 建议 `requirepass`，URL 带密码 |
| Metrics | 使用 `Authorization: Bearer $METRICS_TOKEN`，同时保留 Nginx 内网 allowlist |

### 镜像 / 版本记录

```bash
git rev-parse HEAD
# 写入发布单：commit、APP_VERSION、镜像 digest（若推 registry）
```

### 证书更新

1. 更新 `infra/nginx/certs/` 或 ACME 续期结果。
2. `docker compose -f infra/docker-compose.prod.yml exec nginx nginx -s reload`（或重启 nginx 服务）。
3. 验证 HTTPS 与健康检查。

### 备份频率建议

| 时机 | 动作 |
|------|------|
| 每日 | cron 调用 `db-backup.sh` |
| 发布前 | 手动备份 |
| 发布后 24h | 确认备份可读 |

脚本默认 gzip + 保留策略见 `backend/api/scripts/db-backup.sh`。

## 应用回滚

1. 记录当前镜像 tag / git commit（故障现场）。
2. 切回上一版本：`git checkout <tag>` 或拉取上一镜像。
3. `docker compose -f infra/docker-compose.prod.yml --env-file backend/api/.env.production up -d --build api`（或目标环境对应 env 文件）。
4. 验证 `/api/v1/health` 为 `ok` 或可解释的 `degraded`。

## 数据库回滚

Prisma **不提供**生产 `migrate down`。步骤：

1. 停止 API 写入：`docker compose -f infra/docker-compose.prod.yml stop api`
2. 备份当前库：`DATABASE_URL=... ./backend/api/scripts/db-backup.sh`
3. 从备份恢复：`gunzip -c backups/<file>.sql.gz | psql "$DATABASE_URL"`
4. 确认 `_prisma_migrations` 与 schema 一致；部署 **匹配该 schema** 的 API 版本。

## 配置回滚

- 保留 `.env.staging` / `.env.production` 历史副本（如 `.env.production.20260709`）。
- `APP_VERSION` 与发布 tag 对齐，便于 health/metrics 对照。
- 若可约提醒投递出现异常，先将 `AVAILABILITY_REMINDER_DELIVERY_ENABLED=false` 并滚动重启 API，停止新的内部扫描；保全 `talk_availability_reminder_delivery_*` 聚合指标和集中日志。不得手工删除、释放或重写 `AvailabilityReminderAttempt` / 订阅授权，也不得通过再次打开开关重发 `uncertain`、`rejected`、`failedBeforeSend` 或旧租约。
- 若实时语音发生事故，不能直接把两个 TRTC 主开关关掉：那会阻断后续关房。先把 `TRTC_EMERGENCY_STOP_ENABLED=true` 发布到仍保持两个主开关为 `true` 的版本，确认所有 `VoiceSession.terminationCompletedAt` 已完成，再把三个开关一起切为 `false`。完整只读核对 SQL 与恢复顺序见 [实时语音上线核对表](./realtime-voice-release-checklist.md#6-回滚)。

## 回滚后验收

- `GET /api/v1/health`：`dependencies.database/redis` 为 `ok`
- `GET /api/v1/metrics` 携带 `Authorization: Bearer $METRICS_TOKEN` 可访问（内网 / staging）
- 登录、`GET /companions`、下单 prepay；staging 可 mock-notify
- Web `/review/` 独立 reviewer 可登录；普通用户 JWT 访问审核路由被拒绝
- 法律页：`/legal/privacy.html`、`/legal/terms.html`
