# 部署与回滚

配套：[production-checklist.md](./production-checklist.md)、[staging-acceptance.md](./staging-acceptance.md)、根 [README.md](../README.md)。

## 部署前

1. 记录即将发布的 **git tag / commit** 与 `APP_VERSION`。
2. 备份数据库：`DATABASE_URL=... ./backend/api/scripts/db-backup.sh`
3. 确认目标环境 env 文件已填写且 **未提交 git**（`.env.staging` / `.env.production`）。
4. 执行 `cd backend/api && npm run preflight:deployment -- .env.production`（staging 换相应文件）。
5. 生产过一遍 [production-checklist.md](./production-checklist.md)。

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
# 强密码 JWT、DB、CORS、Apple bundle、微信/短信策略

docker compose -f infra/docker-compose.prod.yml up -d --build

curl -fsS https://api.talkandtalk.app/api/v1/health
./backend/api/scripts/production-smoke.sh https://api.talkandtalk.app
```

生产注意：

| 项 | 要求 |
|----|------|
| `SEED_ON_STARTUP` | `false` |
| `SMS_PROVIDER` | 禁止 `mock`；真实厂商未就绪时见 NEXT_PHASE |
| `mock-notify` | 生产应不可用或拒绝 |
| 微信私钥 | CloudBase 用加密环境变量 `WECHAT_PAY_PRIVATE_KEY`；Compose 可挂载到 `WECHAT_PAY_PRIVATE_KEY_PATH` |
| Redis | 建议 `requirepass`，URL 带密码 |
| Metrics | 勿对公网裸奔 |

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
3. `DEPLOY_ENV_FILE=... docker compose -f infra/docker-compose.prod.yml up -d --build api`（或等价只重建 api）。
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

## 回滚后验收

- `GET /api/v1/health`：`dependencies.database/redis` 为 `ok`
- `GET /api/v1/metrics` 可访问（内网 / staging）
- 登录、`GET /companions`、下单 prepay；staging 可 mock-notify
- Web `/admin/` moderator 可登录
- 法律页：`/legal/privacy.html`、`/legal/terms.html`
