# G2 execution package — template, not yet ready

> Task ID: `2026-08-08-g1-remediation`
> Phase 0 baseline SHA: `cbac594ba7387e2455faa1df97c489afb5616c07`.
> Candidate SHA: not assigned. Populate only after a frozen G1 candidate exists.
> Package tracked in candidate: no. This run directory is governance work only
> until it is committed into a future clean candidate.
> Gate: `G2-ready NO-GO`; `G2 BLOCKED`.

This package is executable without storing credentials. Every reference below
is a label, vault reference, or authorized environment ID, not a secret. A
blank required field is a blocker, never an implied pass.

## Repository-known inputs

These are safe facts from the checkout. They establish the execution method,
not an external result.

| Topic | Safe fact to carry forward | Source / evidence method | Not yet proven |
|---|---|---|---|
| Public Web scope | Public routes are `/`, `/how-it-works`, `/safety`, `/about`, and `/partners`; `/business`, `/demo`, Web trade, BFF, and session routes are deferred/private. Default/unknown runtime and hostile production flags are locally tested as locked. | `decisions.md`; `frontend/web/lib/web-surface-policy.ts`; built-worker policy/header tests | A frozen candidate and deployed route/header/QR/browser proof. |
| Mini Program transport | `develop` and `trial` intend HTTPS staging API transport; `release` intends production. `urlCheck=true`. | `frontend/miniprogram/utils/config.ts`; `project.config.json` | DNS/TLS reachability, backend compatibility, and WeChat configuration. |
| AppID and upload | No AppID or upload credential is kept in the repository; Developer Tools/vault reference is required. Automated experience-build upload is not configured. | `frontend/miniprogram/README.md`; `.gitignore`; `project.config.json` | Real AppID, domain/privacy receipts, uploader authorization, and experience-build result. |
| First-release capability | Tracked staging example keeps media and TRTC features disabled; server and Mini local tests fail closed for text-only legacy media/voice/TRTC paths. The actual staging snapshot must explicitly record text-only and personalization values without secrets. | `backend/api/.env.staging.example`; capability/unit suites; Mini release invariant tests; `deployment-preflight.mjs` | Actual staging configuration, provider-managed payment-dispute media policy, and historical personalization consent decision. |
| Health evidence | Liveness and authenticated readiness are distinct; readiness checks DB/Redis and its token must never be archived. | `backend/api/src/health/health.controller.ts`; `health.service.ts` | A reachable environment and successful authenticated readiness response. |
| Evidence storage | Git may contain IDs, hashes, timestamps, commands, and redacted findings only. | `docs/cto-self-audit/evidence/README.md` | Any real secret, identity, account, payment, or production connection value. |

## Local methods (not external-action authorization)

Record commands and redacted results only after their prerequisites exist. A
successful local command is never a substitute for G2 execution evidence.

| Method | Purpose | Required record |
|---|---|---|
| `cd backend/api && npm run preflight:deployment -- .env.staging` | Validate a supplied staging configuration without printing secret values. | Environment/vault version reference, command, UTC timestamp, exit code, redacted failure list. |
| `cd frontend/web && npm run check:candidate` | Web static/build policy baseline with zero-skip enforcement. | Candidate SHA, tool versions, command log hash, zero-skip result. |
| `node frontend/miniprogram/scripts/validate.mjs`; `node backend/api/node_modules/typescript/lib/tsc.js -p frontend/miniprogram/tsconfig.json --noEmit`; `node frontend/miniprogram/scripts/smoke.mjs`; `node frontend/miniprogram/scripts/test-local-build.mjs`; release-mode `validate.mjs` with an authorized external AppID reference | Mini source, TypeScript, mock-workflow, local-copy isolation, and release-structure baseline. | Candidate SHA, commands, logs, skipped count, and a vault reference rather than an AppID value. |
| `cd backend/api && npm run test:preflight:static && npm run build && npm test` | Local server/contract baseline only. `test:preflight:static` is intentionally separate from PostgreSQL runtime preflight and all commands must report zero skipped/todo/pending/cancelled checks. | Candidate SHA, toolchain, commands, logs, zero-skip result, and API artifact hashes. This does not provide E2E or PostgreSQL-runtime evidence. |
| Protected control-plane PostgreSQL preflight, then sequential E2E runs only | Candidate source is data, never the control plane. A separately administered protected immutable control ref/repository verifies its own SHA and harness version, resolves the protected authorization register to the exact frozen candidate repository/SHA/tree, and checks candidate data out to a distinct path. It alone selects the protected environment, immutable infrastructure images, digest-pinned executor image/rootfs harness, and receipt destination. Candidate code runs only in a socketless/unprivileged executor with no Docker socket/group/CLI control path, host/control-plane mount, token, GitHub command-file namespace, or unreviewed egress. A trusted receipt job records admission/denial or execution result independently of candidate output. | Protected control/environment approval, authorization-register reference/SHA, control-harness path/version/SHA, runner-group and executor-isolation attestation, per-run execution Evidence ID, infrastructure custody, immutable image/harness digests, candidate SHA/source-tree SHA-256, zero-skip logs, trusted receipts, and cleanup evidence. A local shell command or candidate-controlled workflow with partial inputs is not a substitute and must fail closed. |
| Only after a distinct migration authorization, the **local-operator-only** `/bin/sh backend/api/scripts/run-migration-compatibility.sh` with its complete sealed `MIGRATION_COMPATIBILITY_*` input set, a trusted absolute Node path plus matching non-secret `MIGRATION_COMPATIBILITY_RUNNER_NODE_SHA256`, and a new local `MIGRATION_COMPATIBILITY_RECEIPT_OUT` operation-record path | Fresh-schema forward migration compatibility of already-local immutable prior/candidate/infrastructure artifacts. The supported launcher refuses Node preloads/execution arguments, host target/Compose overrides, non-Unix Docker, mutable/missing images, non-`approved-candidate` labels, and absent/mismatched approval references; its direct-entry marker is only a misuse guard, not authorization. The runner independently verifies detached source, ancestry, DB14/DB15 freshness, OCI labels/digests, serial old/candidate readiness, exact owned-resource cleanup, and emits a redacted **local operation record**. It never builds, pulls, or deploys an image. It cannot become the external control-plane harness, OCI builder/custody receipt, or G1/G2 proof; a separate immutable external builder/custody/control record remains mandatory because an OCI label is not proof by itself. | Prior/candidate SHA/tree and immutable image digests; artifact-builder/provenance/authorization Evidence IDs; local stage/health/checksum record hashes; PostgreSQL/Redis ownership result; exact-project cleanup result. This is not a rollback/restore/historical-data/RTO/RPO or external-custody result. |
| `node scripts/candidate-evidence.mjs begin/run/sbom/finalize/compare` from two clean detached candidate checkouts | Locally captures and compares two distinct non-secret SHA/tree/artifact/SBOM/local-gate records. The only permitted npm lock inputs are `backend/api/package-lock.json`, `frontend/miniprogram/package-lock.json`, and `frontend/web/package-lock.json`, each npm `lockfileVersion: 3`; `npm-shrinkwrap.json`, including an ASCII case variant, is prohibited and cannot substitute for or supplement them. `sbom` writes a new external deterministic CycloneDX 1.6 file directly from those three locks, binding candidate SHA, source tree, and each lock SHA without `node_modules`, an install, or a network call; `finalize` rejects any other SBOM. The tool rejects gitlinks, tracked symlinks, tracked/ignored private configuration, stale outputs, and legacy local E2E flags, and verifies capture checksums/records/logs before comparison. It never launches Docker/E2E or treats an Evidence ID as authority. Same-SHA CI remains a separately authorized control-plane action from an independently protected immutable control ref/repository; candidate code cannot define that policy or receive its Docker capability. | Freeze record, toolchain record, local gate records/log hashes, two manifest checksums, deterministic SBOM checksum/provenance, immutable-evidence custody reference, independently verified authorization references, clean-install same-SHA control-plane CI, reviewer Evidence ID, and cleanup Evidence ID. |
| `node scripts/g2-browser-evidence-card-contract.mjs validate --card <absolute-external-card> --expected-candidate-repository <host/owner/repository> --expected-candidate-sha <40-hex-sha> --expected-candidate-source-tree-sha256 <64-hex-sha256> --expected-web-artifact-sha256 <64-hex-sha256>` for a `passed` card | Pure structural validation of a future external Web browser/a11y/performance card. It reads one external JSON file and verifies required candidate/artifact/reviewer/cleanup plus route/viewport, keyboard/focus, 200% zoom, reduced-motion, aXe, cold/warm LCP/INP/CLS, and budget fields. A card must declare the exact ordered aXe blocking policy `serious`, `critical`; a `passed` card must meet its recorded approved thresholds/minimum sample counts, mark every interaction facet passed, report zero serious/critical aXe blocking violations, complete cleanup after the lifecycle record, and match all four independently supplied frozen bindings. It never starts a browser, network request, child runtime, or device test. | Candidate/artifact bindings must come from the protected frozen-candidate/custody record, not from the card itself. Record the external card hash, exact matrix, tool versions/settings, screenshot/DOM/trace references, budget approval reference/SHA, issuer/reviewer, cleanup, total/blocking serious/critical aXe counts, and explicit pass/fail/blocked state. Structural success is not runtime/custody/authorization proof. |
| `node scripts/oci-builder-custody-contract.mjs --receipt <absolute-external-receipt> --expected-candidate-repository <host/owner/repository> --expected-candidate-sha <40-hex-sha> --expected-candidate-source-tree-sha256 <64-hex-sha256> --expected-build-context-tree-sha256 <64-hex-sha256> --expected-dockerfile-sha256 <64-hex-sha256> --expected-artifact-provenance-sha256 <64-hex-sha256> --expected-image-manifest-digest <sha256:64-hex-sha256>` for a `passed` receipt | Pure structural validation of a future external OCI builder/custody record. It reads one external JSON file and verifies candidate/build-context/control/authorization/builder/image/label/custody/review bindings. A `passed` receipt must match all seven expected bindings supplied independently from frozen-candidate, protected-control, and immutable-custody records, never from the receipt itself. The build-context tree is distinct from the full candidate source tree when the Docker context is scoped. Labels must match the repository Dockerfile's revision, source-tree, artifact-provenance, and `approved-candidate` contract; issuer and reviewer must be distinct. It never builds/pulls/pushes/signs/uploads or contacts a registry. | External receipt hash; independently sourced candidate repository/SHA/tree, build-context/Dockerfile/artifact-provenance hashes, and image manifest digest; candidate/control SHA/tree; executor/harness/isolation; immutable image/custody/retention/signature facts; authorization register, issuer, and independent reviewer. Structural success is not signature, custody, or authorization proof. |
| Browser and device matrix | Responsive, keyboard, 200% zoom, reduced-motion, aXe/WCAG and performance behavior, plus real Mini Program behavior. | Device/browser version, exact viewport/network/cache/accessibility setting, evidence IDs, approved budget, and cleanup. |

`acceptance-smoke.sh` is development/mock-SMS/mock-payment only. It must not be
reported as staging or provider evidence. The existing production-smoke script
is a reference checklist, not an automatically authorized staging exercise.

## Authorization register

Every row below is mandatory before its named action. The first row is a local
repository-write prerequisite; every following row authorizes a distinct
external action. A reference that is only syntactically valid is not
authorization. Do not combine actions or infer approval from an earlier G1,
SBOM, E2E, migration, or deployment row.

| Action | Evidence ID | Target and immutable scope | Issued / expiry | Executor | Expected result / evidence destination | Independent reviewer | Status |
|---|---|---|---|---|---|---|---|
| Candidate commit/freeze (`CANDIDATE-COMMIT-R01`) | pending | baseline SHA; independently reviewed final `git diff --name-status` and change-map hashes; exact allowed path/file-mode list; local branch/ref; one signer and one exact commit message; no push/tag/amend/reset/clean | pending | pending | one full candidate SHA plus parent SHA and clean-worktree record; no remote ref or external action | pending | blocked |
| Protected immutable candidate tag/ref creation | pending | candidate SHA and exact protected tag/ref | pending | pending | tag/ref resolution record | pending | blocked |
| Protected G1 control-plane ref/repository creation or revision approval | pending | exact immutable control SHA/ref; control harness path/version/SHA; ruleset/CODEOWNERS/required-review/no-self-review/no-bypass evidence; exclusive runner-group policy; authorization-register administration | pending | pending | control-plane custody, registry, and runner-policy attestation | pending | blocked |
| `G1 candidate control plane` manual dispatch | pending | protected immutable external control ref/repository, frozen candidate tag/ref and SHA, authorization-register reference/SHA, GitHub run | pending | pending | redacted control-plane admission/denial run reference | pending | blocked |
| Control-plane SBOM artifact upload | pending | candidate SHA, bounded `candidate-sbom-<SHA>` artifact, checksum and retention; control ref SHA | pending | pending | immutable custody destination; protected SBOM environment with required reviewers/no self-review/bypass and matching approval reference | pending | blocked |
| External Web browser/a11y/performance card capture | pending (`E1-WEB-BROWSER`) | frozen candidate repository/SHA/source-tree SHA-256; immutable Web artifact SHA-256 and custody reference; approved external preview target; all public-route/viewport, browser/device/network/cache, accessibility, performance-budget, account/fixture, and cleanup scopes | pending | independently authorized external browser/device executor | external card/hash, screenshots/DOM/traces, aXe and cold/warm performance aggregates, completed cleanup, and a distinct reviewer record | pending | blocked |
| External OCI builder/custody proof | pending (`E1-OCI-CUSTODY`) | frozen candidate repository/SHA/source-tree SHA-256; immutable build-context/Dockerfile hashes; independent protected control ref/harness; authorization-register and approval references; digest-pinned builder/executor plus isolation attestation; image manifest/platform labels, retention, and signature/attestation scope | pending | independently protected external builder/custody control plane | external receipt/hash with candidate/control/authorization/builder/image/custody/issuer/reviewer bindings; structural validator may only cross-check those independently supplied expected values | pending | blocked |
| Disposable PostgreSQL preflight in the protected control plane | pending | candidate SHA/source-tree SHA-256; protected control/environment and approval references; authorization-register ref/SHA; PostgreSQL/Redis `@sha256` inputs and infrastructure custody reference; socketless executor image/harness digest; runner-group/socket/mount/token/command-file/network-egress isolation attestation | pending | pending | trusted admission/denial preflight receipt with candidate, control, registry, approval, execution, executor image/harness, isolation, and cleanup bindings | pending | blocked |
| Hosted disposable PostgreSQL/Redis E2E runs in a socketless candidate executor | pending | candidate SHA/source-tree SHA-256; two fresh targets; protected control/environment/approval reference; authorization-register ref/SHA; PostgreSQL/Redis `@sha256` inputs and infrastructure custody; executor image/harness digest; runner-group/socket/mount/token/command-file/network-egress isolation scope | pending | pending | two trusted receipts bound to candidate/control/registry/approval/execution/executor inputs, zero-skip logs, cleanup records, and isolation attestation | pending | blocked |
| Local disposable migration-compatibility run | pending | frozen candidate and approved prior SHA/tree/digest; PostgreSQL/Redis digests; exact trusted Node SHA-256; local Unix Docker; new receipt path | pending | pending | artifact-builder/custody and matching execution/environment references; redacted receipt | pending | blocked |
| External-control-plane migration compatibility proof | pending (`E1-MIGRATION`) | approved prior and frozen candidate repository/SHA/tree plus immutable artifacts; PostgreSQL/Redis image custody; independent protected control ref/harness; authorization-register/environment approval; digest-pinned socketless executor and isolation attestation; new disposable target and exact cleanup scope | pending | independently protected external control-plane migration harness | trusted admission/denial and execution receipt proving serial prior-normal-replica, candidate migration, old-replica/compiled-binary, and candidate-readiness stages; immutable inputs, zero-skip logs, and completed cleanup | pending | blocked |
| `G2-S12` restore/rollback drill | pending (`G2-S12-RESTORE-ROLLBACK`) | pinned approved prior artifact and candidate compatibility boundary; separately authorized disposable restore target; backup/restore reference; route-policy/text-only/role-denial checks; RTO/RPO measurement method and cleanup scope | pending | independently authorized restore/rollback operator or protected control plane | distinct restore/rollback receipt, immutable artifact and authorization bindings, restore/cleanup logs, post-rollback checks, measured RTO/RPO, and independent reviewer record; never a production drill | pending | blocked |
| Staging Web/API deployment | pending | candidate SHA and immutable OCI/Web artifacts; target environment | pending | pending | deployment/rollback receipt | pending | blocked |
| Staging database, Redis, and object storage access | pending | environment ID, data boundary, reset/retention scope | pending | pending | redacted access/cleanup evidence | pending | blocked |
| DNS, TLS, callback, and allowed-domain verification | pending | exact hostname/callback scope | pending | pending | certificate/domain/callback evidence | pending | blocked |
| WeChat AppID configuration and experience build upload | pending | vault AppID reference and authorized build target | pending | pending | Developer Tools/upload receipt | pending | blocked |
| Test accounts, devices, and synthetic-data lifecycle | pending | aliases, fixtures, device matrix, expiry/deletion scope | pending | pending | cleanup/expiry evidence | pending | blocked |
| Payment, refund, message, or provider callback exercise | pending | sandbox/provider target and no-real-money boundary | pending | pending | redacted trace and cleanup evidence | pending | blocked |

## Environment and configuration checklist

| Item | Required evidence | Value/reference | Reviewer | Status |
|---|---|---|---|---|
| Candidate SHA and artifact bundle checksum | immutable manifest plus independently recomputed checksum | pending | pending | blocked |
| HTTPS staging Web and API endpoint | URL, certificate chain, expected DNS name, timestamp | pending | pending | blocked |
| Staging database and Redis isolation | environment ID, network boundary, reset owner, retention rule | pending | pending | blocked |
| Object storage and media deny verification | bucket reference, no-public-read proof, text-only denial result | pending | pending | blocked |
| Callback and provider endpoints | endpoint reference, allowlist, error-handling owner | pending | pending | blocked |
| Mini Program AppID and legal-domain setup | AppID vault reference, domain/check result, privacy interface result | pending | pending | blocked |
| Feature flags | recorded values for deferred Web, BFF, text-only, media, TRTC, personalization | pending | pending | blocked |

## Account, fixture, and cleanup registry

| Role | Non-secret account reference | Minimum fixture | Cleanup owner | Expiry/deletion evidence | Status |
|---|---|---|---|---|---|
| Customer | pending | verified and unverified states; no production balance | pending | pending | blocked |
| Companion | pending | approved role and one eligible service; no production payout | pending | pending | blocked |
| Third-party user | pending | distinct state for authorization negatives | pending | pending | blocked |
| Staff/reviewer | pending | least-privileged review account when authorized | pending | pending | blocked |

## Device and accessibility matrix

| Device class | OS | WeChat version | Network mode | Accessibility setting | Owner | Result evidence |
|---|---|---|---|---|---|---|
| iPhone current | pending | pending | Wi-Fi and cellular | default and larger text | pending | pending |
| iPhone supported minimum | pending | pending | weak network/offline recovery | default | pending | pending |
| Android current | pending | pending | Wi-Fi and cellular | default and large font | pending | pending |
| Android supported minimum | pending | pending | weak network/offline recovery | TalkBack-compatible path | pending | pending |
| Desktop browser evidence | pending | Chromium version | localhost/staging only as authorized | keyboard, 200 percent zoom, reduced motion | pending | pending |

## Scenario and evidence matrix

Each scenario requires preconditions, exact steps, expected result, timestamp,
candidate SHA, relevant request/order IDs, screenshot or recording reference,
server-side evidence reference, data assertion, cleanup outcome, and an
independent reviewer sign-off.

| Scenario ID | Scenario | Required outcome | Status |
|---|---|---|---|
| `G2-S01` | Official Web public navigation and Mini entry | All CTAs are truthful and usable; deferred Web routes remain unavailable | pending |
| `G2-S01B` | Official Web browser, accessibility, and performance card | The authorized external card covers every public route/viewport with keyboard/focus, 200% zoom, reduced motion, fixed serious/critical aXe result, and cold/warm performance budget outcome | pending |
| `G2-S02` | Web production surface abuse matrix | Deferred, BFF, and session routes remain denied despite hostile variable combinations | pending |
| `G2-S03` | Unverified customer public write | Server denies before write; recovery route is honest and actionable | pending |
| `G2-S04` | Verified customer text interaction | Main path succeeds and recovers from weak network/retry | pending |
| `G2-S05` | Historical media/voice/TRTC direct access | All paths deny under text-only, including signed-read and bind attempts | pending |
| `G2-S06` | Manual discovery with personalization disabled | Discovery is available without behavioural/order-derived ranking inputs | pending |
| `G2-S07` | Customer order and payment unknown/retry path | Only server-confirmed result is shown; duplicate action is idempotent | pending |
| `G2-S08` | Refund and after-sales path | Required reason, state, and customer-safe evidence link are visible | pending |
| `G2-S09` | Companion fulfilment transitions | Approved companion reaches only legal next state; facts are auditable | pending |
| `G2-S10` | Cross-role authorization attacks | Customer and third account cannot mutate or inspect protected facts | pending |
| `G2-S11` | Earnings hold, appeal, and after-sales linkage | Reason is human-readable; appeal and related state are actionable | pending |
| `G2-S12` | Migration compatibility plus separately authorized restore/rollback drill | Forward-only migration compatibility and the distinct pinned restore/rollback drill each have their own authorization, receipt, cleanup, and reviewer evidence; only the latter measures RTO/RPO | pending |

## Per-scenario execution cards

These cards turn the scenario titles into an executable runbook. They do not
authorize any action: every matching authorization-register row, frozen candidate
SHA, account/fixture aliases, environment reference, and evidence destination
must be filled before a card may be run. Never record credentials, OpenIDs,
phone numbers, payment signatures, private chat text, or raw screenshots that
contain them.

| Scenario | Preconditions | Authorized procedure | Required evidence and cleanup |
|---|---|---|---|
| `G2-S01` | The independent `E1-WEB-BROWSER` authorization row is issued; candidate Web artifact/custody, non-production host, browser/device matrix row, Mini entry reference, and cleanup scope are bound. | At 320, 390, 768, and 1440 px, open each public route, tab through the header/CTA/footer, activate the Mini CTA, and direct-navigate to `/business` and `/demo`. Repeat with the configured entry absent or malformed in the authorized preview configuration. | Per-viewport screenshot/recording, DOM/link capture, route status, keyboard order, CTA fallback result, `E1-WEB-BROWSER` reference, and cleanup evidence. Remove the preview configuration after test if it is not the selected candidate configuration. |
| `G2-S01B` | The independent `E1-WEB-BROWSER` and `E1-OCI-CUSTODY` authorization rows are issued; candidate artifact/custody and external preview target are bound; approved performance budget/version is available; browser/device/cleanup aliases are registered. | Use the externally controlled browser procedure for `/`, `/how-it-works`, `/safety`, `/partners`, and `/about` at 320/390/768/1440. Record browser/OS/DPR/network/cache, keyboard visible-focus, 200% zoom/reflow/overflow, default and reduced-motion results, aXe engine/ruleset plus the exact serious/critical blocking result, and cold/warm LCP/INP/CLS against the approved budget. Then validate the resulting external JSON card structurally with frozen candidate/artifact expected bindings; this validation cannot replace the run. | Card/reference hashes, screenshots/DOM/trace references, aXe/performance aggregate hashes including serious/critical blocking counts, exact budget reference/SHA, candidate/artifact/custody bindings, issuer plus independent reviewer, failure state, and cleanup. A structurally valid card is still not G1/G2 evidence until external facts are independently reviewed. |
| `G2-S02` | Authorized disposable Web environment permits temporary non-secret surface-variable combinations. | For each documented hostile combination, set the combination only on the disposable candidate worker; request deferred pages, `/api/session/*`, and `/api/backend/*`; then restore the candidate configuration. Include no-variable/default runtime. | Redacted variable-name matrix, HTTP status/header capture, candidate SHA, restore confirmation, and independent reviewer sign-off. |
| `G2-S03` | `IDENTITY-R01/R02` are approved; verified and unverified non-secret account aliases and a zero-write snapshot exist. | Attempt public post and message writes with the unverified alias; inspect the recovery UI/path; compare before/after modeled records. Repeat a permitted verified text write only if the fixture policy permits it. | API/status trace, recovery screen evidence, before/after fact snapshot, cleanup reference. No identity material belongs in the package. |
| `G2-S04` | Authorized staging Mini experience build, verified fixture, test device, and weak-network method are registered. | Exercise sign-in, manual discovery, a pure-text conversation send/retry, and recovery after an intentionally interrupted request. Confirm no media chooser/read control appears. | Device/WeChat/OS/network details, recording, redacted request IDs, success/retry evidence, and fixture cleanup result. |
| `G2-S05` | Disposable historical media/voice/TRTC fixture is approved; all test accounts and storage references are isolated. | Attempt every in-scope upload, bind, list, read, signed-read, voice-intro read/review, room-access, attendance, and callback path under explicit text-only configuration. Capture before/after DB/storage facts. | Denial status/error-code matrix, proof of no signed URL and no mutation, text-only config reference, and fixture deletion confirmation. Provider-managed payment-dispute media is excluded unless its separate policy row is approved. |
| `G2-S06` | `PERSONALIZATION-R01` is approved; fixture can vary stored preferences, tags, and order history without personal data. | Run manual catalogue/keyword discovery with personalization disabled; rerun after changing each stored behavioural/order input; inspect authorized trace/query evidence for absence of those inputs. | Result ordering comparison, redacted trace/query evidence, governance setting reference, and fixture reset. |
| `G2-S07` | Authorized provider sandbox/mock mode, customer alias, order fixture, and no-real-money assertion exist. | Submit an order/payment action; interrupt client receipt; retry the same idempotency key; process an unknown/delayed callback only through the authorized sandbox path; refresh authoritative order state. | One stable order/payment reference, idempotency/callback timeline, before/after balances/state, and cleanup. Do not send a real payment. |
| `G2-S08` | Authorized sandbox order eligible for refund/after-sales, customer alias, and support-policy reference exist. | Submit boundary-valid refund reasons, inspect customer projection, simulate permitted refund lifecycle races, and confirm customer-visible after-sales data never exposes provider/reconciliation fields. | DTO/status captures, projection-field check, idempotency/result timeline, and fixture cleanup. No live refund is permitted. |
| `G2-S09` | Approved companion alias, eligible service/order fixture, and audit/timeline access are registered. | Attempt each legal companion transition and each disallowed transition; capture post-state, timeline, audit, notification/outbox, earning, and companion-summary facts. | Allowed-state matrix, denied-state matrix, before/after snapshots, and cleanup. |
| `G2-S10` | Customer, owner-companion, other-companion, third-user, and staff aliases plus one protected fixture are registered. | For every protected order transition and read/write route, invoke it as each non-owner role; compare modeled data before and after each denial. | Role-by-route status matrix, non-probing response proof, zero-mutation snapshots including notification/outbox, and cleanup. |
| `G2-S11` | `EARNINGS-R01` and any provider-media boundary are approved; held-earning fixture and safe support/after-sales record exist. | Render each typed hold projection, follow each approved appeal/support route, test deadline boundary and unauthorized access, and prove that an appeal submission does not release held funds. | Public-category/copy matrix, deadline/action evidence, owner/role negative result, held-funds before/after snapshot, and cleanup. |
| `G2-S12` | The independent `E1-OCI-CUSTODY`, `E1-MIGRATION`, and `G2-S12-RESTORE-ROLLBACK` authorization rows are all issued; previous approved and candidate artifacts, disposable migration and restore targets, backup/restore reference, RTO/RPO method, and cleanup owners are bound. | First use only the independently protected external-control-plane migration harness on a new disposable target: prior migrations → normal previous replica → candidate migrations/status → old-replica recheck → old compiled-binary check → candidate readiness. Treat its `E1-MIGRATION` receipt as forward-only evidence. Only under the distinct `G2-S12-RESTORE-ROLLBACK` authorization, perform the pinned prior-artifact restore/rollback drill, then recheck liveness/readiness/route policy/text-only/role denial and measure duration/data point. | Immutable artifact IDs; separate `E1-MIGRATION` and `G2-S12-RESTORE-ROLLBACK` receipts; marker/cleanup and migration/restore log hashes; measured RTO/RPO; post-rollback evidence; and independent reviewer sign-off. Never perform either activity against production. |

## Evidence naming and closeout

Store non-secret evidence under `candidate-<full-sha>/`. Every file name begins
with its scenario ID and UTC timestamp. The final manifest records its own
SHA-256, candidate and parent SHA, tool versions, reviewer Evidence ID, skipped
count (must be zero for G1), and cleanup Evidence ID. It is only a local
capture until an immutable-evidence custody reference and independent review
are attached. A reviewer may mark this package
`G2-ready` only when every required registry and scenario template is populated
for the actual candidate; running a G2 scenario still requires separate exact
authorization.
