# Required decisions — G1 remediation

## Scope decisions already confirmed

The prior user confirmation of the four G0 defaults remains binding for this
recovery task. The earlier run package is stale as release evidence, but it is
still an auditable record of those scope choices. No route is reopened merely
because its former evidence package is invalid.

| Decision ID | Confirmed boundary | Current effect |
|---|---|---|
| `G0-D01` | The official Web surface explains, publishes rules, and directs users to the Mini Program; the Mini Program provides the current service; Web trade remains deferred. | Web fixes remove public dead links instead of publishing Web trade. |
| `G0-D02` | Deferred Web trade routes use a real feature gate and 404 or redirect; `robots` and `noindex` are insufficient. | Production policy must fail closed for deferred pages and BFF/session routes. |
| `G0-D03` | `/business` and `/demo` are private by default. | Public navigation and CTAs must not target either path. |
| `G0-D04` | Web BFF and transaction integration remain isolated-development capability, not a public-site completion condition. | Production BFF/session access must remain denied under every environment-variable combination. |

The approved first-release target remains strict `text-only` for ordinary
customer, companion, and review media/voice/TRTC surfaces: historical
attachment binding/read and voice SKU access must be unreachable on the
server, API contract, and Mini Program. The separate provider-managed
payment-dispute evidence channel is not silently included in that statement:
it remains a G1 no-go until `PAYMENT-DISPUTE-MEDIA-R01` selects an approved
staff-only exception, end-to-end disablement, or deferral of that surface.

| Decision ID | Question | Why it blocks implementation | Current status |
|---|---|---|---|
| `MODEL-R01` | Which exact model may write code if Luna max/Ultra remains unavailable? Include a user Evidence ID. | The original task contained this provenance rule, but the user explicitly removed it from core-work assessment on 2026-08-09. | audit-only; not an implementation or G1-core blocker by current instruction |
| `IDENTITY-R01` | What is the approved public-interaction identity authority, lifecycle, recovery owner, and user-facing recovery route? | A boolean alone cannot define a real customer recovery flow, and the task must not select a KYC provider or collect identity data without authority. | **confirmed `R01-C` under `USER-AUTH-ALL-20260811`**; new grants frozen; legacy true is unproven and ignored for public interaction |
| `IDENTITY-R02` | Until `IDENTITY-R01` is resolved, should community posting and instant messaging remain unavailable to unverified users with an honest support-assisted fallback? | This chooses a safe product boundary without pretending that profile editing is verification. | **confirmed `R02-A`**; support owner, `/pages/profile/index`, no new identity collection |
| `PERSONALIZATION-R01` | Are any historical `personalizationEnabled=true` records backed by a retrievable, applicable consent ledger? | Without that fact, the migration must reset legacy `true` records and future re-enable must require a new opt-in. | **confirmed A**; historical reset, true rejected with 409, manual discovery retained |
| `EARNINGS-R01` | Which hold reasons are appealable, what window/SLA applies, and what after-sales projection may a companion see? | The service cannot invent a deadline, a financial-release rule, or expose customer/support details. | **confirmed A**; companion-safe category/status/nextAction only; recovery remains support review |
| `PAYMENT-DISPUTE-MEDIA-R01` | In a text-only first release, is the provider-managed payment-dispute `responseImages` / evidence channel an approved staff-only regulated after-sales exception, must it be disabled end-to-end, or must the payment-dispute surface itself remain deferred? | The current server persists and forwards this separate media channel. Calling the release globally text-only without an explicit choice would be false; disabling it may affect regulated provider after-sales handling. | **confirmed B under `USER-AUTH-ALL-20260811`**; reject before mutation/provider forwarding; text reply + support escalation retained |
| `PUSH-R01` | Was the 2026-08-07 push of `cbac594` authorized? | The answer is needed for a truthful external-action audit record; no remote mutation will be made. | **unknown**; current authorization is not retroactive evidence |

## Local test-environment rule

`E2E-R01` is not an external authorization request. The task may create a new,
loopback-only disposable PostgreSQL/Redis
environment only through the new fail-closed runner. It may never reuse an
existing database, Redis instance, container, volume, endpoint, or credential.
The runner must refuse to delete or flush anything unless its explicit safety
conditions are met.

`PUSH-R01` is an audit-trail clarification, not an implementation blocker. The
separate 2026-08-11 blanket authorization permits a new, exact candidate push
attempt after local freeze; it does not retroactively answer `PUSH-R01`.

External actions remain individually bound by the execution package. The user
has authorized safe attempts, but missing credentials, control-plane isolation,
provider custody, devices, fixtures, or results remain blockers and cannot be
recorded as passed by this decision log.

The decision-ready recommendations and reply fields are in
`authority-decision-brief.md`. That document records no credentials, personal
data, vendor secrets, or raw identity evidence.
