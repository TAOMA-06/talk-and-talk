# 实时语音上线核对表（微信小程序）

> 目的：让“可以写代码”与“可以向真实用户开放实时语音”分开判断。  
> 状态：所有 **必须通过** 项完成前，保持 `TRTC_ENABLED=false` 且 `TRTC_ROOM_CONTROL_ENABLED=false`。

## 1. 当前技术规则

```text
客户发起预约
  → 陪伴者手动接单或拒单
  → 客户在保留期内完成支付
  → 陪伴者在服务窗口内手动开始服务
  → 订单双方进入同一实时语音房间
  → 服务结束 / 完成 / 售后
```

实时语音不是聊天入口，也不是语音留言。只有订单为 `voice`、已人工接单、`inService`、未到服务结束时间、且没有进行中的售后处理时，服务端才签发短效凭证。退款申请、服务完成和服务窗口结束会由服务端解散已有房间；小程序必须处理被踢出事件并回到订单。

小程序 RTC 的真实接入顺序是：创建 `trtc-wx-sdk` 推流器 → 将 `enterRoom` 返回的短效运行时属性绑定到原生 `live-pusher` → 调用 `start()`。`UserSig` / `PrivateMapKey` 只能留在这次页面内存和原生组件运行时属性中，不写入 storage、日志或分析系统。

每张订单的 `PrivateMapKey` 权限位固定为 `15`：仅包含“创建房间、进入房间、发送语音、接收语音”。它**不含**发送/接收视频或屏幕共享权限，因此客户端界面被篡改为尝试打开摄像头时，TRTC 服务端仍应拒绝该媒体能力；不得把这个值扩展为 `16`、`32`、`64` 或 `128`，除非视频服务另行完成隐私、审核与发布评审。[TRTC 高级权限控制](https://cloud.tencent.com/document/product/647/35157)

## 2. 上线状态

| 项目 | 状态 | 简单说明 |
|---|---|---|
| 订单权限代码 | **调整** | 代码和单元测试已完成；不允许客户跳过人工接单、支付或陪伴者手动开场。 |
| 语音安全关闭 | **调整** | `TRTC_ENABLED=false` 或紧急清场时，公开语音商品/筛选会隐藏；创建、确认、支付、开始服务和入房仍由服务端二次拒绝。 |
| 服务端签名依赖 | **调整** | 已安装并锁定 `tls-sig-api-v2@1.0.2`。 |
| 小程序 RTC SDK | **调整** | 已安装并锁定 `trtc-wx-sdk@1.1.15`，且已用微信开发者工具完成“构建 npm”。 |
| 语音依赖/构建物门禁 | **调整** | `npm run verify:voice-release-artifacts` 已通过；它只证明依赖和构建产物齐全，不代表真实语音已可开放。 |
| 数据库迁移 | **上线门禁** | 迁移文件已在仓库，仍须在 staging 与 production 的真实数据库执行并留存结果。 |
| 服务端关房代码 | **调整** | 退款、服务完成和超时扫描都会调用 `DismissRoomByStrRoomId`；失败按数据库租约退避重试。 |
| 紧急清场代码 | **调整** | 临时开启后拒绝新入房，并关闭所有已登记但尚未确认关闭的房间；确认清空前不能关闭服务端关房能力。 |
| TRTC 控制台与 CAM | **上线门禁** | 需创建应用、开通所需资源、开启 PrivateMapKey 房间限制，并给云托管运行身份仅授予该 SDKAppId 的 `DismissRoomByStrRoomId`。 |
| 云托管常驻实例 | **上线门禁** | 只要 `TRTC_ENABLED=true`，production 的最小实例数必须至少为 1；到期关房依赖后台 worker，不能让 API 缩到 0。 |
| 小程序资质/类目/权限 | **上线门禁** | 企业主体、允许 `live-pusher`/`live-player` 的类目和相关权限均需实际通过。 |
| 域名白名单 | **上线门禁** | 按腾讯 RTC 当前文档配置请求与业务域名，并用真机验证。 |
| 真机双端验收 | **上线门禁** | 两个真实账号、两台真机完成全流程；开发者工具不能代替。 |
| 录音与内容安全 | **暂停** | 当前不录音、不转写、不声称实时音频已审核；语音留言仍走既有媒体门禁。聊天媒体生产适配器骨架为 `MEDIA_PROVIDER=s3_compatible`（仍须凭证与 `COMMERCIAL_SURFACE=full`，默认 text_only）。 |

## 3. 部署时必须填的服务器变量

这些变量只进入 CloudBase 云托管/密钥管理；绝不写进 `frontend/miniprogram`：

```dotenv
TRTC_ENABLED=true
TRTC_SDK_APP_ID=<腾讯云 SDKAppID>
TRTC_SDK_SECRET_KEY=<腾讯云 SDKSecretKey>
TRTC_PRIVATE_MAP_KEY_ENABLED=true
TRTC_USER_SIG_TTL_SECONDS=300
TRTC_ROOM_CONTROL_ENABLED=true
# 仅发生事故或紧急下线时临时设为 true；正常上线必须保持 false。
TRTC_EMERGENCY_STOP_ENABLED=false
TRTC_CONTROL_REGION=ap-guangzhou
TRTC_CONTROL_TIMEOUT_MS=5000
TRTC_ROOM_CONTROL_INTERVAL_SECONDS=15
TRTC_ROOM_CONTROL_BATCH_SIZE=10
TENCENTCLOUD_SECRET_ID=<仅用于服务端关房的最小权限 CAM SecretId>
TENCENTCLOUD_SECRET_KEY=<仅用于服务端关房的最小权限 CAM SecretKey>
# 仅使用临时腾讯云凭证时填写：
TENCENTCLOUD_SECURITY_TOKEN=
```

运行：

```bash
cd backend/api
npm run preflight:deployment -- .env.production
npm run verify:voice-release-artifacts
npm run verify:cloudbase-template
```

第一个命令会拒绝缺失密钥、占位符、未启用 PrivateMapKey / 服务端关房或无效的短效凭证时长。第二个命令不会安装任何第三方包；它只验证已批准安装的后端签名库已写入锁文件并可解析，且微信开发者工具已为 `trtc-wx-sdk` 生成实际小程序构建产物。第三个命令验证受版本管理的 CloudBase 模板仍使用高可用模式、至少一个常驻实例和现有 Dockerfile，且模板没有任何环境变量或密钥。三项都通过前，保持语音开关关闭。`TRTC_EMERGENCY_STOP_ENABLED=true` 只能在 `TRTC_ENABLED=true` 与 `TRTC_ROOM_CONTROL_ENABLED=true` 时使用；它是“先拒绝新入房、再清空在途房间”的临时状态，不是常态配置。

CAM 不要授予全量腾讯云权限。TRTC 支持按 SDKAppId 做资源级授权；本服务只需要关房动作。[可授权的 TRTC 资源及操作](https://cloud.tencent.com/document/product/647/46765)

## 4. 小程序与服务端网络白名单

以腾讯当期文档和小程序后台实际校验结果为准。除本项目自己的 HTTPS API 域名外，当前 `trtc-wx-sdk` 文档列出的请求域名为：

```text
https://official.opensso.tencent-cloud.com
https://yun.tim.qq.com
https://cloud.tencent.com
https://webim.tim.qq.com
https://query.tencent-cloud.com
https://web.sdk.qcloud.com
```

Socket 域名为：

```text
wss://wss.im.qcloud.com
wss://wss.tim.qq.com
```

CloudBase 云托管还需要允许服务端到 `https://trtc.tencentcloudapi.com/` 的出站访问，供退款/服务结束时关闭字符串房间。腾讯的接口要求使用 `DismissRoomByStrRoomId`、`2019-07-22` 版本和北京或广州地域；该接口默认上限为 20 次/秒，因此代码把扫描批次限制在 10 条、逐条发送，并用数据库中的全局派发租约保证多台云托管实例不会各自并发一批，退款/完成服务的即时关房也不能绕过该租约。[解散房间（字符串房间号）](https://cloud.tencent.com/document/product/647/37088)

## 5. 真机验收步骤（必须逐项记录结果）

1. 客户创建 `voice` 商品的预约；确认此时没有付款和入房入口。
2. 陪伴者用自己的已认证账号手动接单；确认客户获得支付保留期限。
3. 客户完成微信支付；确认仍不能入房。
4. 陪伴者在预约前 15 分钟内手动开始服务；双方订单出现“进入实时语音”。
5. 两台真机进入；确认双方能听见对方、可静音、离开页面后麦克风停止。
6. 用第三个账号、文本服务订单、未接单订单、未开始订单、已结束订单分别访问接口；均应被拒绝。
7. 服务中创建售后申请；两台已入房真机都应收到关房/被踢出并退出，重新进入实时语音应被拒绝，订单工单仍可用。
8. 到达服务结束时间或陪伴者完成服务；两台真机都应退出，新的短效凭证不再签发。
9. 检查审计日志：只应包含订单、房间、角色和时间；不得出现 SDK 密钥、UserSig、PrivateMapKey 或音频内容。
10. 使用短时 admin token 访问 `/api/v1/admin/commercial/readiness`：正常语音运行时 `voiceTerminationBacklog=0`、`voiceEmergencyDrainPending=0` 且 `voiceEmergencyStopActive=0`；演练紧急清场时必须转为 `attentionRequired`，直到清场积压归零。该接口只返回聚合计数和开关状态，不返回房间成员、签名或云密钥。

## 6. 回滚

如果真机、权限、网络、投诉或安全检查任何一项异常：

1. 先保持 `TRTC_ENABLED=true` 与 `TRTC_ROOM_CONTROL_ENABLED=true`，把 `TRTC_EMERGENCY_STOP_ENABLED=true` 发布到云托管。此时服务端立即拒绝新的凭证，关房 worker 则以 `emergency_stop` 原因关闭每一间已登记房间；不要反过来先关闭 room control。
2. 以只读数据库账号确认下列数量为 `0`。如果不是 `0`，保持三项配置不变，检查 CAM、网络和重试审计，不得把它当作已经回滚。

```sql
SELECT count(*) AS unclosed_voice_rooms
FROM "VoiceSession"
WHERE "terminationCompletedAt" IS NULL;
```

3. 数量归零后，才将 `TRTC_ENABLED=false`、`TRTC_ROOM_CONTROL_ENABLED=false`、`TRTC_EMERGENCY_STOP_ENABLED=false` 一起发布并滚动重启；由运营暂停新的语音商品上架/接单，通知受影响订单并走现有退款和客服流程。
4. 保留订单、支付、审计和 `VoiceSession` 记录以便排查；不删除用户数据或历史代码。修复后重新完成一次双端真机验收，才再次启用。

腾讯关于小程序 TRTC 所需主体、类目、组件权限与真机限制的要求以其官方文档为准：[小程序实时音视频接入条件](https://cloud.tencent.com/document/product/647/32399)。小程序原生组件与 SDK 的接入顺序以 [TRTC 小程序 SDK 文档](https://cloud.tencent.com/document/product/647/120921) 为准。
