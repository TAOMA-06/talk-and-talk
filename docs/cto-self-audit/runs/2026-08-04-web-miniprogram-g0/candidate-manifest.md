> **历史归档 / 非当前状态（已被替代）：** 本文件记录的是基于 2026-08-07 脏基线 `main@9cf5e3849a9654ddfddb8046bf29a580533fa268` 的历史 G0 包，已被[当前 G1 修复运行状态](../2026-08-08-g1-remediation/state.md)替代（`G1 NO-GO`、`G2-ready NO-GO`、`G2 BLOCKED`）。不得将其用作当前候选、E2、G1、G2-ready、G2、CI、发布、授权或任何外部证据。

# Candidate delivery package — G1 Go / G2-ready (G2 BLOCKED)

> Generated 2026-08-07 Asia/Shanghai for task `2026-08-04-web-miniprogram-g0`.
> Worktree implementation candidate on baseline `main@9cf5e3849a9654ddfddb8046bf29a580533fa268` with in-tree changes (not yet committed/pushed).
> **G2 Gate: BLOCKED** — no staging deploy, WeChat trial upload, or dual-role device E3 executed.
> **G3: No-Go** — production credentials, real money, KYC vendor selection, and ops remain out of scope.

## Identity

| Field | Value |
|---|---|
| Baseline SHA | `9cf5e3849a9654ddfddb8046bf29a580533fa268` |
| Candidate nature | dirty worktree implementation complete / G1 local gates |
| Branch | `main` |
| External writes | none authorized / none performed |

## Lockfile / artifact hashes (SHA-256)

| Path | SHA-256 |
|---|---|
| `frontend/web/package-lock.json` | `3c71416521db2338d3b15c17e85bf5db8346ab2afef364b5616edc500596cb5c` |
| `backend/api/package-lock.json` | `657491bd9d480bf01d6a1ad04b99db2c65d0c8e143b462ecdbe086b3fb37fc73` |
| `frontend/miniprogram/package-lock.json` | `6e87a27ba3eaf3c4788e15bd323402982490067aff8221682fc15063779347e8` |

## Release surface manifest

### Included (first-release candidate)

- Web public marketing: `/`, `/how-it-works`, `/safety`, `/about`, `/partners`
- Mini Program consumer main chain + companion fulfillment (text-only)
- Shared OpenAPI identity hard-gate contract + Nest community/conversations gates
- Personalization default-off (MP-D07 / P0-14)

### Excluded / production-refused

- Deferred Web App: `/discover`, `/login`, `/community`, `/orders`, `/messages`, `/profile`, `/workbench`, `/companions/*` when `WEB_SURFACE_MODE=production`
- `/business`, `/demo` when production candidate without `WEB_ENABLE_PRIVATE_SURFACES`
- `/api/session/*`, `/api/backend/*` when `WEB_SURFACE_MODE=production`
- Media upload, voice intro playback, TRTC/UserSig, voice SKU activation (global text-only)
- iOS, live, group chat, membership/coins/gifts, real payment E3

## Local gate evidence (same baseline SHA)

> Re-verified 2026-08-07T07:27–07:30Z UTC. Logs under `evidence/` and scratch mirror.

| Gate | Result | Evidence file |
|---|---|---|
| Ownership revalidate | PASS | `evidence/g0-revalidate-status.txt` |
| Shared P0 unit tests (shipped services) | PASS **115** tests / 7 suites (includes `CompanionsService.updateOwn` voice-intro refuse) | `evidence/shared-p0-tests.log` |
| Web surface-policy + miniprogram-entry unit | PASS **10** | `evidence/web-policy-tests.log` |
| Web `npm run check` #1 | PASS (policy 10 + rendered-html 16) | `evidence/web-check-1.log` |
| Web `npm run check` #2 | PASS (consistent with #1) | `evidence/web-check-2.log` |
| Mini validate/tsc/smoke/local-copy | PASS (AppID warning only; smoke 835 API calls) | `evidence/mini-gates.log` |
| API preflight + build + test | PASS **1298** tests / 143 suites | `evidence/api-gates.log` |
| API e2e (identity/order/payment) | **SKIPPED honestly** — no `DATABASE_URL`; default local DB missing; Redis PONG only | `evidence/api-gates.log` (`E2E_STATUS`) |
| `git diff --check` | PASS | `evidence/api-gates.log` / `evidence/candidate-manifest.txt` |
| Structural proof (grep shipped wiring) | PASS | `verification-rerun-2026-08-07.txt` |

## Residual P0 / P1 register

| ID | Pri | Item | Owner | Blocks |
|---|---|---|---|---|
| R0-01 | P0 | Pre-existing dirty Web marketing assets remain user-owned; not overwritten | product | G1 content polish only |
| R0-04 | P0 | Staging / trial / device / real money not authorized | root | G2 |
| R0-08 | P1 | Companion earning hold appeal API/UI incomplete | Mini | G1 complete but residual |
| R0-09 | P1 | Companion order write 403 negative E2E (server uses ORDER_NOT_FOUND ownership hide; client role fail-closed added) | shared | evidence depth |
| R0-10 | P1 | Historical voice SKU dormant data migration UX | Mini | residual |
| R0-13 | P1 | G2 package still uses non-secret placeholders (no real account/device refs) | QA | G2-ready materials only |

## Rollback notes

1. **Code**: discard or revert worktree changes for identity gate, surface policy, Mini text-only, personalization default, and OpenAPI 403 docs; re-run gates.
2. **DB**: migration `20260807010000_recommendation_personalization_default_off` only changes column default to `false` — safe reverse: `ALTER COLUMN "personalizationEnabled" SET DEFAULT true` (does not rewrite rows).
3. **Config**: production website without `WEB_SURFACE_MODE=production` does not enforce candidate lock; ensure deploy bindings set it before traffic.
4. **No production deploy performed** — no cloud/DNS/WeChat rollback required for this package.

## G2-ready execution package (templates only)

See `handoff.md` G2-ready skeleton. Required fields remain placeholders without secrets:

| Registry | Status |
|---|---|
| Non-secret account refs | pending authorization |
| Test data fixtures + cleanup | design-only |
| Device / OS / WeChat / a11y matrix | pending device auth |
| Staging host / TLS / callbacks | no external environment verified |
| WeChat experience upload | blocked / unauthorized |

### Scenario status (unchanged Gate G2 BLOCKED)

All `G2-*` scenarios in `handoff.md` remain `blocked` except local isolation evidence `G2-ISO-01` prepared.

## Sign-off claims allowed

- Implementation complete for SHARED-01 / WEB-01 / Mini G1 blockers under waived MODEL-D06
- G1 local gates green on baseline SHA + worktree
- G2-ready materials prepared
- **Must not claim**: G2-validated, staging passed, trial uploaded, dual-role device E3, G3 Go
