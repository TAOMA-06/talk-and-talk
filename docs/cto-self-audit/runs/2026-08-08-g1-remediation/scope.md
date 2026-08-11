# Talk&Talk G1 remediation — scope and dirty ownership

> Task ID: `2026-08-08-g1-remediation`
> Initial baseline: `cbac594ba7387e2455faa1df97c489afb5616c07`
> Initial observation: clean `main...origin/main` at the baseline; see
> `validation.md` entry `E0R-BASELINE-20260808`.

## Product boundary

This recovery task prepares one future, frozen candidate for the Talk&Talk
official website and WeChat Mini Program first release:

- the official website is public brand/rules/disclosure/Mini-program entry only;
- the Mini Program is the current real-service client;
- web login, discovery, companion, commerce, session, and BFF routes remain
  deferred and must be genuinely locked in a production candidate;
- the first release is text-only; historical media, voice and TRTC paths must
  be unavailable unless an explicitly documented regulated/admin exception is
  separately approved;
- local source, contract, safety harness, candidate-evidence, and runbook work
  is included only insofar as it supports a truthful future G1/G2 handoff.

## External and evidence exclusions

`USER-AUTH-ALL-20260811` confirms the four formerly blocked product choices,
authorizes their fail-closed local implementation, and delegates one candidate
freeze plus safe external attempts to the main owner. It does not manufacture
credentials, isolation, custody, device results, or an independent reviewer.
The following remain outside any local/source claim until real action-specific
inputs and results exist:

- any Docker, PostgreSQL, Redis, migration, E2E runtime, CI dispatch, registry,
  artifact upload, deployment, staging, payment, WeChat, DNS/TLS, or production
  action;
- the historical `PUSH-R01` audit clarification, which remains unknown and is
  not retroactively answered by the current authorization;
- a real AppID experience build, device test, browser accessibility/zoom/
  reduced-motion proof, external browser/QR reachability, and production
  qualification;
- Phase 7 / production launch.

The confirmed local product boundaries are `IDENTITY-R01=R01-C`,
`IDENTITY-R02=R02-A`, `PERSONALIZATION-R01=A`, `EARNINGS-R01=A`, and
`PAYMENT-DISPUTE-MEDIA-R01=B`; their implementation is owned by
`G1-FOLLOWUP-13`. Any later relaxation requires a new decision and candidate.

## Dirty ownership map

All changes below are task-owned recovery work from the clean baseline. Exact
file leases and current status live in `state.md`; the detailed dependencies and
contract impact live in `change-map.md`.

| Area | Task-owned paths / glob | Reason |
|---|---|---|
| Shared API safety and release tooling | `backend/api/{package.json,jest.config.js,Dockerfile,README.md,scripts/**,test/setup-e2e.ts}`; `infra/docker-compose.e2e.yml`; `infra/docker-compose.migration-compatibility.yml` | disposable E2E safety, migration compatibility, artifact provenance, and runtime fail-closed checks |
| Backend release behavior and contracts | `backend/api/src/**`; `backend/api/test/orders-payments.e2e-spec.ts`; `shared/contracts/openapi/v1.yaml` | text-only enforcement, ownership, refund projection, and contract parity remediation |
| Official Web | `frontend/web/**`; `.github/workflows/web.yml` | locked production surface, safe Mini entry, headers, image runtime, and Web CI |
| Mini Program | `frontend/miniprogram/**` | release text-only behavior, model parity, handler closure, and local validation |
| Candidate/CI/release evidence | `.github/workflows/{api.yml,g1-candidate.yml,g1-candidate-control-plane.yml,ios.yml,miniprogram.yml,web.yml}`; `scripts/**`; `.gitignore`; `docs/cto-self-audit/runs/2026-08-08-g1-remediation/**`; `docs/cto-self-audit/10-long-running-web-miniprogram-delivery-guide.md`; `docs/{staging-acceptance.md,production-checklist.md,COMMERCIAL_RELEASE.md,deploy-rollback.md,runbooks/migration-release-job.md}` | clean-candidate evidence, same-SHA CI contracts, SBOM, migration receipt/runbooks, sealed candidate runtime, truthful current-operational and text-only exception governance, and task state |
| Preserved local worktree | staged index deletion only: `.worktrees/grok/task-f33b77` | remove an accidental gitlink from a future candidate without deleting the existing local Grok worktree |

The task must stop and reclassify any new diff outside this map before changing
it. The current dirty worktree is intentionally **not** candidate evidence; no
hash, build, test, or local receipt from it may be presented as a G1/G2 result.

## G1-FOLLOWUP-13 authority closure and candidate-preparation lease

`G1-FOLLOWUP-13` is the serial shared slice authorized by
`USER-AUTH-ALL-20260811`. It may edit the identity gate and admin identity
service; recommendation configuration/service and a new forward-only reset
migration; companion earnings projection; payment-dispute reply DTO/service;
their focused tests, OpenAPI, Mini profile/earnings/smoke surfaces, and this run
directory. It may also update downstream community/conversation unit fixtures
only to distinguish the first-release hard denial from isolated tests of the
dormant moderation state machine. The real public entry points must never be
mocked or relaxed.

The slice selects the safest first-release choices: legacy identity booleans
cannot authorize public posts or real-time messages; recommendation
personalization is reset and cannot be enabled; companion holds expose only a
typed public category/status/next-action; and payment-dispute response images
are rejected before storage or provider forwarding. It must preserve reading,
orders, fulfilment closure, text after-sales/support, manual discovery, and
admin-only financial operations that do not contradict those decisions.

The lease also permits local validation, exact candidate diff/mode hashing,
one branch-local stage/commit, one push of the candidate branch, and safe
attempts to invoke the separately protected evidence process. A missing
credential, control repository, protected environment, immutable artifact,
device, fixture, or independent reviewer is a recorded blocker rather than a
pass. It does not authorize force-push, history rewrite, cleanup of unrelated
worktrees, a direct main push, production deployment, real-money action, shared
database/Redis mutation, or fabricated evidence.

## Ownership and continuation rule

`state.md` is the only current-phase source of truth. `validation.md` is
append-only. Before every resumed slice, compare `HEAD`, `git status --short`,
and this ownership map; record any divergence in `state.md` before writing.
File leases must be extended before a task-owned path is changed and released
only after validation and independent review.

## QA-02E-A-R control-plane lease

`QA-02E-A` was reopened after independent review found that a candidate checkout
could alter the workflow and control scripts and could reach the Docker socket
before the claimed admission boundary. `QA-02E-A-R` is the narrow corrective
slice: it may edit only `.github/workflows/g1-candidate.yml`, add
`.github/workflows/g1-candidate-control-plane.yml`, edit or add
`scripts/g1-candidate-ci-contract*.mjs`, and update this run directory. It
must make the legacy in-repository dispatch path fail closed, describe a future
control-plane checkout separately from the candidate checkout, and prohibit a
candidate job from receiving `DOCKER_HOST` or a host Docker-socket mount. The
source contract must also bind authorization to exact candidate facts before
checkout, keep the trusted harness outside the candidate workspace, and retain
an explicit admission/denial receipt state.

This lease was acquired by `/root` at `2026-08-10 03:16:00 CST` against the
registered dirty remediation worktree and baseline
`cbac594ba7387e2455faa1df97c489afb5616c07`. It does not claim that repository
source alone can enforce protected-ref rules, runner-group ACLs, a separate
release-control repository, candidate-authorization registry, or container
mount/token/GitHub-command-file/network-egress isolation; those remain external
G1 conditions and must not be represented as locally verified. The lease was
released after local evidence `E1-QA-02E-A-R-LOCAL-20260810` and independent
review `E1-QA-02E-A-R-REVIEW-20260810`; those records cover the source contract
only and do not authorize a control-plane dispatch or any runtime action.

## QA-02E-B-A candidate-repository workflow de-execution lease

`QA-02E-B-A` closes the remaining conflict with the external-control-plane
boundary: a candidate-repository push/PR workflow must not interpret candidate
package scripts or source at all. A candidate can otherwise turn an apparently
static `npm`/Node command into Docker, Compose, OCI, database, Redis, network,
or GitHub-command-file activity. This lease may edit only
`.github/workflows/{api.yml,g1-candidate.yml,ios.yml,miniprogram.yml,web.yml}`,
`backend/api/scripts/ci-e2e-safe-runtime.test.mjs`,
`scripts/g1-candidate-ci-contract.test.mjs`, and this run directory. Those
ordinary API/Mini/Web/iOS/G1 workflows may retain only pinned checkout with credentials, submodules,
and LFS disabled plus fixed Git metadata checks in a sealed command-file shell;
they are hygiene notifications, not candidate gates or evidence. They must not
run `npm`, `node`, `npx`, TypeScript, Prisma, Docker, Compose, containers,
services, uploads, or any candidate-controlled executable. Any build, test,
audit, OCI, PostgreSQL, Redis, migration, E2E, image pull, or Docker capability
stays outside the candidate repository and is a future external-control-plane
action.

This lease was acquired by `/root` at `2026-08-10 04:34:33 CST` against the
registered dirty remediation worktree and baseline
`cbac594ba7387e2455faa1df97c489afb5616c07`. It was released after local
evidence `E1-QA-02E-B-A-LOCAL-20260810` and independent review
`E1-QA-02E-B-A-REVIEW-20260810`: exact metadata-only allowlists now reject
block- and flow-style extra triggers/jobs/permissions/actions/commands. This
is not candidate CI, G1, or G2 evidence. The lease did not authorize or execute
CI dispatch, Docker resources, a database/Redis action, image build/pull,
migration, receipt capture, browser activity, registry activity, or any
external write.

## QA-02E-B-B browser-card and OCI-custody boundary lease

`QA-02E-B-B` records two remaining future-evidence contracts without treating
either contract as runtime proof. First, it defines a structural external
browser/accessibility/performance evidence card. The validator may read only a
new, absolute, external JSON card and must not launch a browser, contact a
network endpoint, start a child runtime, or claim that screenshots, aXe,
performance, deployment, authorization, or custody were independently
verified. A `passed` card is structurally valid only; the actual browser/device
run remains a separately authorized G1 action.

Second, it makes the OCI/migration trust boundary explicit. The existing
candidate-repository migration launcher, Compose file, and local receipt are
`local-operator-only` tooling and cannot be copied into, invoked by, or treated
as the future external control-plane builder/migration harness. A new static
OCI builder/custody receipt validator may validate an external record but must
not build, pull, push, sign, upload, contact a registry, create Docker
resources, run a migration, or create an execution receipt. A future trusted
control plane must own its immutable harness, authorization resolution,
socketless candidate executor, OCI builder/custody, target isolation, cleanup,
and `always()` receipt independently of candidate source.

This lease may edit only new
`scripts/{g2-browser-evidence-card-contract,oci-builder-custody-contract}.{mjs,test.mjs}`;
`scripts/g1-candidate-ci-contract.test.mjs`; `backend/api/package.json`;
`backend/api/scripts/run-migration-compatibility.{mjs,test.mjs}`;
`backend/api/README.md`; `docs/{deploy-rollback.md,runbooks/migration-release-job.md}`;
new `docs/cto-self-audit/runs/2026-08-08-g1-remediation/external-control-plane-oci-custody-contract.md`;
and this run directory's `{candidate-evidence-template.md,g2-execution-package.md,scope.md,state.md,change-map.md,handoff.md,validation.md}`.
It must not change any workflow, Dockerfile, Compose file, registry, external
control repository, or product behavior. This lease was acquired by `/root` at
`2026-08-10 05:12:15 CST` against the registered dirty remediation worktree and
baseline `cbac594ba7387e2455faa1df97c489afb5616c07`. It is static/local work
only and grants no authority to dispatch CI, launch a browser, perform a device
test, access Docker/DB/Redis, run migration compatibility, build/pull/push/sign
an image, or contact a registry or any external service.

This lease was released after local evidence `E1-QA-02E-B-B-LOCAL-20260810`
and two independent static reviews recorded together as
`E1-QA-02E-B-B-REVIEW-20260810`. The two validators now reject malformed,
repository-local, or incomplete external records; a passed browser card must
meet its recorded performance budget, keep every interaction facet passed, and
report zero aXe blocking violations; an OCI receipt must match the four
repository Dockerfile provenance labels and separate issuer from reviewer.
This is not a browser/device run, OCI build/custody proof, migration run,
candidate freeze, CI run, or G1/G2 evidence.

## G1-FOLLOWUP-04 candidate-evidence source-presence lease

`G1-FOLLOWUP-04` is a narrow local correction to the frozen-candidate
completeness and browser-card aXe-policy contracts. It may edit only
`scripts/{candidate-evidence,g2-browser-evidence-card-contract}.{mjs,test.mjs}`
and this run directory's
`{candidate-evidence-template.md,g2-execution-package.md,scope.md,state.md,change-map.md,validation.md,handoff.md}`.
It must require the current browser-card and OCI-custody validators/tests,
external OCI custody contract, external control-plane template, Dockerfile, and
local migration runner/Compose contract to be tracked in any candidate before
local capture can begin. A clean tree hash by itself must not be treated as
proof that those assets are present. The regression must demonstrate a detached
clean fixture fails for every newly required path. It must also make
`["serious", "critical"]` the exact blocking aXe severity policy for a
structurally valid card, so the card cannot self-authorize a smaller blocking
set. No browser is launched by this validator.

This lease was acquired by `/root` at `2026-08-10 07:34 CST` against the
registered dirty remediation worktree and baseline
`cbac594ba7387e2455faa1df97c489afb5616c07`. It grants no authority to stage,
commit, tag, push, dispatch CI, launch a browser, create Docker resources,
touch a database/Redis target, build/pull/push/sign an image, contact a registry,
or perform any external action.

`G1-FOLLOWUP-04` completed static/local validation and independent review:
`E1-G1-FOLLOWUP-04-LOCAL-20260810` and
`E1-G1-FOLLOWUP-04-REVIEW-20260810`. Its required-source omission and fixed
aXe-policy checks are source contracts only, never browser, custody, candidate,
G1, or G2 evidence.

## G1-FOLLOWUP-05 npm shrinkwrap dependency-input lease

`G1-FOLLOWUP-05` is a narrow local correction to the candidate dependency
input and deterministic-SBOM boundary. It may edit only
`scripts/{candidate-input-policy,generate-candidate-sbom,candidate-evidence}.{mjs,test.mjs}`
and this run directory's
`{candidate-evidence-template.md,g2-execution-package.md,scope.md,state.md,change-map.md,validation.md,handoff.md}`.
It must reject tracked or ignored `npm-shrinkwrap.json` candidate inputs and
make direct SBOM generation reject any such file in each API, Mini, or Web
package root before it treats the corresponding `package-lock.json` v3 as the
sole dependency input. It must make the entire existing private/package-manager
candidate-config denylist ASCII-case-insensitive too, because the local
case-folding filesystem can otherwise resolve a differently cased config name.
Regressions must cover tracked and ignored policy input, every package root,
and a clean candidate-capture fixture. The documentation
must name the three permitted package-lock v3 inputs and state that shrinkwrap
is forbidden. It must not install dependencies, resolve or audit a dependency
graph, access a registry, or create runtime evidence. Existing local toolchain
metadata may read the trusted co-located npm version only; that is not an
install, resolution, audit, or network action.

This lease was acquired by `/root` at `2026-08-10 07:41 CST` against the
registered dirty remediation worktree and baseline
`cbac594ba7387e2455faa1df97c489afb5616c07`. It grants no authority to stage,
commit, tag, push, dispatch CI, launch a browser, create Docker resources,
touch a database/Redis target, build/pull/push/sign an image, contact a registry,
or perform any external action.

`G1-FOLLOWUP-05` completed static/local validation and independent review:
`E1-G1-FOLLOWUP-05-LOCAL-20260810` and
`E1-G1-FOLLOWUP-05-REVIEW-20260810`. The checks did not install, resolve, or
audit dependencies, access a registry, or create a real candidate; the existing
toolchain metadata reads only a trusted local npm version. This is a local
candidate/SBOM source contract, not candidate, custody, CI, G1, or G2 evidence.

## G1-FOLLOWUP-06 required-source type lease

`G1-FOLLOWUP-06` is a narrow local correction to the candidate-evidence
required-source contract. It may edit only
`scripts/candidate-evidence.{mjs,test.mjs}` and this run directory's
`{scope.md,state.md,change-map.md,validation.md,handoff.md}`. It must declare
whether every required source is a tracked regular file or a tracked,
non-symlink directory, reject any other filesystem type before capture, and
retain the Git tracked-path check. Its clean detached fixture must prove a
required browser/OCI/control-plane file cannot be replaced by a directory with a
tracked child, and the required migration directory cannot be replaced by a
regular file. It must not change the candidate policy, SBOM, workflow, Docker,
Compose, control-plane, browser, or runtime behavior.

This lease was acquired by `/root` at `2026-08-10 08:15:55 CST` against the
registered dirty remediation worktree and baseline
`cbac594ba7387e2455faa1df97c489afb5616c07`. It grants no authority to stage,
commit, tag, push, dispatch CI, launch a browser, create Docker resources,
touch a database/Redis target, run a migration, access a registry, or perform
any external action.

`G1-FOLLOWUP-06` completed static/local validation and independent review:
`E1-G1-FOLLOWUP-06-LOCAL-20260810` and
`E1-G1-FOLLOWUP-06-REVIEW-20260810`. The candidate evidence tool now checks the
declared kind after its tracked-path check, before it can prepare an output
directory. This is a local source contract, not candidate, custody, CI, G1, or
G2 evidence.

## G1-FOLLOWUP-07 historical voice-reschedule lease

`G1-FOLLOWUP-07` is a narrow local correction to the first-release text-only
server/API contract. It may edit only
`backend/api/src/orders/{orders.service.ts,orders.service.spec.ts}`,
`shared/contracts/openapi/v1.yaml`, `backend/api/scripts/openapi-controller-contract.test.mjs`,
and this run directory's
`{scope.md,state.md,change-map.md,validation.md,handoff.md}`. It must make the
authoritative service reject request or acceptance of a historical
voice-delivery order before any mutation, notification, or audit side effect
when the text-only lock is effective. It must make the 422 unavailable response
visible in the reschedule API contract and prove the behavior with focused local
regressions. It must not reactivate voice, execute a real order change, contact
a user, or perform any database, Docker, CI, browser/device, staging, or
external action.

This lease was acquired by `/root` at `2026-08-10 08:15:55 CST` against the
registered dirty remediation worktree and baseline
`cbac594ba7387e2455faa1df97c489afb5616c07`. It grants no authority to stage,
commit, tag, push, dispatch CI, launch a browser, create Docker resources,
touch a database/Redis target, run a migration, access a registry, or perform
any external action.

`G1-FOLLOWUP-07` completed static/local validation and independent review:
`E1-G1-FOLLOWUP-07-LOCAL-20260810` and
`E1-G1-FOLLOWUP-07-REVIEW-20260810`. The request/accept read paths make no
durable reschedule, notification, timeline, or audit mutation before the
authoritative text-only voice guard. This is a local server/API contract, not a
real order action, candidate, CI, G1, or G2 result.

## G1-FOLLOWUP-08 zero-skip summary parser lease

`G1-FOLLOWUP-08` is a narrow local correction to the candidate test-output
gate. It may edit only `backend/api/scripts/{assert-zero-skips.mjs,
assert-zero-skips.test.mjs}` and this run directory's
`{scope.md,state.md,change-map.md,validation.md,handoff.md}`. It must preserve
the rejection of every actual skipped, todo, pending, or cancelled test result,
while consuming only formal Jest and Node TAP summary records instead of
business diagnostics such as `skipped=0` or `2 skipped`. Regressions must prove
formal nonzero Jest/TAP records reject, formal zero records accept, and ordinary
diagnostic text cannot change the result. It must not change test subjects,
test semantics, package scripts, candidate policy, SBOM, workflow, Docker,
Compose, browser, or runtime behavior.

This lease was acquired by `/root` at `2026-08-11 00:14:24 CST` against the
registered dirty remediation worktree and baseline/current `HEAD`
`cbac594ba7387e2455faa1df97c489afb5616c07`. The leased source hashes at
acquisition were `assert-zero-skips.mjs`
`7cd343253e8623a7aca07eb013c67109dd53904fdef7c33dbdd32b618512b181` and
`assert-zero-skips.test.mjs`
`7e887d2a286f0d0e56235c6300df770613cab114ca16d256675e9b9c0b0abe54`.
It grants no authority to stage, commit, tag, push, dispatch CI, launch a
browser, create Docker resources, touch a database/Redis target, run a
migration, access a registry, or perform any external action.

Local validation completed at `2026-08-11 00:44:56 CST` with current source
hashes `1299f2fc95d833074f4bc2d63a163fd52e96370403ace30a07b880990ccf9fd5`
and `75ccfae5b9c0d69c0a25cdb57e79b70de8cb6c832e05de746ccbbeda3c43d74f`.
The parser's native suite passed 4/4 and the exact `npm test` path passed
144/144 Jest suites and 1337/1337 tests through the zero-skip wrapper. This
was local source/test evidence pending independent review; it was never
candidate, CI, G1, or G2 evidence.

`G1-FOLLOWUP-08` completed the historical independent review recorded as
`E1-G1-FOLLOWUP-08-REVIEW-20260811`, but later real console-diagnostic replay
reopened that grammar. `G1-FOLLOWUP-11` supersedes it as the current shared
parser result. The F08 record remains append-only local evidence and is not a
candidate, CI, G1, or G2 result.

## G1-FOLLOWUP-09 candidate-evidence zero-skip parser lease

`G1-FOLLOWUP-09` is a narrow local correction to the independent
candidate-evidence copy of the zero-skip parser. It may edit only
`scripts/{candidate-evidence.mjs,candidate-evidence.test.mjs}` and this run
directory's `{scope.md,state.md,change-map.md,validation.md,handoff.md}`. It
must reject every actual skipped, todo, pending, or cancelled result from a
formal Jest or Node TAP record, while ignoring ordinary gate diagnostics such
as `payment reconciliation: 2 skipped provider images`. Regressions must cover
formal nonzero Jest/TAP outcomes, formal zero outcomes, inline TAP skip/TODO
markers, ANSI output, and diagnostic false positives. It must not alter gate
commands, test subjects, package scripts, candidate policy, SBOM, workflow,
Docker, Compose, browser, or runtime behavior.

This lease was acquired by `/root` at `2026-08-11 07:08:59 CST` against the
registered dirty remediation worktree and baseline/current `HEAD`
`cbac594ba7387e2455faa1df97c489afb5616c07`. The leased source hashes at
acquisition were `candidate-evidence.mjs`
`1f974b2ed8541e735b3ef95721502889a12eb6b3b2d03c99485190c4989c80f4` and
`candidate-evidence.test.mjs`
`129d4211282c1d97a89f793147f130bf308a667a60df41d0f2a18ae8866744ae`.
It grants no authority to capture a candidate, stage, commit, tag, push,
dispatch CI, install dependencies, use Docker, access a database/Redis target,
launch a browser, access a registry, or perform any external action.

Closure: `G1-FOLLOWUP-09` is not a completed result; it was reopened and
superseded by the independently reviewed shared correction in
`G1-FOLLOWUP-11`.

## G1-FOLLOWUP-12 historical-package supersession lease

`G1-FOLLOWUP-12` is a non-destructive documentation correction. It may edit
only `docs/cto-self-audit/runs/2026-08-04-web-miniprogram-g0/{README-PACKAGE.md,
state.md,candidate-manifest.md,handoff.md,validation.md}` and this run
directory's `{scope.md,state.md,change-map.md,validation.md,handoff.md}`.
Each historical entry file must receive the same conspicuous top banner before
any historical completion/Go claim: it must identify the dirty 2026-08-07
baseline, deny use as current candidate/E2/G1/G2-ready/G2/CI/release/
authorization/external evidence, and link to this remediation state showing
`G1 NO-GO`, `G2-ready NO-GO`, and `G2 BLOCKED`. The historical body and G0
scope decisions must remain intact.

This lease was acquired by `/root` at `2026-08-11 07:24:21 CST` against the
registered dirty remediation worktree and baseline/current `HEAD`
`cbac594ba7387e2455faa1df97c489afb5616c07`. Acquisition hashes in entry-file
order are `38b978827c229daba2eac3def74d91c532f235752fb71627d5c208be6299855f`,
`ecd56231735c5adebda40c9bbb3fd945b2967843a479a080413e0862b2a550fc`,
`303ac30c6fea148878a2bf6eb2c8e221dbf7d13183881a65dc007d25ccd670e2`,
`6bdcce1c8d6c0dad0a22c5ac8f79d118709f7e98eca74a30b1f31b6709f8a526`, and
`df8194ebf42fb5090d2717dc5f2564674d47c5ea2534376a37bb1f57faeec52c`.
It grants no authority to stage, commit, tag, push, dispatch CI, access a
registry, use Docker, access a database/Redis target, launch a browser, or
perform any external action.

Closure: `G1-FOLLOWUP-12` completed at static/local documentation scope with
evidence `E1-G1-FOLLOWUP-12-LOCAL-20260811` and independent review
`E1-G1-FOLLOWUP-12-REVIEW-20260811`; it created no current release evidence.

## G1-FOLLOWUP-10 Mini historical voice-order UX lease

`G1-FOLLOWUP-10` is a narrow local Mini Program correction. It may edit only
`frontend/miniprogram/pages/order/{detail.ts,detail.wxml}`,
`frontend/miniprogram/pages/orders/{index.ts,index.wxml}`,
`frontend/miniprogram/scripts/smoke.mjs`, and this run directory's
`{scope.md,state.md,change-map.md,validation.md,handoff.md}`. Under the
existing first-release text-only boundary, it must hide and handler-block
historical voice-order confirm/start/create-reschedule/accept-reschedule
actions before any API call. It must preserve order reads, cancellation,
refund/support routes, and rejection or other closure of an existing
reschedule request. It must not change the server policy or decide whether an
already in-service historical voice order may be completed.

This lease was acquired by `/root` at `2026-08-11 07:12:59 CST` against the
registered dirty remediation worktree and baseline/current `HEAD`
`cbac594ba7387e2455faa1df97c489afb5616c07`. The acquired hashes in list order
are `f12482c156c43a11131bda7680d20d2ea5dc2d165100b47492559a3b8fe63166`,
`f02af75afcef2cd78c19b8bd7a3c9f962cfd5296a3107098cedb07113048092a`,
`6bfcdfa0c5509605234dcf745c805771fb472bbeb10c3536544a9456fdfa6616`,
`01fa39b42981ca52904c5d65a1172b0c460b63223d36f72dad0c112feefe7f5b`, and
`3e6fc5b10fdd749428a29fd88b6a98bc1ee52fb5acb740fb03dc94657de6bc22`.
It grants no authority to run a Mini device/client, capture a candidate,
stage, commit, tag, push, dispatch CI, use Docker, access a database/Redis
target, launch a browser, access a registry, or perform any external action.

Closure: `G1-FOLLOWUP-10` completed at static/local scope with evidence
`E1-G1-FOLLOWUP-10-LOCAL-20260811` and independent review
`E1-G1-FOLLOWUP-10-REVIEW-20260811`; no Mini device or external action ran.

## G1-FOLLOWUP-11 shared terminal-summary parser lease

`G1-FOLLOWUP-11` reopens the parser result claimed by `G1-FOLLOWUP-08` and
supersedes the insufficient candidate-only refinement in `G1-FOLLOWUP-09`. It
may edit only `scripts/{candidate-evidence.mjs,candidate-evidence.test.mjs}`,
`backend/api/scripts/{assert-zero-skips.mjs,assert-zero-skips.test.mjs}`, and
this run directory's `{scope.md,state.md,change-map.md,validation.md,handoff.md}`.
Both parsers must count only outcomes in a complete terminal Jest or Node TAP
summary block, plus formal inline Node TAP skip/TODO records. They must ignore
real test console diagnostics which Node prefixes as `# skipped N` or Jest
indents as `Tests: N skipped, N total`. Regressions must execute both kinds of
diagnostic and actual skipped/TODO paths. This lease must not change test
subjects, package scripts, candidate policy, SBOM, workflow, Docker, Compose,
browser, or runtime behavior.

This lease was acquired by `/root` at `2026-08-11 07:18:17 CST` against the
registered dirty remediation worktree and baseline/current `HEAD`
`cbac594ba7387e2455faa1df97c489afb5616c07`. Acquisition hashes in lease order
are `a53d9c7b430543b5dafe500d492ef37e3520793742f8b4b0408bacb6bacbc647`,
`38e5e554cfca6b85c8d68d9c6173723af21bf6ee7b43991fe906b53f2133ea69`,
`1299f2fc95d833074f4bc2d63a163fd52e96370403ace30a07b880990ccf9fd5`, and
`75ccfae5b9c0d69c0a25cdb57e79b70de8cb6c832e05de746ccbbeda3c43d74f`.
It grants no authority to capture a candidate, stage, commit, tag, push,
dispatch CI, install dependencies, use Docker, access a database/Redis target,
launch a browser, access a registry, or perform any external action.

Closure: `G1-FOLLOWUP-11` completed at static/local source-contract scope with
evidence `E1-G1-FOLLOWUP-11-LOCAL-20260811` and independent review
`E1-G1-FOLLOWUP-11-REVIEW-20260811`; F09 remains superseded and no runtime or
external action was authorized.
