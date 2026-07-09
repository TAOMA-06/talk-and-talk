# Talk&Talk API Contracts

## Status: `/api/v1` frozen for release

Machine-readable OpenAPI 3 document:

- [`openapi/v1.yaml`](./openapi/v1.yaml)

Human-readable companions (keep in sync when changing behavior):

- [`docs/auth-api.md`](../../docs/auth-api.md)
- [`docs/admin-moderation-api.md`](../../docs/admin-moderation-api.md)
- [`docs/backend-migration.md`](../../docs/backend-migration.md) (full route inventory)

## Compatibility rules (v1)

Allowed without a version bump:

- Additive response fields (clients must ignore unknown keys)
- New optional request fields with safe defaults
- New endpoints under `/api/v1`

Breaking changes require either:

1. A new prefix (`/api/v2`), or
2. Explicit written approval + coordinated iOS release notes

Breaking examples (do **not** ship silently):

- Removing or renaming fields used by iOS
- Changing envelope shape (`data` / `error` / `meta`)
- Changing auth error codes that the app maps to UI copy
- Changing payment notify semantics or order status transitions

## Envelope

All JSON API responses:

```json
{
  "data": {},
  "meta": { "requestId": "uuid", "timestamp": "ISO-8601" }
}
```

Errors:

```json
{
  "error": { "code": "STRING", "message": "human readable", "details": {} },
  "meta": { "requestId": "uuid", "timestamp": "ISO-8601" }
}
```

`x-request-id` is echoed on the response header and in `meta.requestId`.

## Validation

```bash
# Optional: validate YAML syntax
# From repo root:
python3 -c "import yaml; yaml.safe_load(open('shared/contracts/openapi/v1.yaml'))"

# Contract smoke (integration / e2e)
cd backend/api && npm run test:integration
```

Static admin UI at `/admin/` is **outside** the OpenAPI surface (HTML + staff JWT).
