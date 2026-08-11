> **历史归档 / 非当前状态（已被替代）：** 本文件记录的是基于 2026-08-07 脏基线 `main@9cf5e3849a9654ddfddb8046bf29a580533fa268` 的历史 G0 包，已被[当前 G1 修复运行状态](../2026-08-08-g1-remediation/state.md)替代（`G1 NO-GO`、`G2-ready NO-GO`、`G2 BLOCKED`）。不得将其用作当前候选、E2、G1、G2-ready、G2、CI、发布、授权或任何外部证据。

# G1 candidate package index (for adversarial verification)

**Claim:** Implementation complete / G1 local Go / G2-ready  
**Not claimed:** G2-validated, staging, 体验版, 真机 E3, G3 Go, push/deploy

## Read in this order

1. `state.md` — current gates (G1 local PASS, G2 BLOCKED, G3 No-Go)
2. `candidate-manifest.md` — SHA, surfaces, residuals, rollback
3. `validation.md` — append-only command evidence (see 2026-08-07 re-run)
4. `handoff.md` — user-facing next actions
5. `decisions.md` — MP-D05/D07/D08 assumed; MODEL-D06 waived
6. `evidence/*` — raw gate logs
7. `verification-rerun-2026-08-07.txt` — structural grep + exit codes

## Shipped tests that drive real paths

| Test | Entry under test |
|---|---|
| `backend/api/src/users/public-interaction-identity.gate.spec.ts` | pure gate |
| `backend/api/src/community/community.service.spec.ts` | `CommunityService.create` |
| `backend/api/src/conversations/conversations.service.spec.ts` | `ConversationsService.send` |
| `backend/api/src/conversations/conversations.delivery.spec.ts` | send delivery FSM with verified identity |
| `backend/api/src/recommendations/recommendations.service.spec.ts` | personalization default off |
| `backend/api/src/config/first-release-capability-matrix.spec.ts` | text-only matrix |
| `frontend/web/tests/web-surface-policy.test.mjs` | production disposition |
| `frontend/web/tests/miniprogram-entry.test.mjs` | CTA allowlist/fallback |
| Mini `scripts/smoke.mjs` | client text-only + personalization off defaults |

## Hold G2

No Phase 7 authorization. Do not promote G2 until staging/体验版/真机 are authorized and executed.
