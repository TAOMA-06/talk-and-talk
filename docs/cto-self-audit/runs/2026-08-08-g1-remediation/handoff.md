# G1 remediation handoff

## Current handoff state

All earlier implementation slices through `G1-FOLLOWUP-12` have completed
automated local validation and independent static review: `SHARED-02A`
(isolated-E2E safety), `SHARED-02A-H` (sealed destructive-entrypoint hardening),
`SHARED-02B` (ordinary text-only server closure), `SHARED-02D`
(contract/refund/role boundaries), `SHARED-02D-R/B-R` (customer-sync and
attendance projection closure), `SHARED-02G` (first-release refund/configuration/
recommendation hard-lock), `WEB-01`, `WEB-03`, `WEB-04`, `WEB-05`, `MINI-02`,
`VALIDATION-02`, `G1-FOLLOWUP-01/02/03/04/05/06/07/10/11/12`, and `QA-02A/B/C/D/OPS/E-A-R`. `G1-FOLLOWUP-13` is now locally implemented and owner-validated under `USER-AUTH-ALL-20260811`, but has no independent F13/candidate review and therefore is not closed as candidate or G1 evidence. `QA-02E-A` is reopened and
superseded; `QA-02E-A-R` is completed at static/local source-contract scope.
`QA-02E-B-A` is completed at static/local metadata-hygiene scope: ordinary
API/Mini/Web/iOS/G1 workflows now execute only fixed Git metadata checks, not
candidate code. Candidate build/test/runtime evidence remains reserved to the
external protected control plane. `QA-02E-B-B` is completed at static/local
structural-contract scope: its browser-card and OCI-custody validators only
reject malformed records and cannot create runtime evidence.
The
baseline was clean at entry, but
the active worktree is now intentionally dirty with uncommitted remediation
code and governance records; it is not candidate evidence. Model provenance is
audit-only under the user's 2026-08-09 instruction.

`WEB-04` closes the final public-CTA code finding: the Mini Program entry now
accepts only `weixin://dl/business/` with no query or a single non-empty
platform `t` token; hostile hosts, paths, query parameters, ports, credentials,
and fragments fall back before rendering. This is not a WeChat-client or
deployed-entry result.

`WEB-05` closes a separately reproduced local production-adapter defect: a
missing optional Worker binding object had produced a public-home `500` before
the request handler. The built Worker now normalizes the optional object, has a
regression test for that call shape, and a freshly rebuilt loopback
`vinext start` served `/` as `200 text/html` with the expected security headers.
The in-app browser isolation could not connect to this local listener, so this
does not replace the outstanding browser interaction, accessibility, or visual
evidence gate.

`SHARED-02D-R/B-R` closes three later source findings without widening product
scope: customer refund sync is owner-scoped and returns only the customer-safe
refund projection; attendance participant and staff responses omit provider
refund identifiers; and text-only attendance reads preserve bilateral text but
return empty attachments and an empty TRTC summary before any historical-event
query. Participant, staff, and claimable queue OpenAPI responses now have
separate strict schemas. The closure is local/static only; Docker E2E and a
frozen candidate remain required.

`QA-02C` closes at static/local scope for both its deterministic SBOM and
fresh-schema migration harness. Schema v4 reconstructs CycloneDX 1.6 from the
three tracked npm v3 locks and binds the future candidate SHA, canonical
source-tree SHA-256, and lock hashes. Its migration harness locally validates
the sealed launcher, immutable artifact/source checks, empty-store checks,
authenticated serial prior/candidate probes, label-verified cleanup, and a
redacted receipt. Any SBOM upload or Docker E2E execution must use the
separately protected external `QA-02E-A-R` control plane; the former
in-repository candidate-CI mechanism is retracted and cannot supply those
claims. No candidate freeze, remote CI, artifact upload, Docker
target, PostgreSQL/Redis action, migration, or external action has been run.

`QA-02D` closes at static/local scope: candidate-required API and Web test
commands now reject skipped/todo/pending/cancelled output; the seven named
PostgreSQL preflight checks cannot silently skip and instead require the sealed
disposable runner; the future external control plane must record
dependency-audit, input-policy, digest-pinned E2E-infrastructure, zero-skip,
and receipt boundaries; and the
operational runbooks are reference-only rather than direct staging/production
recipes. This is source/test/contract evidence only. No dependency-audit
network request, Docker/DB/Redis action, candidate freeze, remote CI, artifact
upload, or external action has been performed.

`QA-02D-OPS` closes at static/local scope after independent review. The three
current operational references are controlled-reference documents; production
smoke is read-only and requires an exact non-secret authorization record before
any request; and mock acceptance smoke is literal-`127.0.0.1`/
local-development only. Both scripts use trusted curl with configuration and
proxy bypass. The production guard uses a real 127.0.0.1 observer: missing,
expired, or mismatched records produced zero connections. No remote API,
Docker, database, Redis, CI, deployment, upload, or external action was
performed.

`SHARED-02G` closes the remaining policy-independent API release-boundary
findings: the customer-refund wrapper now keeps `requestRefund`'s declared safe
`OrderDto` rather than trying to serialize its ISO strings a second time;
staging/production reject a full commercial surface and raw personalization
enablement; and recommendation ranking, behavioural reads, and behaviour-signal
writes stay hard-off until the separately authorized `PERSONALIZATION-R01`
policy work. This does not migrate historical consent or authorize future
personalization. The closure is static/local only; no Docker, database, Redis,
CI, deployment, or external action ran.

`QA-02E-A` was reopened as `QA-02E-A-R` after independent review found that the
candidate checkout still supplied the claimed CI control plane and could reach
Docker before admission. The corrective slice removes the direct
candidate-controlled Docker path and writes a fail-closed source contract for a
separately protected control ref, control-owned authorization resolver binding
one Evidence ID to candidate repository/SHA/tree, candidate-as-data checkout,
digest-pinned image-resident socketless candidate harness, and trusted
admission/denial receipt job. It is complete only at static/local
source-contract scope (`E1-QA-02E-A-R-LOCAL-20260810` and independent review
`E1-QA-02E-A-R-REVIEW-20260810`); it does not authorize or perform a candidate
freeze, CI dispatch, Docker/DB/Redis operation, receipt capture, registry
action, or external request. A distinct release-control repository (or
equivalent externally enforced workflow/runner policy), protected ref/ruleset,
authorization-register administration, runner ACL, and
socket/mount/token/GitHub-command-file/network-egress attestation remain
required external evidence.

`USER-AUTH-ALL-20260811` closes the four former product-choice pauses with the
safest first-release boundaries. `G1-FOLLOWUP-13` freezes identity grants and
treats legacy booleans as unverified for public interaction, resets and
hard-disables personalization, projects companion holds to typed public facts,
and disables payment-dispute response images before storage/provider
forwarding. Text reply, support, reads, orders, fulfilment closure, manual
discovery, and privileged operations remain available where they do not
contradict those choices. This is locally validated implementation, not an
independent candidate review or external runtime result.

## User action needed to unblock implementation

No further product-choice reply is required for F13. The user's blanket
authorization is recorded as `USER-AUTH-ALL-20260811` and delegates the safe
first-release choices, one candidate freeze, one candidate-branch push, and
safe attempts at the separately gated evidence process.

Human/administrator action is still required only where the local repository
cannot supply a real fact: repair GitHub authentication if the branch push or
PR API rejects it; identify the independently administered release-control
repository/ref and runner policy; supply immutable OCI/infrastructure custody,
protected-environment approvals, browser/device/WeChat/staging/provider inputs;
and appoint an independent F13/candidate reviewer. These are not additional
product decisions. Until the facts exist, their rows remain blocked. The
historical `PUSH-R01` remains unknown and is not retroactively repaired.

## Prepared-but-not-ready G2 package

The no-secret execution package is in `g2-execution-package.md`. It contains
authorization registries and 13 per-scenario run cards, but deliberately keeps
credentials, account details, staging URLs, and pass results out of Git.
Populate it only with separately authorized staging, WeChat, device, account,
and data references, then obtain an independent review before changing the
G2-ready gate.

The confirmed product choices and rejected alternatives are retained in
`authority-decision-brief.md`. That product record still does not substitute
for a missing credential, independently protected executor, custody receipt,
device result, or external action result.

The same-SHA candidate and rollback proof structure is in
`candidate-evidence-template.md`. It must be filled only from a future frozen,
clean candidate; this current governance directory is not evidence.

## Current task status

All local source, test, harness, and documentation slices through
`G1-FOLLOWUP-12` are closed at static/local scope and independently reviewed.
`G1-FOLLOWUP-13` has completed implementation and owner validation under the
user's blanket authority; it remains explicitly pending independent
F13/candidate review.
`G1-FOLLOWUP-09` remains explicitly reopened/superseded by
`G1-FOLLOWUP-11`: the shared parser now trusts only complete terminal Jest/TAP
summaries, ignores real console diagnostics that resemble result lines, and
still rejects every actual skip/todo/pending/cancelled outcome. F10 aligns Mini
order detail/list rendering and handlers with the server's historical-voice
text-only boundary while retaining read and closure paths. F12 places the same
superseded/not-current banner before every stale 2026-08-04 package Go/complete
heading without rewriting the historical body or G0 decisions.
`G1-FOLLOWUP-01` closed the current-disk customer
order-projection/OpenAPI and browser-card contract findings; `G1-FOLLOWUP-02`
closed reschedule and legacy-community read projections, strict response/OCI
bindings, and G2 authorization-register completeness, all without creating
runtime evidence; `G1-FOLLOWUP-03` closes the historical voice-SKU activation,
OCI build-context binding, and local decision/freeze-record precision.
`G1-FOLLOWUP-04` makes the future candidate reject a missing browser-card,
OCI-custody, control-plane, or local OCI/migration contract source rather than
honestly hashing an incomplete package, and fixes serious/critical aXe severity
as a non-card-authorable blocking policy. `G1-FOLLOWUP-05` closes the remaining
npm-shrinkwrap override and case-variant private/package-manager input bypasses
of the three package-lock v3 dependency inputs before candidate capture/SBOM can
rely on them. `G1-FOLLOWUP-06` makes every required evidence/control path retain
its declared file/directory type rather than permitting a tracked-child
directory substitute; `G1-FOLLOWUP-07` closes historical voice-order request or
accept rescheduling under text-only before observable mutation and makes the
existing 422 response contractual. `G1-FOLLOWUP-08` is restricted to formal
test-result summary parsing after a full Jest report showed no actual skips but
ordinary business logs were counted as six. `QA-02E-A-R` is the completed corrective
control-plane source-contract slice, `QA-02E-B-A` is completed at
metadata-hygiene scope for every ordinary API/Mini/Web/iOS/G1 repository workflow, and `QA-02E-B-B` is completed at structural-contract scope. The active worktree is intentionally dirty
and is not a candidate. The four product decisions are confirmed and their
fail-closed implementation is present; payment-dispute response images are
disabled rather than assumed to be a text-only exemption. Completed validators may only
reject malformed external evidence records and clarify the local migration-tool
boundary; they cannot run a browser, Docker, migration, CI, registry, or
custody action.
Separately, G1 requires a new clean frozen candidate, two zero-skip explicitly
authorized isolated E2E runs through the external protected control plane with
a verified socketless executor, migration compatibility proof, completed local
browser interaction evidence, same-SHA remote CI, and artifact/rollback records.
Browser/device evidence has a local start but lacks zoom, reduced-motion, full
keyboard, and aXe proof; remote CI, staging, and all Phase 7 actions need their
listed authorization. No code path should claim G1 or G2 until those evidence
rows are actually populated.

`G1-FOLLOWUP-08` remains a historical local result whose first parser grammar
was later reopened; do not use its 4/4 closeout as the current parser claim.
`G1-FOLLOWUP-11` is the current independently reviewed correction: focused
API/candidate parser suites pass 5/5 and 16/16, real diagnostic output is
ignored, and actual Jest/TAP skip/todo/pending/cancelled outcomes still reject.
Neither result is candidate, CI, G1, or G2 evidence, and neither authorizes
package installation, Docker/DB/Redis, browser, registry, or external action.
