# G1 remediation authority decision brief

> Status: confirmed on 2026-08-11 under `USER-AUTH-ALL-20260811`.
> The user authorized the product choices, local implementation, candidate
> freeze, and safe attempts at separately gated external actions. This record
> does not turn a missing credential, protected control plane, provider receipt,
> device run, or external result into evidence.

## Confirmed first-release decisions

| Decision | Confirmed boundary |
|---|---|
| `IDENTITY-R01` | `R01-C`: freeze every new true grant until an approved identity authority and revocation lifecycle exist. Existing `isVerified=true` rows cannot be proven from the repository and are treated as unverified for public interaction at read time. |
| `IDENTITY-R02` | `R02-A`（2026-08-25 交叉审查收紧）：public posting、instant messaging、新订单和预支付均 fail-closed；已有订单读取、履约收尾、售后、支持与数据权利保持可用。Recovery owner 是 support，路由 `/pages/profile/index`，不新增身份字段或上传。 |
| `PERSONALIZATION-R01` | `A`: reset historical true values to false in a new forward-only migration; reject new true requests with 409; preserve manual catalogue/current-request discovery. |
| `EARNINGS-R01` | `A`: companion-visible hold data is limited to typed `category`, `status`, and `nextAction`; no raw hold code or customer/support/provider/reconciliation/settlement facts. `companion_recovery_due` remains support review only. |
| `PAYMENT-DISPUTE-MEDIA-R01` | `B`: disable response-image storage and provider forwarding before mutation. Preserve text reply and support escalation. Product/operations authorization reference: `USER-AUTH-ALL-20260811`; escalation owner: support. |
| `PUSH-R01` | `unknown`: the new authorization cannot retroactively prove whether the 2026-08-07 push was authorized. |

The scope defaults G0-D01 through G0-D04 remain confirmed. The sections below
retain the decision rationale and rejected alternatives for auditability; the
confirmed table above, not the former blank reply forms, is authoritative.

## 1. Identity authority and safe interim — `IDENTITY-R01`, `IDENTITY-R02`

The existing `profile.isVerified` boolean has no user recovery state. Profile
editing, OpenID, phone login, and adult eligibility are not identity proof.

### Recommended minimum

```text
IDENTITY-R01: confirm R01-C
IDENTITY-R02: confirm R02-A

Existing isVerified=true: <all have retrievable approval/evidence references | cannot be proven; treat as unverified at read time>
Recovery owner: support
Recovery route: /pages/profile/index
Fallback: fixed-text support request only; no new identity fields, document upload, photo, face, phone, or free-text identity evidence
```

`R01-C` freezes new identity grants until a real authority is approved. `R02-A`
keeps unverified public posting and instant messaging fail-closed while
preserving reading, orders, after-sales, and a truthful support-assisted path.

### Only if a real authority is already approved

Use `R01-A` instead and supply the following references. Do not provide raw
personal data in this repository.

```text
IDENTITY-R01: confirm R01-A
Authority Evidence ID:
Legal-basis Evidence ID:
Applicable roles:
Status, expiration, and revocation rules:
Identity decision owner:
Support recovery owner:
Existing isVerified=true traceability conclusion:
```

Selecting a new KYC provider is out of scope until the user explicitly names
one and supplies the related authority. No provider will be inferred.

## 2. Historical personalization — `PERSONALIZATION-R01`

The original migration created `personalizationEnabled=true` without a
retrievable consent ledger. Current defaults are off, but existing true values
may silently reactivate when governance changes.

### Recommended decision

```text
PERSONALIZATION-R01: confirm A
```

Decision A resets all historical true values to false, rejects a new `true`
request with 409 while the feature is closed, leaves manual catalogue and
explicit current-request search usable, and requires a new recorded opt-in
before any future re-enable.

Choose B only with a non-secret Evidence ID for a user-linkable ledger that
proves purpose, scope, version, source, timestamp, and revocation state for
every retained true value.

```text
PERSONALIZATION-R01: confirm B
Consent-ledger Evidence ID:
Retention rule for incomplete, revoked, expired, or unlinked records: reset to false
```

## 3. Earnings hold, appeal, and after-sales projection — `EARNINGS-R01`

The current Mini Program can display raw internal hold codes and has no safe
appeal/after-sales projection. A submitted appeal must never release funds by
itself.

### Recommended decision

```text
EARNINGS-R01: confirm A
companion_recovery_due: support review only until a separately approved root-cause appeal policy exists
```

Decision A reuses each root-cause process where one exists (for example,
attendance-dispute deadlines), returns a typed **companion-safe** hold
projection, and otherwise offers correction/support. It does not invent a
universal financial appeal or SLA. The decision record must explicitly name
the allowed companion-visible fields and the public category/copy matrix needed
by `G2-S11`; the recommended minimum is category, status, and next action only,
with no raw hold code, customer, support, provider, reconciliation, or
settlement facts.

If the product requires a new `companion_recovery_due` appeal in this release,
choose B and confirm every policy value below. The sample values are a proposal,
not a default.

```text
EARNINGS-R01: confirm B
Appealable reasons:
Appeal window and timezone:
First-response SLA:
Decision SLA:
Reviewer and independent second-review role:
Historical held-record rule:
Overdue rule:
Allowed companion-visible after-sales fields:
```

## 4. Provider-managed payment-dispute media — `PAYMENT-DISPUTE-MEDIA-R01`

The payment-dispute route is a separate provider/after-sales channel. It can
persist and forward `responseImages` and provider evidence, so it is not covered
by the ordinary text-only chat/case/voice closure. This task must not silently
delete a potentially regulated after-sales capability or falsely describe it as
disabled.

Choose exactly one policy boundary before G1 can claim a text-only release:

```text
PAYMENT-DISPUTE-MEDIA-R01: confirm A | B | C

A — approved controlled staff-only provider-after-sales exception
    Evidence ID for provider/operations/compliance approval:
    Permitted roles and provider paths:
    Retention, access audit, export, and deletion owner:
    Customer/Mini exposure: none unless separately stated

B — disable payment-dispute media end-to-end for the first release
    Provider/operations approval Evidence ID:
    Required customer-facing fallback and escalation owner:

C — defer the payment-dispute surface from the first release
    Product/operations approval Evidence ID:
    Customer-facing availability and escalation boundary:
```

Option A needs a dedicated lease that proves the exception is role-scoped and
does not reopen general media/voice/TRTC paths. Option B needs a dedicated lease
to reject storage/provider forwarding before mutation. Option C needs a
dedicated lease to disable the surface truthfully. None of these choices
authorizes a provider call, payment action, data deletion, or deployment.

## 5. Historical push audit — `PUSH-R01` (non-blocking)

This only corrects the record; it does not authorize a new push.

```text
PUSH-R01: <authorized | not authorized | unknown>
```

## Result of a complete reply

The confirmed table at the top is authoritative. `USER-AUTH-ALL-20260811`
permits the matching local slices, candidate freeze, and safe external attempts;
the G2 execution package still requires exact targets, credentials, custody,
cleanup, and independently reviewable results for each action.
