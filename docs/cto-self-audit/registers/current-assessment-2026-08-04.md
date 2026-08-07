# 当前首轮评估｜2026-08-04

## 1. 结论

**生产：No-Go。** 本轮没有确认新的资金状态机类 P0 源码缺陷，但确认了实名硬门、安全评估和个性化推荐治理三组生产合规阻断：微信 OpenID 用户可在没有真实身份硬门的情况下发布 `femaleRequest` 公开内容并使用付费订单即时通讯；仓库也没有上线前安全评估报告或算法备案适用性结论。其余 P0 主要是当前 CI、生产基础设施、真实微信/资金、资质、KYC、人工运营、可观测性和灾备证据缺失。

| Gate | 当前状态 | 说明 |
|---|---|---|
| G0 范围真实 | `PARTIAL` | 小程序 + NestJS 明确；`frontend/web` 的正式身份冲突待决策 |
| G1 仓库候选 | `FAIL` | 当前 HEAD 的 API 与小程序主 CI 均失败，完整自动化未执行完 |
| G2 Staging | `FAIL` | 公共 staging API 当前 TLS 握手失败，真实依赖/真机链路无当前证据 |
| G3 生产 | `FAIL` | 已确认实名实现、灾备和可观测性失败，且外部资质、真钱、KYC、值班和签字未齐 |
| G4 放量 | `BLOCKED` | 尚无真实供给密度、复购、履约和单位经济证据 |

本轮基线：`main@9cf5e38`。工作树在本目录建立前已有大规模 `frontend/web` 改动；这些资产未被覆盖。

## 2. 已确认的代码优势

| ID | 能力 | 当前证据 | 证据边界 |
|---|---|---|---|
| S-001 | 商用新单有结构化 SKU/时段、`clientRequestId`、锁和快照 | `backend/api/src/orders/orders.service.ts`、Prisma 唯一约束 | 未替代真实并发/生产数据 |
| S-002 | 支付/退款使用稳定 `outTradeNo` / `outRefundNo`，对未知结果保守处理 | `backend/api/src/payments/payments.service.ts` | 未替代真实微信商户 |
| S-003 | 消费者 access token 绑定服务端 session，refresh 原子轮换；角色/状态每次重读 | auth guard/strategy/service | 审核员 token 仍有单独 P1 |
| S-004 | `/review/` 使用独立身份、JWT/TOTP、Reviewer/Lead 分权和审计 | `backend/api/src/review` | 需真实离职/并发/申诉演练 |
| S-005 | 生产配置对 Mock、占位密钥、审批和关键 provider 失败关闭 | `backend/api/src/config/configuration.ts`、deployment preflight | 实际生产环境尚无通过证据 |
| S-006 | CI 已包含构建、生产制品、依赖 audit、单测、preflight、迁移、E2E 和镜像构建 | `.github/workflows/api.yml` | 不含 SBOM/SAST/镜像签名等 P1 |
| S-007 | 商业漏斗覆盖请求、接单、支付、开始、完成、评价、退款、复购和净实收 | `backend/api/src/commercial/commercial-funnel.service.ts` | 尚无真实 CAC/贡献毛利 |

## 3. P0｜生产阻断

| ID | 状态 | 缺口 | 本轮证据 | 完成条件 | 建议 owner |
|---|---|---|---|---|---|
| P0-01 | `FAIL` | production API 当前不可达 | Google DoH 返回 NXDOMAIN；`curl https://api.talkandtalk.app/api/v1/health` → exit 35、`SSL_ERROR_SYSCALL`、HTTP 000 | DNS/TLS/路由修复；外网与微信回调均成功；归档证书链和 health | 运维/CTO |
| P0-02 | `FAIL` | staging API 当前不可达 | Google DoH 返回 NXDOMAIN；`curl https://api-staging.talkandtalk.app/api/v1/health` → exit 35、HTTP 000 | 可重复 staging 全链路并归档 | 运维/CTO |
| P0-03 | `BLOCKED` | 实际生产配置、秘密、VPC/私网、镜像摘要和迁移状态无可复核证据 | checkout 无 `.env.production` / `.env.staging`；这本身是正确的秘密边界，但不能证明目标环境 | 在密钥管理中配置；实际 preflight 脱敏通过；固定镜像 digest | 运维/安全 |
| P0-04 | `BLOCKED` | 微信主体、备案、真实类目、隐私接口、商户绑定和模板审批未证实 | 现有清单仍为外部未勾选项 | 微信后台原始回执 + 平台/属地确认 | 产品/合规 |
| P0-05 | `BLOCKED` | 真实微信登录、支付、退款、投诉、日账单、结算和追偿未验收 | 仓库仅能证明实现；无真钱/真实商户记录 | 同一候选完成受控真钱、乱序/丢回调、退款、投诉和对账 | 财务/工程 |
| P0-06 | `BLOCKED` | 陪伴者真实 KYC、成年、合同、税务、收款与双人复核原件未证实 | 代码保存受控外部引用，不执行真实核验 | 每位上架供给有有效外部证据和非本人复核 | 供给运营/合规 |
| P0-07 | `FAIL` | 生产灾备只到模板/本地 dump，未证明 PITR、加密、异地、校验和恢复 | `docs/runbooks/backup-restore.md` 明确写“repository template only”；`db-backup.sh` 为本地 gzip/7 天策略 | 目标环境恢复与故障切换；实测并批准 RPO/RTO | 运维/CTO |
| P0-08 | `FAIL` | 可观测性与 paging 未闭环 | 指标为进程内内存计数；示例告警引用仓库未生产的 `talk_commercial_readiness_blocker` | 多副本聚合指标、规则校验、告警注入和真实值班确认 | SRE/运营 |
| P0-09 | `BLOCKED` | 审核、客服、危机和安全事故的真实排班/SLA/地区资源/演练未证实 | 文档和代码不能证明人在岗 | 班表、容量、升级联系人、事故与危机演练原始记录 | 安全/客服 |
| P0-10 | `BLOCKED` | text-only 首发关键路径缺真机无障碍、字体放大、低端机和弱网证据 | 小程序结构校验通过，但不能替代真实设备 | 双角色真机走完登录、下单、支付、消息、举报、售后和数据权利并归档复测 | 客户端/QA |
| P0-11 | `FAIL` | 当前 HEAD 主 CI 未通过 | [API run 30870352341](https://github.com/TAOMA-06/talk-and-talk/actions/runs/30870352341) 因 `fast-uri@3.1.4` high advisory 在 audit 阶段失败，后续测试/迁移/E2E/镜像全跳过；[Mini run 30870352233](https://github.com/TAOMA-06/talk-and-talk/actions/runs/30870352233) 因 `WECHAT_MINIPROGRAM_APP_ID` 仓库变量为空失败 | 修复/评估依赖；配置非占位发布 AppID；同一 SHA 的必需检查全绿 | 工程/安全 |
| P0-12 | `FAIL` | 信息发布/即时通讯缺真实身份硬门 | `loginWithWechatMiniProgram` 仅用 OpenID 创建身份；`CommunityService.create` 对 `femaleRequest` 不检查真实身份；`ConversationsService.send` 仅把 `isVerified` 作为审核风险信号 | 在相关服务前强制适用的手机号/证件/网证等真实身份认证，补未认证拒绝 E2/E3 | 产品/合规/工程 |
| P0-13 | `BLOCKED` | 公开信息分享、小程序和即时通讯上线前安全评估未闭环 | 当前只有内部审查目录；没有自评报告、提交回执或属地程序确认 | 完成自评，按适用规定在上线前提交报告；归档回执、整改和批准人 | 合规/安全/CTO |
| P0-14 | `BLOCKED` | 默认个性化推荐无当前公示、自评估和备案适用性结论 | 推荐服务使用近 90 日订单、点击和行为标签排序；代码支持关闭/删标签，但仓库无外部结论 | 上线前完成规则公示、自评估和属地适用性确认；适用则备案并展示编号，否则保留书面结论；未完成时全局关闭个性化 | 产品/合规/工程 |
| P0-15 | `N/A` | TRTC/媒体是仓库内延期能力，不属于当前 text-only 首发 | D-003 与生产清单要求 `TRTC_ENABLED=false`、`MEDIA_FEATURE_ENABLED=false`，客户端隐藏入口 | 每个候选归档负配置、客户端不可达和服务端拒绝证据；任何启用动作重新立项为 P0 | 产品/安全/客户端 |

## 4. P1｜代码、治理与受控试运营缺口

| ID | 状态 | 缺口与证据 | 完成条件 |
|---|---|---|---|
| P1-01 | `FAIL` | `README.md`/既有审查把消费者 Web 排除，但 `frontend/web` 有活跃改动和公开披露页面 | 决定它是官网、体验站还是交易面；建立独立数据流、CI、域名和内容 owner |
| P1-02 | `FAIL` | 当前工作树不干净，无法作为不可变发布候选 | 在不丢失用户资产的前提下形成干净候选 SHA 和制品 manifest |
| P1-03 | `PARTIAL` | Review guard 重读审核员状态，但 access token 未绑定 `ReviewSession`；logout 后旧 access token 可用至过期 | access token 带 session ID 并在 guard 校验撤销/到期；补 logout/offboarding 测试 |
| P1-04 | `PARTIAL` | Redis 不可用时只有正则列出的部分 POST 失败关闭；社区、普通消息、举报和部分后台写可能 fail-open | 用完整状态变更 allowlist/元数据覆盖并补故障测试 |
| P1-05 | `FAIL` | `http-exception.filter.ts:38-40` 直接 `console.error` 未知异常对象，没有使用现有 redact 工具 | 结构化脱敏日志；用合成秘密/数据库错误做回归 |
| P1-06 | `PARTIAL` | Metrics 重启归零、多副本不聚合；示例告警与实际暴露指标不一致 | 统一 exporter/聚合、补 readiness backlog 指标并验证告警规则 |
| P1-07 | `FAIL` | `docker-entrypoint.sh` 默认 `migrate status`，根/后端 README 仍声称启动自动 `migrate deploy` | 以独立 release job 为唯一真相，修正文档并做生产量级锁评估 |
| P1-08 | `PARTIAL` | OpenAPI 测试覆盖路由/状态码/operationId/`$ref`，未证明 DTO 字段、错误码和授权语义一致 | 增加 schema/DTO/security/error contract diff |
| P1-09 | `PARTIAL` | 有 `npm audit`/Dependabot，但无 SBOM、SAST、历史秘密、镜像 OS/许可证、签名和 provenance 门禁 | 建立供应链工作流并归档不可变产物 |
| P1-10 | `PARTIAL` | 支付记录保存解析后的完整 `notifyPayload`，留存依据、字段最小化、访问和静态加密待确认 | 财务/隐私字段评审；只留权威核账所需最小字段 |
| P1-11 | `BLOCKED` | 未见目标环境连接池预算、五副本 soak、100k 容量与关键 SQL 计划证据 | 生产等价数据库压测，记录 pool、P95/P99、锁/队列恢复 |
| P1-12 | `BLOCKED` | 漏斗有净实收但无真实 CAC、渠道成本、客服/审核/云/TRTC/税务和贡献毛利 | 财务批准单位经济；用真实订单样本校准 |
| P1-13 | `PARTIAL` | 现有多份审查报告测试数量不一致，`gate-results.md` 还是历史快照 | 所有报告带 SHA/环境/失效日期；当前证据统一进入本目录模板 |
| P1-14 | `FAIL` | 当前 main 未见可用分支保护/ruleset，HEAD 无关联 PR，仓库无正式 tag/release；缺少 CODEOWNERS 与紧急变更流程 | 建立受保护 main、必需检查、双人审批、不可变 tag/release notes 和可审计紧急变更流程 |
| P1-15 | `FAIL` | 备份恢复有模板，但未见独立 incident-response、on-call 和 postmortem runbook | 建立事故分级、值班、升级、通信、复盘和季度演练记录 |

## 5. P2｜演进项

| ID | 发现 | 触发器 |
|---|---|---|
| P2-01 | Orders、Payments、Companions、Commercial service 均超过约 2,300 行；Orders↔Payments 有双向模块依赖 | 团队冲突、测试定位或故障隔离成为实测瓶颈时拆状态机/网关/协调层 |
| P2-02 | `originalUrl` 与无界客户端 `x-request-id` 可能造成查询内容记录或日志放大 | 与 P1-05 一起限制/脱敏并补测试 |
| P2-03 | 大量内联 SQL 增加类型、计划和审计成本 | SQL 热点、升级或生产计划回归时建立统一封装/探针 |

## 6. 本轮只读验证摘要

| 检查 | 当前结果 | 证据边界 |
|---|---|---|
| `npm run test:preflight` | 74 total / 67 pass / 7 skipped / 0 fail | 7 项需真实/可丢弃 PostgreSQL，不能记为全通过 |
| `npm run verify:cloudbase-template` | PASS | 只证明模板结构 |
| 小程序 `validate.mjs`（语法占位 AppID） | PASS：31 pages / 5 tabs | 不证明真实 AppID、微信审核或真机 |
| admin/review 静态 JavaScript `node --check` | PASS | 只证明语法 |
| `git diff --check` | PASS | 不证明功能正确或工作树干净 |
| `.env.production.example` deployment preflight | 预期 FAIL：35 项 | 正确证明模板不会伪装成生产配置 |

## 7. Finding 与控制项映射

本文件中的 `P0-*` / `P1-*` 是本轮 finding ID，不是 canonical Control ID。正式候选必须将其录入总控制台账并绑定实际 Evidence ID、等级、owner、reviewer、截止和失效时间。

| Finding | 主要 canonical control | related controls |
|---|---|---|
| P0-01 / P0-02 | QR-16 | CG-13、AD-14 |
| P0-03 | AD-14 | SP-06、QR-10 |
| P0-04 | CG-02 | CG-03、CG-04、CG-05 |
| P0-05 | TF-04 | TF-05、TF-07、TF-10 |
| P0-06 | PM-04 | CG-07、TF-08、TF-13 |
| P0-07 | QR-08 | QR-12、GC-04 |
| P0-08 | QR-07 | QR-06、TO-11、TO-12 |
| P0-09 | TO-12 | TO-09、TO-11、TO-14 |
| P0-10 | QR-04 | QR-02 |
| P0-11 | QR-01 | QR-02、SP-12 |
| P0-12 | SP-05 | CG-06 |
| P0-13 | CG-11 | CG-C03 |
| P0-14 | CG-12 | CG-C04 |
| P0-15 | QR-02 | CG-C06、D-003 |

## 8. 本轮未做与不可误读

- 未执行生产迁移、部署、真钱、退款、投诉回复、消息发送、TRTC 或任何外部写操作。
- 未读取或写入真实秘密；checkout 无 `.env.production` 不能被写成“生产没有秘密”，只能写成“本轮无法验证”。
- 2026-08-02 的 `141 suites / 1265 tests` 是历史快照，本轮最终 G1 仍需在干净 checkout 对同一候选重新归档。
- `docs/production-checklist.md` 中既有 `[x]` 没有本候选 SHA、Evidence ID 或失效日期，当前一律按 `STALE` 处理；不得用其覆盖当前红色 CI。
- 代码审查不能证明政策批准、人工在岗、备份可恢复或用户实际获得安全服务。
