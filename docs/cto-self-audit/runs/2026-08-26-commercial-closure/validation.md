# 2026-08-26 商用闭环验证

## 当前工作树已执行结果（非候选发布证据）

| 范围 | 命令/证据 | 结果 |
|---|---|---|
| API 单元测试 | `cd backend/api && npm test` | 146 suites / 1,392 tests / 0 skip |
| API 构建与生产制品 | `npm run verify:prod-artifacts` | TypeScript、Prisma Client、入口和复制制品通过 |
| API 静态预检 | `npm run test:preflight:static` | 90/90 / 0 skip |
| E2E 安全守卫 | `npm run test:e2e:guard` | 115/115 / 0 skip；三项 loopback 用例在获准本机回环环境复跑 |
| API 真 E2E | 已认领一次性 PostgreSQL/Redis，正式 `npm run test:e2e` 入口 | 9 suites / 82 tests / 0 skip；订单支付定向 26/26 |
| PostgreSQL 预检 | 已认领一次性数据库，`npm run test:preflight:postgres` | 31/31 / 0 skip；外层串行、各用例保留多客户端/多副本竞争 |
| 迁移 | 空白数据库 `prisma migrate deploy` | 117 migrations 全部成功 |
| Schema 漂移 | `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` | `No difference detected`；已纳入 PostgreSQL 预检 |
| 留存图 | 真实 PostgreSQL phase contract | 66 个受限阶段逐一执行；support 30 阶段和终态验证通过 |
| Web 候选检查 | `cd frontend/web && npm run check:candidate` | typecheck、lint、策略、各发行面构建/渲染、Worker 图片与安全头通过 |
| 小程序 | 严格 TypeScript、`validate.mjs`、`smoke.mjs`、`test-local-build.mjs` | 31 pages / 5 tabs；881 API calls；本地构建隔离通过 |
| 候选控制工具 | 根目录 8 个 Node test 文件 | 62/62 / 0 skip |
| 依赖漏洞 | 三个发行根 `npm audit --audit-level=low` | backend 0、Web 0、Mini 0 vulnerabilities |
| Prisma | `prisma format`、`prisma validate` | 通过 |
| 工作树 | `git diff --check` | 通过 |

## 失败后修复记录

这些记录保留是为了说明门禁确实失败过，最终结果不是预设的绿灯：

1. Web Worker 与 smoke 守卫在沙箱内监听 `127.0.0.1` 返回 `EPERM`；同一命令在获准本机回环环境通过。
2. 首次 Prisma diff 发现 `Order.refundPolicyVersionSnapshot` 的迁移为 `VARCHAR(64)`、模型却是无注解 `String`；模型补为 `@db.VarChar(64)`，并把零漂移检查加入 PostgreSQL 预检。
3. PostgreSQL 探针并行运行曾耗尽共享内存；外层改为 `--test-concurrency=1`，各探针内部的 2/10 副本竞争不变。
4. 高基数删除测试曾要求优化器必须选择特定索引；改为分别证明索引存在、无排序、实际只取 250 行和每批最多 250 条，不把合法计划差异当失败。
5. E2E 复跑发现客户退款响应泄露内部订单字段；新增 17 字段 allowlist 与 OpenAPI 精确契约后通过。
6. 真实数据库 E2E 默认 5 秒在大量请求日志输出下会提前放弃 HTTP 请求；正式命令改为 `--silent` 消除日志 I/O，未放宽全局 timeout。只有三路并发退款单例保留 20 秒预算，确保所有请求 settle 后清理。
7. 法律留置 10 万行规模夹具在慢盘超过 20 秒；只给夹具装载 60 秒上限，并在 `finally` 恢复 20 秒和触发器。生产队列查询及锁竞争断言未放宽。
8. 新陪伴者申诉 PG 夹具最初把 `endsAt` 设在默认 `startsAt` 之前，触发既有窗口 CHECK；补入明确过去的 `startsAt` 后，117 迁移与 31 项真实 PG 门禁全绿。
9. 修复后复审发现同一媒体 PG 文件新增的两个 test callback 未各自复核 ownership；补现场 await，并把 manifest 守卫升级为逐 test body 检查连接与 schema 变更边界。
10. 可用性规模测试曾把“索引存在”与“优化器本次必须选该索引”混为一谈；改为独立读取 `pg_indexes`，并验证计划仍有 `Limit 1` 和 `LockRows`。完整 31 项 PG 复跑通过。

## 未运行或不能外推

- 未运行真实微信 AppID 上传、审核、真机弱网/无障碍、真钱支付退款、真实 KYC、生产备份恢复、生产容量或值班演练。
- 未运行远端受保护 CI、OCI 构建/签名、staging 或生产部署。
- Web hosting 未执行；当前生产结论为 NO-GO，且用户未授权外部部署。

## 一次性资源清理

最终验证后，两个专用测试数据库已 `dropdb`，本轮 Redis 租约键已删除，Redis 以 `SHUTDOWN NOSAVE` 停止，PostgreSQL 临时集群停止，`/private/tmp` 下本轮数据库目录和临时 runner 已删除。清理不可恢复，但目标只包含本轮生成的测试数据；没有连接或修改任何既有/远程数据库。
