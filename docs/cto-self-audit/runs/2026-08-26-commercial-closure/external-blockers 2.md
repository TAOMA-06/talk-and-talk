# 2026-08-26 外部门禁

下列项目不是继续修改仓库即可取得的证据。任何一项缺少有权主体提供的原始收据和独立复核，生产必须保持 **NO-GO**。

| 级别 | 门禁 | 当前事实 | 放行证据 |
|---|---|---|---|
| P0 | 可撤销身份 authority | 仓库没有可证明、可撤销、可到期的真实授权来源；新订单、预支付、发布和消息因此失败关闭 | 供应商/主管机关合同与接口、撤销/过期/重核验演练、数据保护与故障回退收据 |
| P0 | 公共 DNS 与 TLS | 2026-08-26 Google Public DNS 对 `api`、`api-staging`、根域和 `www` 均返回 NXDOMAIN | 权威 DNS 变更、证书、外部解析与 TLS 验证 |
| P0 | 微信发行与资金 | production/staging 示例中的 `WECHAT_MINIPROGRAM_APP_ID` 为空；主体、类目、隐私接口、商户、支付/退款和订阅模板无本轮外部收据 | 微信后台审批、AppID/商户受控引用、真实测试商户全链路与对账收据 |
| P0 | 供给与真实 KYC | 代码只能保存受控外部引用，不能证明陪伴者本人、成年、协议、税务和收款对象真实有效 | KYC/签约/税务供应商原始结果及人工复核 |
| P0 | 法务与运营 | 产品边界、退款、留存、法律留置、危机资源、未成年人、发票/税务和 24/7 声明没有最终签字 | 法务批准、版本号、负责人、值班表和演练记录 |
| P0 | 生产基础设施 | 本轮只验证一次性本机 PostgreSQL/Redis；没有生产 TLS、监控、备份恢复、容量和回滚证据 | 受控 staging/生产演练、监控告警、RPO/RTO、容量和回滚收据 |
| P1 | 真机与可访问性 | 小程序只有静态/模拟运行证据 | 授权 AppID 的体验版、双真实设备、弱网、权限、无障碍和关键路径录像/日志 |
| P1 | 受保护远端候选 | `gh auth status` 显示当前 GitHub token 无效；当前分支无本轮远端受保护 CI 结果 | 新的最小权限认证、干净冻结 SHA、独立受保护 runner/CI、同 SHA 制品与审查收据 |

公共 DNS 只读查询：

- [api.talkandtalk.app](https://dns.google/resolve?name=api.talkandtalk.app&type=A)
- [api-staging.talkandtalk.app](https://dns.google/resolve?name=api-staging.talkandtalk.app&type=A)
- [talkandtalk.app](https://dns.google/resolve?name=talkandtalk.app&type=A)
- [www.talkandtalk.app](https://dns.google/resolve?name=www.talkandtalk.app&type=A)
