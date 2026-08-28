# Mini Program 全用户场景录制环境交接

## 当前状态

**环境已准备完成，API 保持运行，尚未操作 Developer Tools GUI，也未开始录制。**

- 分支：`codex/g1-text-only-release-candidate`
- HEAD：`ea11230f19b169863e5579b5992796228d0ac222`
- API：`http://127.0.0.1:32028`，PID `98767`
- PostgreSQL：`talk_and_talk_miniprogram_full_20260828_ea11230f_01`
- Redis：DB `11`
- 本地项目：`/var/folders/pz/sz1jvfhx5m3fsqc7j3f63rwm0000gn/T/talktalk-miniprogram-full-20260828-ea11230f-project`
- API Base：`http://127.0.0.1:32028/api/v1`

117 个 migration、当前 seed 和 API build 已完成。基础环境 11 / 11、U0/U1/P1/R1 场景 13 / 13 断言通过。

## 场景身份

| Profile | 含义 | 临时 storage payload |
|---|---|---|
| U0 | 普通客户，全空订单/会话/客服/通知状态 | `.../runtime/devtools-storage-payload.json` |
| U1 | 普通客户，含 pending/paid/refunded 订单、会话、成功退款、open 客服记录和通知 | `.../runtime/u1/devtools-storage-payload.json` |
| P1 | seed `c1` 陪伴者 owner，能看到 U1 的三类服务单与陪伴者工作台 | `.../runtime/p1/devtools-storage-payload.json` |
| R1 | restricted 客户，可读限制记录与最小账号权利入口，写操作返回 403 | `.../runtime/r1/devtools-storage-payload.json` |

上述 `...` 均为 `/private/tmp/talktalk-miniprogram-full-20260828-ea11230f`。文件权限为 0600；不要打开到录屏画面或复制进 artifact。

## 主代理接手步骤

1. 在 WeChat Developer Tools 中导入本地项目路径。该副本不含 AppID，项目名为 `talk-and-talk-local-do-not-upload`，禁止上传。
2. 由于 access token 为短期令牌，开始注入前先刷新四个 profile：

   ```bash
   env \
     DEMO_API_BASE=http://127.0.0.1:32028/api/v1 \
     DEMO_RUNTIME_ROOT=/private/tmp/talktalk-miniprogram-full-20260828-ea11230f/runtime \
     node "/Users/taoma/Documents/talk and talk/artifacts/practical-demo/miniprogram-full-scenarios-20260828/verification/refresh-profile-sessions.mjs"
   ```

3. 按 [SESSION_INJECTION_HANDOFF.md](SESSION_INJECTION_HANDOFF.md) 注入目标 profile 的四个 storage 键。自动注入时将 `DEMO_RUNTIME_DIR` 指向对应 profile 目录；U0 指向 `runtime` 本身。
4. 重新编译或重进首页，再用界面确认：
   - U0：发现页有 c1–c4；订单、消息、客服、通知为空。
   - U1：订单页有 pending / paid / refunded；消息页有 c1；客服中心和通知中心有记录。
   - P1：陪伴者资料为 c1；服务单能看到 U1 三类订单。
   - R1：账号页显示 restricted 处置；读取可用，任何写入仍应被拒绝。
5. 确认画面中不显示 payload、手机号、验证码、JWT 后再开始录制。

## Fixture 边界

场景扩展由 artifact-local、数据库名硬编码门禁的 Prisma 脚本生成。两次不满足数据库守卫的尝试均在事务内完整回滚：

- 未给没有 StaffCredential 的 seed admin 伪造工单分配。
- 未伪造账号处置 evidence 引用或摘要。

最终合法快照使用 open/unassigned 客服记录，以及四个 evidence 字段全空的 R1 restriction。支付与退款记录只用于本地可见状态，不调用 provider，不证明真实资金事实。

## 已知限制

- Mac 在交接时锁定，本轮没有操作 Developer Tools GUI。
- 没有真实微信登录、AppID、订阅送达、真钱支付或 provider 回调。
- R1 使用 restricted。banned token 会被当前 guard 拒绝，无法作为连续可浏览场景，因此未准备。
- 正式 text-only / identity-authority 门禁仍保持；fixture 不代表新订单入口可在生产开放。

## 证据

- `environment-manifest.json`
- `verification/runtime-verification.json`
- `verification/snapshot-fixture-manifest.json`
- `verification/snapshot-runtime-verification.json`
- `verification/customer-session-manifest.json`
- `verification/u1-session-manifest.json`
- `verification/p1-session-manifest.json`
- `verification/r1-session-manifest.json`
- `logs/setup.log`
- `logs/api.log`

## 清理

录制结束后执行：

```bash
zsh "/Users/taoma/Documents/talk and talk/artifacts/practical-demo/miniprogram-full-scenarios-20260828/cleanup.sh"
```

脚本只针对本轮 PID/端口、数据库名、Redis DB 11 和两个精确临时目录。它会删除本轮数据库与临时项目；当前尚未执行。
