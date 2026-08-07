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
