# Auth API

Talk&Talk 正式账号体系 API，前缀均为 `/api/v1`。所有 JSON 响应使用统一 envelope：

- 成功：`{ data, meta: { requestId, timestamp } }`
- 失败：`{ error: { code, message, details? }, meta }`

## 端点

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| `POST` | `/auth/sms/send-code` | 无 | 发送手机验证码 |
| `POST` | `/auth/phone/login` | 无 | 手机号 + 验证码登录 |
| `POST` | `/auth/apple` | 无 | Apple Sign-In 登录 |
| `POST` | `/auth/wechat/mini-program` | 无 | 小程序 `wx.login` code 登录 |
| `GET` | `/auth/wechat/mini-program/status` | 无 | 只返回服务端是否已配置小程序凭证，不返回凭证值 |
| `POST` | `/auth/refresh` | 无 | 刷新 access/refresh token |
| `POST` | `/auth/logout` | Bearer | 撤销 refresh token |
| `GET` | `/users/me` | Bearer | 获取当前用户 |

## 请求与响应

### POST /auth/sms/send-code

请求：

```json
{ "phone": "13800138000" }
```

响应 `data`（`SMS_PROVIDER=mock` 且非 production）：

```json
{ "expiresInSeconds": 300, "devCode": "123456" }
```

`devCode` 仅在 `APP_ENV != production` 且 `SMS_PROVIDER=mock` 时返回，便于 staging smoke。

**生产（`SMS_PROVIDER=none`）：** 返回错误 envelope，`error.code = SMS_UNAVAILABLE`（HTTP 503）。  
当前商业策略为 **production 仅 Sign in with Apple**；手机号登录待接入真实 SMS 后恢复。

### POST /auth/phone/login

请求：

```json
{ "phone": "13800138000", "code": "123456" }
```

响应 `data`：

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "expiresIn": 900,
  "user": {
    "id": "uuid",
    "role": "user",
    "profile": {
      "displayName": null,
      "phone": "138****8000",
      "gender": null,
      "isVerified": false,
      "safetyScore": 80
    }
  }
}
```

### POST /auth/apple

请求：

```json
{ "identityToken": "..." }
```

响应同 `phone/login`。

### POST /auth/wechat/mini-program

请求：

```json
{ "code": "wx.login 返回的短期凭证" }
```

服务端使用 `WECHAT_MINIPROGRAM_APP_ID` / `WECHAT_MINIPROGRAM_APP_SECRET` 交换 OpenID，并以 `wechatMiniProgram` 身份创建或读取账号。响应同 `phone/login`。

- AppSecret 和微信 `session_key` 不会返回给客户端，也不写入数据库。
- 首发不会将 Apple、手机号和微信身份自动合并；账户绑定必须由后续显式流程完成。

### GET /auth/wechat/mini-program/status

供部署探针确认 AppID 与 AppSecret 是否同时存在，不会返回任何凭证内容：

```json
{
  "module": "wechatMiniProgram",
  "status": "configured",
  "configured": true
}
```

### POST /auth/refresh

请求：

```json
{ "refreshToken": "..." }
```

响应 `data`：

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "expiresIn": 900
}
```

旧 refresh token 轮换后不可再次使用。

### POST /auth/logout

请求头：`Authorization: Bearer <accessToken>`

请求：

```json
{ "refreshToken": "..." }
```

响应 `data`：

```json
{ "success": true }
```

### GET /users/me

响应 `data` 同登录响应中的 `user` 对象。

## 角色与 RBAC

用户角色：`user`、`companion`、`moderator`、`admin`。

受保护的管理端示例：

- `GET /admin/status` 需要 `admin` 角色
- `GET|POST /admin/moderation/*` 需要 `moderator` 或 `admin`
- `GET /moderation/cases` 需要 `moderator` 或 `admin`

开发 seed phone 身份（API 测试兼容；Web 审核后台改用密码 + TOTP）：

| 手机号 | 角色 |
|--------|------|
| `13800000001` | admin |
| `13800000002` | moderator |

## 错误码

| code | HTTP | 场景 |
|---|---|---|
| `RATE_LIMITED` | 429 | 验证码发送过频 |
| `INVALID_PHONE` | 400 | 手机号格式无效 |
| `INVALID_VERIFICATION_CODE` | 401 | 验证码错误或过期 |
| `STAFF_LOGIN_FAILED` | 401 | 员工密码、TOTP、账号状态或防重放校验失败（统一响应） |
| `STAFF_LOGIN_RATE_LIMITED` | 429 | 员工登录尝试过多 |
| `INVALID_APPLE_TOKEN` | 401 | Apple token 无效 |
| `INVALID_WECHAT_CODE` | 401 | 小程序登录凭证无效或过期 |
| `WECHAT_LOGIN_UNAVAILABLE` | 502 | 无法连接微信登录服务 |
| `WECHAT_MINIPROGRAM_LOGIN_UNAVAILABLE` | 503 | 未配置小程序登录凭证 |
| `UNAUTHORIZED` | 401 | JWT 缺失/无效/refresh 已撤销 |
| `FORBIDDEN` | 403 | RBAC 权限不足 |

## 环境变量

| 变量 | 说明 |
|---|---|
| `JWT_ACCESS_SECRET` | Access token 签名密钥（production 必填） |
| `JWT_REFRESH_SECRET` | Refresh token 签名密钥（production 必填） |
| `JWT_ACCESS_TTL` | Access token 有效期，默认 `15m` |
| `JWT_REFRESH_TTL` | Refresh token 有效期，默认 `30d` |
| `SMS_PROVIDER` | `mock` / `none` / 未来 `aliyun` `tencent` |
| `SMS_CODE_TTL_SECONDS` | 验证码有效期秒数，默认 `300` |
| `APPLE_SIGN_IN_BUNDLE_ID` | Apple 登录 bundle id |
| `WECHAT_MINIPROGRAM_APP_ID` | 小程序 AppID；同时用于 JSAPI 支付 |
| `WECHAT_MINIPROGRAM_APP_SECRET` | 小程序 AppSecret，只能保存在 API 部署环境 |

开发环境 `SMS_PROVIDER=mock` 时，验证码会输出到 API 日志。

## iOS 配置

| 配置项 | 说明 |
|---|---|
| `FRONTEND_DEMO_MODE` | 仅 Debug 生效；默认 `YES` 时禁用所有后端请求，以本地演示身份进入 App 壳（**不注入虚假陪伴者/广场等市场数据**）。Run Scheme 设为 `NO` 可恢复 Debug 本地 API 联调 |
| `BACKEND_BASE_URL` | 后端地址；Debug 在关闭演示模式后默认 `http://127.0.0.1:3000`，Release 必须显式配置 |
| Keychain | access/refresh token 持久化 |
| Sign in with Apple | 需启用 `TalkAndTalk.entitlements` |

登录成功后，iOS 使用 Bearer token 调用受保护接口；401 时自动 refresh 并重试一次。
