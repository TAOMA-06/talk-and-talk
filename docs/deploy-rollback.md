# 部署与回滚控制参考（当前不可执行）

配套：[production-checklist.md](./production-checklist.md)、
[staging-acceptance.md](./staging-acceptance.md)、
[G2 执行包](./cto-self-audit/runs/2026-08-08-g1-remediation/g2-execution-package.md)。

> 当前首发状态：`G1 NO-GO`、`G2-ready NO-GO`、`G2 BLOCKED`。本文件不是
> staging/production 的可执行命令单，也不构成数据库、容器、云托管、DNS、微信
> 或支付系统的授权。不得从旧版本复制 `docker compose up --build`、
> `prisma migrate deploy`、数据库备份/恢复、`acceptance-smoke.sh`、`production-smoke.sh`
> 或浮动 tag 命令到任何外部环境。

## 每个外部动作所需的授权记录

任何部署、迁移、备份、恢复、配置修改、流量切换或回滚都必须有独立记录。一个
G1、SBOM、E2E 或迁移批准不能自动覆盖另一个动作。

| 字段 | 必填内容 |
|---|---|
| Evidence ID | 仅本次动作的非秘密授权 ID；必须能与审批系统中的记录对应。 |
| 动作与目标 | 动作名称、目标环境/资源 ID、服务范围、数据边界、是否触发第三方回调。 |
| 冻结输入 | 候选 SHA/source-tree、不可变 Web/API/OCI digest、制品构建与保管证明；不得使用分支、浮动 tag 或本地重建。 |
| 有效期与执行人 | 签发时间、到期时间、执行人、独立复核人，以及禁止自审/绕过的控制。 |
| 预期结果 | 健康、迁移、路由策略、text-only、回滚/恢复、日志/收据位置与停止条件。 |
| 结果与复核 | 脱敏结果、校验和/收据、清理或恢复结果、独立复核结论。 |

空字段、过期字段、目标不一致或缺少不可变制品保管证明均为 `BLOCKED`，不是
“稍后补齐”。真实凭据、数据库 URL、OpenID、支付签名、私钥和聊天内容不得写入
Git 或本记录。

## 当前可保留的工程约束

- Web 首发仅公开官网说明和小程序导流；延期 Web 交易、BFF 和 session 路由必须
  在候选和部署环境保持不可达。
- 小程序首发为 text-only。媒体、TRTC、语音介绍和相关受控读写不能因为部署或
  回滚而被临时打开。支付投诉 provider-media 的例外/禁用/延期仍等待
  `PAYMENT-DISPUTE-MEDIA-R01` 决策。
- `/api/v1/health` 只是 liveness；非 development 的
  `/api/v1/health/ready` 需要受控 Bearer token。令牌只能在获授权运行时注入，
  不得归档。
- 数据库迁移不是应用启动副作用。多副本容器保持 migration-status fail-closed；
  迁移兼容性由专用、授权、一次性的 fresh-schema harness 证明，不能由手工 SQL
  或启动参数替代。
- 任何部署或回滚都使用已批准的不可变制品；禁止 `--build`、浮动镜像/tag、
  从当前工作树构建，或把本地 source 当作制品来源。

## 受控验证的边界

`backend/api/scripts/acceptance-smoke.sh` 仅用于 development/mock SMS/mock
payment/local seed 的闭环检查，不能作为 staging、真实微信、真实支付或 provider
证据。`production-smoke.sh` 只是受控运行模板，必须先有对应的逐项授权记录、
冻结候选、不可变制品、目标环境和不归档的运行时凭据；它不是自动获得的部署许可。

`backend/api/scripts/run-migration-compatibility.sh` 只适用于一项单独授权的本地
disposable fresh-schema 前向兼容性验证。它要求已在本地保管的、digest 固定的 prior/
candidate/PostgreSQL/Redis 制品，拒绝 pull/build/远端 Docker，并产出脱敏收据。该
结果不证明生产回滚、备份恢复、历史数据迁移、RTO/RPO 或旧镜像可通过其正常
`prisma migrate status` 入口重启。该 launcher/Compose/收据是
`local-operator-only`：不能成为未来外部 control plane 的迁移 harness、OCI
builder/custody 记录或 G1/G2 证据。真正的外部迁移必须由独立受保护控制面拥有其
制品保管、目标隔离、清理和 `always()` 收据。

## 回滚与恢复边界

Prisma 不提供通用生产 `migrate down`。回滚必须由独立、目标明确的授权记录触发，
并且至少绑定：已批准的 schema-matched prior artifact、可验证的备份/恢复输入、
目标数据边界、测量的恢复目标、执行人与独立复核人。恢复后需在该记录中验证
authenticated readiness、官网延期路由锁定、text-only、关键角色拒绝和法律页；
这些验证不是本文件授权的命令。

任何外部部署/迁移/回滚执行前，先完成 G1 同一冻结 SHA 的零跳过门禁、制品和
SBOM 保管、受保护 CI、浏览器/设备证据，以及 G2 执行包中对应的授权和场景卡。
