# Secrets (not committed)

Place host-side secrets here for production mounts. All `*.pem` files are gitignored at the repo root.

## WeChat Pay merchant private key

1. Export the merchant API private key from WeChat Pay merchant platform.
2. Save as `secrets/wechat_private_key.pem` (mode `600`).
3. Uncomment the `api` volume in `docker-compose.prod.yml`:

```yaml
volumes:
  - ${WECHAT_PAY_PRIVATE_KEY_HOST_PATH:-./secrets/wechat_private_key.pem}:/run/secrets/wechat_private_key.pem:ro
```

4. Set `WECHAT_PAY_PRIVATE_KEY_PATH=/run/secrets/wechat_private_key.pem` in `.env.production`.

Never commit real keys or API v3 keys.
