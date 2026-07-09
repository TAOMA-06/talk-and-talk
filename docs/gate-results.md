# 门禁结果记录

| 字段 | 值 |
|------|-----|
| 日期 | 2026-07-09 |
| 环境 | macOS；Node 22；无 Docker / 本机 Postgres / Redis |
| 范围 | 发行计划 Phase 1–3 代码落地后的可执行门禁 |

## 已通过

| 命令 | 结果 |
|------|------|
| `cd backend/api && npm test` | **PASS** — 24 suites / **93** tests |
| `cd backend/api && npm run build` | **PASS** |
| iOS `xcodebuild test … -only-testing:TalkAndTalkTests` | **PASS** — **40** tests（含 phone-login Debug 断言） |
| `xcodegen generate`（Staging scheme） | **PASS** — 生成 `TalkAndTalk` + `TalkAndTalk-Staging` |

## 未执行（环境阻塞）

| 命令 | 原因 |
|------|------|
| `npm run test:e2e` | 本机无 Postgres + Redis；需在有依赖环境补跑 |
| `acceptance-smoke.sh` | API 未部署监听 |
| `production-smoke.sh` | 无公网 production 端点 |
| `docker compose -f infra/docker-compose.prod.yml up` | Docker CLI 不可用 |
| `npm audit --omit=dev` 清零 | 残留 13 条（10 moderate / 3 high：lodash/multer 经 Nest 传递）；**禁止** `audit fix --force`；待 Nest 大版本升级评估 |

## 代码侧已完成（相对发行审查）

- production **禁止** Mock 支付；未配置 → `DisabledWeChatPayProvider` / `WECHAT_PAY_NOT_CONFIGURED`
- Real WeChat：prepay HTTP 客户端、平台证书拉取、AES-GCM 解密、验签结构（需商户凭证联调）
- production 仅 Apple：`SMS_PROVIDER=none` → `SMS_UNAVAILABLE`；iOS Release `ENABLE_PHONE_LOGIN=NO`
- compose `SEED_ON_STARTUP` 默认 `false`；Redis requirepass；nginx 隔离 metrics/admin
- CI：`.github/workflows/api.yml` + `ios.yml`
- TestFlight：`TalkAndTalk-Staging` → `api-staging.talkandtalk.app`

## 升为 Go 仍须

1. 有依赖环境：e2e + acceptance-smoke  
2. Staging 部署 + seed 确认  
3. 本机填 `DEVELOPMENT_TEAM`（勿提交）→ Archive Staging → TestFlight 手测  
4. 商业 production：微信商户联调 + production-smoke + 备份回滚演练  
