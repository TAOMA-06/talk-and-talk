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
| `POST` | `/auth/refresh` | 无 | 刷新 access/refresh token |
| `POST` | `/auth/logout` | Bearer | 撤销 refresh token |
| `GET` | `/users/me` | Bearer | 获取当前用户 |

## 请求与响应

### POST /auth/sms/send-code

请求：

```json
{ "phone": "13800138000" }
```

响应 `data`：

```json
{ "expiresInSeconds": 300 }
```

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

## 错误码

| code | HTTP | 场景 |
|---|---|---|
| `RATE_LIMITED` | 429 | 验证码发送过频 |
| `INVALID_PHONE` | 400 | 手机号格式无效 |
| `INVALID_VERIFICATION_CODE` | 401 | 验证码错误或过期 |
| `INVALID_APPLE_TOKEN` | 401 | Apple token 无效 |
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

开发环境 `SMS_PROVIDER=mock` 时，验证码会输出到 API 日志。

## iOS 配置

| 配置项 | 说明 |
|---|---|
| `BACKEND_BASE_URL` | 后端地址；Debug 默认 `http://127.0.0.1:3000`，Release 必须显式配置 |
| Keychain | access/refresh token 持久化 |
| Sign in with Apple | 需启用 `TalkAndTalk.entitlements` |

登录成功后，iOS 使用 Bearer token 调用受保护接口；401 时自动 refresh 并重试一次。
