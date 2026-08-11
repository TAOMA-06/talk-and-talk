# Same-SHA candidate evidence template

> Status: draft template. It is not evidence for `cbac594` or any future
> release candidate until all fields below are captured from one frozen checkout.

## Candidate commit / freeze authorization

`CANDIDATE-COMMIT-R01` was consumed by commit
`83a9ec6aa4e67c65997baa4ae4fa786a00654560`. The first detached-checkout
comparison then exposed non-deterministic Vinext security material, so that
commit is **superseded and is not the release candidate**. It must not be
tagged, pushed as a candidate, or used as G1/G2 evidence.

Before staging or committing, obtain one non-secret
`CANDIDATE-COMMIT-R01` record. It is a **local repository-write authorization**,
not a protected-tag, push, CI, deployment, or external-action authorization.
The authority must exist before staging. A review-only stage may then compute
the exact path/status/mode digest; every field below must be filled and checked
before the commit is created:

| Required field | Value to approve |
|---|---|
| Evidence ID / issued / expiry | `USER-AUTH-ALL-20260811`; issued in the active 2026-08-11 task before staging; task-local expiry `2026-08-11 23:59:59 CST` |
| Baseline SHA and local branch/ref | `cbac594ba7387e2455faa1df97c489afb5616c07`; `codex/g1-text-only-release-candidate` |
| Final reviewed `git diff --name-status -z` hash and change-map hash | 185-path NUL manifest SHA-256 `e4a153c6126f4c9dbfd8972fcce990f078492ec5f8c51d6fca286a4d4a775b97`; change-map SHA-256 `eb61f8cd64d61836bfc82c7618ce2b50022f404d6f624fad13a8caf38098df6a` |
| Exact allowed path and file-mode list | the 185 paths pinned by the NUL manifest above and the staged parent diff: existing files retain parent modes; every added file is regular `100644`; the only deletion is accidental gitlink `.worktrees/grok/task-f33b77` mode `160000`, while its local directory is preserved and ignored; no mode change |
| Authorized signer and exact one-commit message | `taoma <taomahj834225@outlook.com>`; `feat(release): freeze text-only candidate controls` |
| Independent reviewer | not supplied; `/root` owner review is recorded but does not satisfy independent candidate review |
| Expected result | one full commit SHA, clean local worktree, and a record of the resulting parent SHA |
| Explicitly excluded actions | this local record excludes push, protected-tag/ref creation, amend, reset, clean, deployment, CI dispatch, and external write; the user's separate blanket authorization permits only a later non-force push of this candidate branch and safe evidence attempts |

Any changed path/mode, expired record, modified final diff, or need for a second
commit invalidates this record and requires a new authorization. Do not infer
authorization from this blank template or from the later protected-tag row.

The user supplied that replacement authorization in the same active task. The
resulting non-secret `CANDIDATE-COMMIT-R02` record is:

| Required field | Authorized replacement value |
|---|---|
| Evidence ID / issued / expiry | `USER-AUTH-ALL-20260811`; issued in the active 2026-08-11 task before replacement staging; task-local expiry `2026-08-11 23:59:59 CST` |
| Baseline SHA and local branch/ref | superseded local commit `83a9ec6aa4e67c65997baa4ae4fa786a00654560`; `codex/g1-text-only-release-candidate` |
| Final reviewed `git diff --name-status -z` hash and change-map hash | 8-path NUL manifest SHA-256 `077f219bb24b1ed9d58f4f3620c9e53ca3102bc8ea7883248ca9033432e86b61`; change-map SHA-256 `1c93e03c4047135de865e6ca5abc3e36adfe882103ae15435df5cabf9ca8425a` |
| Exact allowed path and file-mode list | `scripts/candidate-evidence.mjs`; `scripts/candidate-evidence.test.mjs`; and `docs/cto-self-audit/runs/2026-08-08-g1-remediation/{candidate-evidence-template.md,change-map.md,handoff.md,scope.md,state.md,validation.md}`; all eight remain regular `100644`; no addition, deletion, rename, or mode change |
| Authorized signer and exact one-commit message | `taoma <taomahj834225@outlook.com>`; `fix(release): normalize ephemeral web build evidence` |
| Independent reviewer | not supplied; `/root` owner review is recorded but does not satisfy independent candidate review |
| Expected result | one new full commit SHA whose parent is `83a9ec6aa4e67c65997baa4ae4fa786a00654560`, followed by a clean local worktree and two new detached-checkout captures |
| Explicitly excluded actions | no amend/reset/clean/history rewrite; the record permits only the exact replacement staging and one normal commit. Push remains the separately authorized later non-force branch push; protected tag, CI dispatch, deployment, provider, database, and external writes remain separately evidenced actions |

Any additional changed path or mode invalidates `CANDIDATE-COMMIT-R02` and
requires another record. A documentation edit within the already authorized
eight-path set does not change the path/status manifest; the content-level
change-map hash above remains the controlling reviewed scope record.

## Freeze protocol

1. Finish all code, test, contract, workflow, and documentation changes.
2. Obtain the latest applicable complete `CANDIDATE-COMMIT-R0x` record only
   after the final diff and change map are supplied for review. It authorizes
   at most the exact local staging and one commit described above. For the
   current replacement candidate, that record is `CANDIDATE-COMMIT-R02`.
3. Under that record, commit the complete candidate once. Record its full SHA
   and parent SHA below. Then, under a **separate** protected-tag/ref
   authorization, create a protected immutable candidate tag/ref that resolves
   to that SHA. Candidate source is an input to the future G1 control plane,
   not the control plane itself. The protected, immutable control
   ref/repository must be independently reviewed and selected for dispatch; it
   checks out this candidate SHA into a separate candidate-only path. Do not
   dispatch a workflow from the candidate tag.
4. Start from a clean detached checkout of that exact SHA. Run `git diff --check`
   and `git status --porcelain=v1 --untracked-files=all`; both must produce no
   candidate-affecting output. Reject any `npm-shrinkwrap.json`, including an
   ASCII case variant: the only
   permitted npm lock inputs are the npm `lockfileVersion: 3` files
   `backend/api/package-lock.json`, `frontend/miniprogram/package-lock.json`, and
   `frontend/web/package-lock.json`. Remove ignored `.env*`/`.envrc`,
   package-manager config, private Mini config, gitlinks, tracked symlinks, and
   stale Web/API build output before freezing; do not reuse a dirty tree, a
   floating branch, or an old run directory.
5. Run the complete gate suite. Capture each full log outside source control or
   as a hash-addressed, redacted evidence artifact.
6. Recompute all tree/bundle hashes from a second clean checkout. Any byte
   difference outside the declared `vinext-ephemeral-security-material-v1`
   policy, failed test, skip, missing artifact, or mismatched checksum
   invalidates the candidate and requires a new SHA and full rerun. That policy
   verifies but excludes the two matching per-build `prerenderSecret` manifests,
   normalizes only Vinext's random `draftSecret` and `buildId` fields in the
   server-bundle hash, and excludes only the test-created `.wrangler` runtime
   cache. It does not normalize application bytes. The external OCI custody
   receipt must still bind the exact raw built artifact and image digest.

The no-dependency capture tool turns the local, non-destructive portion of
these requirements into a fail-closed workflow. Capture metadata/logs are
written only to a new directory outside the repository; allowlisted build gates
may create ignored artifacts inside the disposable clean candidate checkout,
then bind their hashes. It does not create a commit, deployment,
Docker/database target, or external-platform action:

```bash
# Run from a clean, detached candidate checkout.
node scripts/candidate-evidence.mjs begin \
  --sha <candidate-full-sha> \
  --source-ref <immutable-candidate-tag-or-ref> \
  --out <absolute-controlled-evidence-directory>/candidate-<candidate-full-sha>

# Run each listed automated gate through the allowlist. MINI_RELEASE reads an
# externally injected AppID but records only --mini-app-id-ref, never its value.
node scripts/candidate-evidence.mjs run --freeze <out>/00-freeze.json --gate WEB_CHECK

# API_E2E_1/API_E2E_2 are deliberately not local capture gates. The tool
# rejects both legacy E2E flags and those gate names. Obtain the two results
# only from the separately protected control-plane execution path, whose
# unprivileged candidate executor has no Docker socket, token, or control-plane
# mount. Record its externally retained evidence IDs below.

# After every required gate and build artifact exists, generate a new external
# SBOM from only these npm lockfileVersion 3 inputs: backend/api/package-lock.json,
# frontend/miniprogram/package-lock.json, and frontend/web/package-lock.json.
# npm-shrinkwrap.json, including an ASCII case variant, is prohibited and cannot
# substitute for or supplement any
# of them. The command reads no node_modules, invokes no package manager, and
# uses no network. It binds the frozen candidate SHA, source-tree hash, and each
# lock SHA into deterministic CycloneDX 1.6.
node scripts/candidate-evidence.mjs sbom \
  --freeze <out>/00-freeze.json \
  --out <absolute-controlled-evidence-directory>/candidate-<candidate-full-sha>/candidate-sbom.json

# Only the deterministic freeze-bound SBOM above is accepted by finalization.
# An arbitrary CycloneDX/SPDX export, in-repository path, symlink, stale lock,
# or output with altered candidate provenance is rejected.
node scripts/candidate-evidence.mjs finalize --freeze <out>/00-freeze.json \
  --sbom <absolute-controlled-evidence-directory>/candidate-<candidate-full-sha>/candidate-sbom.json \
  --reviewer-evidence <independent-review-Evidence-ID> \
  --cleanup-evidence <disposable-cleanup-Evidence-ID>

# Re-run capture in an independent detached checkout, then compare manifests.
node scripts/candidate-evidence.mjs compare \
  --left <first-out>/manifest.json --right <second-out>/manifest.json
```

`begin` rejects attached HEAD, changed/staged/untracked files, unresolved
gitlinks, a source ref that does not resolve to the requested SHA, repository
output paths, tracked or ignored private configuration inputs, stale generated artifacts, and
missing required tracked release inputs. Gate subprocesses use a capture-owned
home/temp/npm configuration and do not inherit `NODE_OPTIONS`, the caller's
home, or general environment secrets. `finalize` rejects missing or copied
gate records, nonzero exits, skipped/todo/pending/cancelled checks, potential
secret redaction, changed logs or generated artifacts, missing Web/API/Mini
release-source artifacts, generated Prisma output, or an in-repository/non-new/
non-deterministic SBOM. A candidate SBOM must be the repository's lockfile-only
CycloneDX 1.6 output with exact frozen SHA, source-tree, and hashes of only
`backend/api/package-lock.json`, `frontend/miniprogram/package-lock.json`, and
`frontend/web/package-lock.json` at npm `lockfileVersion: 3`;
`npm-shrinkwrap.json`, including an ASCII case variant, is prohibited.
`compare` verifies each
capture's checksum, freeze binding, gate records, and logs before comparing
reproducible source/artifact data. A passing manifest is evidence preparation
only; it is not G1 Go.

The tool checks local capture consistency; it does **not** authenticate who ran
a command, validate an Evidence ID against an external authorization system,
make its output directory immutable, launch isolated E2E, or prove that ignored
`node_modules` content came from a fresh lockfile installation. Before G1, put
the resulting hashes in the approved immutable evidence system, have the named
independent reviewer verify custody and every authorization reference, and
obtain same-SHA CI evidence from clean dependency installations. The local tool
must never be used to substitute for those facts.

## Candidate identity

| Field | Required value | Status |
|---|---|---|
| Candidate full SHA | pending | blocked |
| Parent full SHA | pending | blocked |
| Branch/ref used to create checkout | pending | blocked |
| Clean status before gates | pending | blocked |
| Git version, OS, Node, npm, package-manager versions | pending | blocked |
| UTC freeze timestamp | pending | blocked |
| Build/review owner | pending | blocked |
| Independent reviewer | pending | blocked |

## Required gate register

| Evidence ID | Gate | Exact command/method | Required result | Log hash / reviewer | Status |
|---|---|---|---|---|---|
| `E1-WEB-CHECK` | Web static/build policy | `cd frontend/web && npm run check:candidate` | pass with zero skipped/todo/pending/cancelled checks on candidate SHA | pending | blocked |
| `E1-WEB-BROWSER` | Web route/header/a11y/performance evidence | Only an individually authorized external browser run may produce the JSON card. A `passed` card must be checked with `node scripts/g2-browser-evidence-card-contract.mjs validate --card <absolute-external-card> --expected-candidate-repository <host/owner/repository> --expected-candidate-sha <40-hex-sha> --expected-candidate-source-tree-sha256 <64-hex-sha256> --expected-web-artifact-sha256 <64-hex-sha256>`, with all four expected values supplied from the protected frozen-candidate/custody record rather than the card. The card binds candidate repo/SHA/tree, Web artifact digest/custody reference, issuer plus distinct reviewer, completed cleanup after the lifecycle, and failure state; every public route at 320/390/768/1440; browser/OS/DPR/network/cache/screenshot/DOM fields; keyboard visible-focus; 200% zoom/reflow/overflow; reduced motion; aXe engine/ruleset with the fixed ordered `serious`, `critical` blocking policy, total and blocking violation counts/result; and cold/warm LCP/INP/CLS metrics with an approved budget. | structural validation passes only after every required binding is present and matches the independently supplied frozen facts; a `passed` card must meet its approved metric thresholds/minimum cold-warm samples, record every interaction facet as passed, have zero serious/critical aXe blocking violations, and record completed chronological cleanup. It does **not** prove the browser run, screenshots, aXe/metric output, artifact custody, authorization, deployment, or G1/G2. A missing approved performance budget is valid only as a `blocked` card with `performance-budget-unapproved`. | pending | blocked |
| `E1-MINI-VALIDATE` | Mini source gate | `node frontend/miniprogram/scripts/validate.mjs` | pass | pending | blocked |
| `E1-MINI-TSC` | Mini type gate | `node backend/api/node_modules/typescript/lib/tsc.js -p frontend/miniprogram/tsconfig.json --noEmit` | pass | pending | blocked |
| `E1-MINI-SMOKE` | Mini mock workflow gate | `node frontend/miniprogram/scripts/smoke.mjs` | pass, scoped as mock only | pending | blocked |
| `E1-MINI-LOCAL-BUILD` | Mini local-copy isolation | `node frontend/miniprogram/scripts/test-local-build.mjs` | pass; generated DevTools copy is local-only and source release config stays unchanged | pending | blocked |
| `E1-MINI-RELEASE` | Mini release structure gate | inject the external AppID only into `node scripts/candidate-evidence.mjs run --freeze <out>/00-freeze.json --gate MINI_RELEASE --mini-app-id-ref <vault-reference>` | pass; only the non-secret vault reference is captured | pending | blocked |
| `E1-API-PREFLIGHT-STATIC` | API static preflight | `cd backend/api && npm run test:preflight:static` | pass with zero skipped/todo/pending/cancelled checks; it must not silently replace PostgreSQL runtime coverage | pending | blocked |
| `E1-API-PREFLIGHT-POSTGRES` | Disposable PostgreSQL preflight | Only a separately protected external control-plane dispatch may run this gate. The immutable control repository/ref/SHA and its harness path/version are recorded before it resolves the authorization register to one frozen candidate repository/SHA/tree, checks candidate data out separately, initializes a disposable service target, and runs candidate code only through the socketless/unprivileged executor. `postgres_preflight_authorization_evidence`, authorization-register reference/SHA, immutable PostgreSQL/Redis image custody, executor image/harness digests, and the environment approval reference must be independently bound before candidate code starts. | all seven PostgreSQL-dependent preflight tests pass with zero skips; a trusted redacted admission/denial receipt binds candidate SHA/source-tree SHA-256, protected-control ref, authorization-register version, protected-environment approval, execution Evidence ID, infrastructure custody, executor image/harness digests, isolation attestation, and cleanup | pending | blocked |
| `E1-API-BUILD` | API build | `cd backend/api && npm run build` | pass; recorded API `dist` and generated Prisma artifact hashes | pending | blocked |
| `E1-API-UNIT` | API unit gate | `cd backend/api && npm test` | pass with zero skipped/todo/pending/cancelled checks | pending | blocked |
| `E1-OPENAPI-SCHEMA` | Contract/DTO field parity | `cd backend/api && node scripts/openapi-controller-contract.test.mjs` | pass; message/refund and error/capability fields covered | pending | blocked |
| `E1-API-VERIFY-ARTIFACTS` | API release artifact guard | `cd backend/api && npm run verify:prod-artifacts` | pass against candidate build output | pending | blocked |
| `E1-OCI-CUSTODY` | OCI builder/custody record | Only an independently protected external control harness may build/custody an image. After an external record exists, validate it with `node scripts/oci-builder-custody-contract.mjs --receipt <absolute-external-receipt> --expected-candidate-repository <host/owner/repository> --expected-candidate-sha <40-hex-sha> --expected-candidate-source-tree-sha256 <64-hex-sha256> --expected-build-context-tree-sha256 <64-hex-sha256> --expected-dockerfile-sha256 <64-hex-sha256> --expected-artifact-provenance-sha256 <64-hex-sha256> --expected-image-manifest-digest <sha256:64-hex-sha256>`. All seven expected values must come from independent frozen-candidate, protected-control, and immutable-custody records rather than the receipt. The build-context tree is independently bound because it can be a scoped Docker context rather than the full candidate source tree. The receipt must bind candidate SHA/tree, build-context tree and non-escaping Dockerfile hash, distinct immutable control repo/ref/SHA/harness, authorization-register facts, digest-pinned builder/executor and isolation attestation, manifest digest/platforms, the Dockerfile's revision/source-tree/artifact-provenance/approved-candidate labels, immutable registry retention, signature/attestation, UTC lifecycle, issuer, and a distinct independent reviewer. | a structurally valid `passed` record includes custody and matches every independently supplied expected binding; a `denied` record has a reason and makes no custody claim. Validation does **not** build/pull/push/sign/upload, contact a registry, verify signatures, establish custody, or produce G1/G2 proof. | pending | blocked |
| `E1-API-E2E-1` | Isolated backend E2E | With a dedicated external authorization row completed, dispatch the independently protected `G1 candidate control plane` only from its separately administered immutable control repository/ref/SHA and provide the frozen candidate SHA as data. The control-owned authorization resolver must bind that Evidence ID to exactly one candidate repository/SHA/tree before checkout. The controller—not candidate source—selects the preconfigured `g1-disposable-e2e` environment, immutable infrastructure image custody, digest-pinned socketless executor image/rootfs harness, and external receipt path. The candidate executor must have no Docker socket/group/CLI control path, host/control-plane mount, token, GitHub command-file namespace, or unreviewed egress. | zero failures and skips; dedicated disposable PostgreSQL/Redis; trusted admission/denial receipt candidate SHA/source-tree SHA-256, protected-control ref/SHA/harness version, authorization-register reference/SHA, protected-environment approval, execution Evidence ID, infrastructure custody, immutable image/harness digests, isolation attestation, and cleanup references all match | pending | blocked |
| `E1-API-E2E-2` | E2E repeatability | The same authorized external control-plane mechanism starts run 2 only after run 1 and PostgreSQL preflight succeed, in the same protected environment but with a fresh target and independently produced receipt. It must not reuse a local capture record, mutable image tag, implicit pull, direct candidate launcher, candidate-controlled workflow, or mutable authorization register. | zero failures and skips; independent target/receipt; candidate/control/authorization/approval bindings, image and harness digests, custody, and executor-isolation attestations remain identical to the registered inputs | pending | blocked |
| `E1-MIGRATION` | Migration compatibility | Only after a distinct per-action authorization, an independently protected external control harness (not candidate checkout code) must consume already-custodied immutable prior/candidate/infrastructure artifacts. It must bind the candidate/control/authorization/custody facts before target creation, own socketless execution and target cleanup, and write its own `always()` receipt. The repository's `/bin/sh backend/api/scripts/run-migration-compatibility.sh` is local-operator-only fresh-schema tooling and cannot be used, copied, or promoted as that external harness. | Previous migrations and normal old replica pass before candidate migration; old normal replica remains ready after candidate migration; then old compiled binary and candidate artifact pass **serial** authenticated readiness; every required image is rechecked before/after; exact owned-resource cleanup and a trusted external control-plane receipt succeed. This is fresh-schema forward compatibility only, not rollback/restore/historical-data/RTO/RPO proof. | pending | blocked |
| `E1-CI-CANDIDATE-IDENTITY` | Candidate control-plane identity | The external control repository must copy the reviewed contract into its immutable protected control ref and record its harness path/version/SHA. Before candidate checkout or execution, the controller verifies its own immutable ref/SHA, resolves the protected authorization register to exact candidate repository/SHA/tree, checks candidate data out to a distinct candidate-only path, and uses trusted control code to verify detached candidate HEAD/tree/input policy. A repository ruleset or distinct release-control repository must prevent candidate workflows from selecting the self-hosted runner. | exact candidate SHA/tree/source-tree hash; protected candidate and control ref evidence; authorization-register reference/SHA; clean input-policy result; runner-policy/ACL and token/command-file/egress isolation attestation; redacted control-plane run reference | pending | blocked |
| `E1-CI-SBOM` | Same-SHA deterministic SBOM | An external control-owned SBOM harness runs generation against the candidate-only checkout. Before generation or upload it enters a separately preconfigured approval environment (required reviewers, no self-review, no bypass) and requires the dispatch authorization record to match a protected registry entry; the input is audit metadata, not authority by itself. Candidate code does not generate or upload the SBOM. | candidate/source-tree/API-Mini-Web lock hashes and uploaded artifact checksum match the independently generated SBOM; protected control/environment approval, authorization-register version, harness version/SHA, and redacted run reference | pending | blocked |
| `E1-CI-DEPENDENCY-AUDIT` | Same-SHA high/critical dependency audit | External control-harness API, Mini, and Web steps run `npm audit --omit=dev --audit-level=high` after their clean lockfile installations and trusted identity/input rechecks. The current repository's source-only workflow is not this execution mechanism. | all three candidate lock surfaces have no high/critical production-dependency finding; redacted audit logs are retained | pending | blocked |
| `E1-CI-API` | Same-SHA API static CI | An external control-harness API step executes candidate source only after the trusted candidate identity/authorization check and in its documented unprivileged environment; no self-hosted Docker/socket is available to static code. | API E2E safety harness, static preflight/build/artifact/unit/contract jobs green with zero skips on the exact candidate SHA | pending | blocked |
| `E1-CI-MINI` | Same-SHA Mini source CI | An external control-harness Mini step executes candidate source only after trusted identity/authorization check, isolated clean installs, and zero-skip enforcement. This is not an AppID/experience-build result. | validate/type/smoke/local-copy gates and dependency audit green on the exact candidate SHA | pending | blocked |
| `E1-CI-WEB` | Same-SHA Web CI | An external control-harness Web step executes candidate source only after trusted identity/authorization check and an isolated clean install. | complete zero-skip Web candidate check and dependency audit green on the exact candidate SHA | pending | blocked |
| `E1-DIFF-CHECK` | Candidate integrity | `git diff --check` and `git status --porcelain=v1 --untracked-files=all` from the detached candidate checkout | pass; both outputs empty | pending | blocked |

## Artifact and provenance register

| Artifact | Required hash/evidence | Status |
|---|---|---|
| Only permitted npm lockfiles | `backend/api/package-lock.json`, `frontend/miniprogram/package-lock.json`, and `frontend/web/package-lock.json`, each npm `lockfileVersion: 3`; sorted SHA-256 file list and tree hash. `npm-shrinkwrap.json`, including an ASCII case variant, is prohibited. | pending |
| OpenAPI, Prisma schema, migrations, critical feature config | sorted SHA-256 file list and tree hash | pending |
| Web production build | output manifest and tree hash | pending |
| Mini release source / structure | output manifest and tree hash; AppID omitted. A real WeChat experience artifact is external-platform evidence, not a local substitute. | pending |
| API generated Prisma client, `dist`, and static release assets | output manifest and tree hash | pending |
| OCI image | immutable digest only if an image is actually built | pending |
| Disposable E2E infrastructure | candidate SHA/source-tree SHA-256, protected control ref/SHA/harness version, authorization-register reference/SHA, protected control/environment approval and per-run execution Evidence IDs, PostgreSQL and Redis `@sha256` values, infrastructure-custody Evidence ID, executor image/harness digest, socket/mount/token/GitHub-command-file/network-egress/runner-group isolation attestation, and trusted admission/denial receipt hashes | pending |
| Migration compatibility inputs | immutable prior/candidate/PostgreSQL/Redis digests; prior/candidate SHA/tree; artifact-builder/custody evidence and provenance; redacted target-ownership, serial-stage, cleanup, and receipt record | pending |
| Browser/a11y/performance card | candidate SHA/tree, Web artifact digest/custody reference, external card path/hash, exact route/viewport matrix, browser/OS/network/cache, screenshots/DOM captures, keyboard/focus/zoom/motion, fixed serious/critical aXe policy, performance/budget/cleanup/reviewer fields | pending |
| OCI builder/custody record | external receipt path/hash, candidate/build-context/control/authorization/builder/image/label/custody/reviewer bindings; immutable registry retention and signature/attestation references | pending |
| SBOM | `talk-and-talk-lockfile-sbom` version, CycloneDX `1.6`, candidate/source-tree/API-Mini-Web lock hashes, output SHA-256, independent reviewer, and the authorized candidate-CI artifact reference if uploaded | pending |
| Test logs and browser/device evidence | redacted log/screenshot/video hashes | pending |
| Whole evidence bundle | manifest SHA-256 recomputed independently | pending |

## Rollback drill register

The rollback plan pins an approved previous SHA and artifact identifiers. It
must never use a floating branch, tag, unverified local build, or production
database as a drill target.

| Check | Required evidence | Status |
|---|---|---|
| API/Web/Mini prior artifact references | immutable identifiers and owners | pending |
| Forward-compatible migration assertion | independently controlled external harness: previous normal replica before candidate migration, then separately prior compiled binary and candidate app against candidate schema in one fresh internal disposable target; paired PostgreSQL/Redis DB14/DB15 ownership, exact-resource cleanup, and a trusted external receipt. The repository local-operator record is not this receipt. | pending |
| Backup/restore procedure | environment ID, no-secret restore log, checksum | pending |
| Config recheck | deferred Web/BFF denied; text-only/media/TRTC and personalization recorded | pending |
| Core smoke after rollback | liveness, readiness, role denial, legal/config check | pending |
| Measured RTO/RPO | drill timestamp, measured duration/data point, reviewer | pending |

## Candidate decision

Only an independent reviewer may set the following fields after verifying every
mandatory evidence row. `G1 Go` is not a production deployment claim; `G2`
remains blocked unless its exact external actions are separately authorized.

| Field | Value |
|---|---|
| G1 result | pending |
| G2-ready result | pending |
| G2 external result | blocked |
| Reviewer and UTC sign-off | pending |
