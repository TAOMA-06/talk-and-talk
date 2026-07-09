# 部署与回滚

## 部署（Staging）

```bash
cp services/api/.env.staging.example services/api/.env.staging
# 填写 JWT、数据库密码、微信沙箱参数

DEPLOY_ENV_FILE=./services/api/.env.staging \
  docker compose -f docker-compose.prod.yml --env-file services/api/.env.staging up -d --build
curl -fsS https://api-staging.talkandtalk.app/api/v1/health
```

首次部署保持 `SEED_ON_STARTUP=true`；数据就绪后改为 `false` 并重启 API。

## 应用回滚

1. 记录当前镜像 tag / git commit。
2. 切换到上一版本：`git checkout <tag>` 或拉取上一镜像。
3. `docker compose -f docker-compose.prod.yml up -d --build api`
4. 验证：`/api/v1/health` 状态为 `ok` 或 `degraded`（仅依赖异常时 degraded）。

## 数据库回滚

Prisma 不提供生产环境 `migrate down`。回滚步骤：

1. 停止 API 写入：`docker compose stop api`
2. 备份当前库：`DATABASE_URL=... ./services/api/scripts/db-backup.sh`
3. 从备份恢复：`gunzip -c backups/<file>.sql.gz | psql "$DATABASE_URL"`
4. 确认 `_prisma_migrations` 表与恢复的 schema 一致；必要时部署匹配该 schema 的 API 版本。

## 配置回滚

- 保留 `.env.staging` / `.env.production` 历史副本（如 `.env.production.20260709`）。
- `APP_VERSION` 与发布 tag 对齐，便于 health/metrics 对照。

## 回滚后验收

- `GET /api/v1/health`：`dependencies.database/redis` 为 `ok`
- `GET /api/v1/metrics` 可访问（staging）
- 手机号登录、`GET /companions`、下单 prepay、mock-notify（staging）
- Web `/admin/` moderator 可登录