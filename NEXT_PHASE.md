# 下一阶段（明确不在 v0.1 发行范围）

本文件记录**已知未完成**能力。v0.1 发行前收口只做测试、文档、契约冻结、空错态与打包，**不实现**下列项。

## 产品能力

| 项 | 说明 |
|----|------|
| 复杂推荐 | 个性化排序、协同过滤、运营位策略 |
| 人脸 / 实名核验 | 当前 18+ 流程为本地 UX，非公安/人脸核身 |
| 多支付渠道 | 支付宝等；仅微信路径存在 |
| 微信商户联调 | `RealWeChatPayProvider` 已实现 prepay/平台证书验签/回调解密；**仍需真实商户号与沙箱/生产联调**后方可收款 |
| 真实短信 | Aliyun / Tencent 等；production 当前策略为 **仅 Apple 登录**（`SMS_PROVIDER=none`） |
| 完整社区系统 | 广场后端化、动态流、关注、评论持久化 |
| 评价同步服务端 | iOS 评价仍可本地，未作为正式 API 契约 |
| 推送通知 | 当前仅应用内通知列表，无 APNs |
| 语音通话完整化 | 麦克风权限文案已备，完整 RTC 未作为 v0.1 门禁 |

## 工程与运维

| 项 | 说明 |
|----|------|
| e2e / smoke 在依赖环境证明 | CI 已加；本机无 Docker/Postgres 时需换环境补跑 |
| Nest 传递依赖 audit 清零 | lodash/multer 等需 major 升级评估；禁止盲目 `audit fix --force` |
| OpenAPI 装饰器化 | 当前为手写 `shared/contracts/openapi/v1.yaml` |
| 微信证书 Docker secret 默认挂载 | 见 `infra/secrets/README.md`；compose 中 volume 默认注释，生产部署时启用 |
| 托管 DB / Redis | 现为 compose 容器形态 |
| UITests 全量对齐登录门控 | 单元测试为主；UI 回归以手工清单为准 |
| APNs / 监控告警接入 | 见 production-checklist |

## v0.1 已交付边界（对照）

- `/api/v1` 契约冻结（OpenAPI + 兼容规则）
- Auth（手机 mock / Apple）、companions、订单 mock 支付（staging）、c1–c3 聊天审核、通知、Admin
- production：禁 Mock 支付、仅 Apple 登录、compose/nginx 硬化模板
- iOS 登录门控；Staging scheme 指向 staging API；Release 隐藏手机登录
- CI：API unit/e2e + iOS unit workflows
- staging/prod 部署与回滚、备份脚本、生产检查清单文档

变更上述「下一阶段」项时，请同步更新本文件与根 `README.md` 能力边界。
