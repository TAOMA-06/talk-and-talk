# G0 决策与确认

> 用户已在当前任务回合确认四项默认。以下记录作为 G0 放行事实，不等于授权部署、上传体验版或其他外部写操作。

| Decision ID | 推荐默认 | 需要用户确认的原因 | 当前状态 |
|---|---|---|---|
| G0-D01 | 官网解释/导流；小程序完成真实服务；交易 Web 延期 | 决定 Web 的代码、路由、验收和发布边界 | confirmed / 2026-08-04 |
| G0-D02 | Web 交易路由使用 feature flag + 404/跳转或独立未发布域名；不依赖 noindex | 决定 production candidate 的访问控制方式 | confirmed / 2026-08-04 |
| G0-D03 | `/business`、`/demo` 默认私密；逐条核验证据后再决定公开 | 当前主体、案例、合作与演示证据尚未成为已签字发布材料 | confirmed / 2026-08-04 |
| G0-D04 | BFF/交易集成只保留隔离 development；不作为公共官网完成条件 | 决定是否把 Web API、支付、聊天和部署纳入本轮范围 | confirmed / 2026-08-04 |
| MP-D05 | 首发按全局 `text-only` 处理：媒体读写、语音介绍、历史附件播放、案件举证上传和 TRTC/voice SKU 均不可达；如必须保留安全举证，另行定义最小、不可公开传播且服务端强制的例外 | 当前代码仍保留若干媒体入口；没有唯一口径就无法形成同一能力矩阵、负例和 G1 证据 | assumed default enforced 2026-08-07 (goal OBJECTIVE guide default; no media exceptions) |
| MODEL-D06 | 没有可调用 Luna max/Ultra 时暂停写代码；只有用户提供明确 Evidence ID 才能指定替代模型 | 保护用户指定的 writer model 约束，避免静默降级 | **waived** 2026-08-07 by goal OBJECTIVE (“模型相关问题可忽略”); writer = Grok 4.5 |
| MP-D07 | 算法治理/适用性结论未闭环前，默认关闭个性化推荐；保留不依赖个人特征的手动发现、显式关键词和当前可售目录 | 当前 OpenAPI 与 smoke 仍覆盖个性化推荐和行为标签；不先关闭会触发 P0-14 生产阻断 | enforced implemented 2026-08-07 (default off in service + schema) |
| MP-D08 | 不自行选择实名/KYC 提供方；先由产品/合规明确实名权威来源、状态枚举、有效期、恢复路径、字段与法律依据，再实现共享身份门 | 当前主要事实为布尔 `profile.isVerified`，普通用户没有可执行的实名恢复链 | assumed default enforced 2026-08-07: use existing `profile.isVerified` server signal + stable error/recoveryPath; no new KYC vendor |

## 确认记录

用户确认内容：

```text
G0-D01：确认默认
G0-D02：确认默认
G0-D03：确认默认
G0-D04：确认默认
```

后续若改变任一决策，必须先更新本文件和 `state.md`，再重新排 Phase 1/2 切片。
