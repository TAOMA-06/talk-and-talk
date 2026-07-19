# Secrets (not committed)

Place host-side secrets here for production mounts. All `*.pem` files are gitignored at the repo root; this directory is under `infra/secrets/`.

## WeChat Pay merchant private key

1. Export the merchant API private key from WeChat Pay merchant platform.
2. Save as `infra/secrets/wechat_private_key.pem` (mode `600`).
3. Set this host path in the deployment env file:

```yaml
WECHAT_PAY_PRIVATE_KEY_HOST_PATH=./secrets/wechat_private_key.pem
```

API 容器以非 root 的 `node` 用户（UID/GID 1000）运行。生产 PEM 应由部署机安全下发，并确保容器用户只读可访问，例如属主/组映射到 1000 且权限不宽于 `0440`；不要为了绕过权限问题使用 `0777`。

4. Set `WECHAT_PAY_PRIVATE_KEY_PATH=/run/secrets/wechat_private_key.pem` in `backend/api/.env.production` and deploy with `--env-file backend/api/.env.production`.

Never commit real keys or API v3 keys.

For CloudBase, do not create this file or mount a volume. Store the PEM in the service's encrypted `WECHAT_PAY_PRIVATE_KEY` environment variable instead; either real newlines or literal `\n` separators are accepted. Use only one of `WECHAT_PAY_PRIVATE_KEY` and `WECHAT_PAY_PRIVATE_KEY_PATH`.
