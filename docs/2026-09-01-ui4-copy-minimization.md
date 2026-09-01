# UI4 action-first copy minimization

Date: 2026-09-01
Scope: five public Web routes plus Admin and independent Review UI.
Release action: none. No commit, push, credential submission, or deployment was performed.

## Outcome

The primary UI now keeps route thesis, immediate actions, current authoritative facts, critical safety/payment/identity/permission/error/unknown information, and required field labels. Repeated education, decorative design labels, FAQ prose, duplicated closing CTAs and repeated platform-boundary explanations were removed from the DOM rather than hidden with CSS.

The UI4 pastel theatre, finite motion, route metadata and public/private surface policy remain intact.

## Copy reduction metric

Metric: count of Han characters plus Chinese punctuation in the owned source file. This is a consistent before/after density indicator, not a claim about reading time or rendered word count.

| Surface | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Home | 1,336 | 345 | 74.2% |
| How it works | 837 | 220 | 73.7% |
| Safety | 802 | 515 | 35.8% |
| About | 670 | 223 | 66.7% |
| Partners | 680 | 251 | 63.1% |
| Five routes total | 4,325 | 1,554 | 64.1% |
| Shared Mini Program CTA | 103 | 66 | 35.9% |
| Shared public shell/footer | 314 | 219 | 30.3% |
| Admin static HTML | 3,752 | 3,519 | 6.2% |
| Review static HTML | 836 | 646 | 22.7% |

Admin has a smaller reduction because its remaining copy mostly describes current money, identity, permission, evidence, SLA, two-person review, or unknown-state constraints. Removing those would make actions less safe.

## Route and surface changes

### Home

- Kept the product thesis, 18+ audience, current identity gate, Mini Program action, three immediate need cards and a three-step start path.
- Removed the long value proposition grid, repeated trust grid, brand-symbol essay and duplicate closing CTA.
- Consolidated full guidance into concise Safety, Terms/Platform Rules and Privacy links.

### How it works

- Kept four steps and the authoritative payment/refund statement.
- Removed the FAQ section, duplicate hidden summary and second closing CTA.
- Shortened each step to one action plus one current fact.

### Safety

- Kept urgent danger instructions, all four stop conditions, platform-only boundaries and the report-receipt unknown state inline.
- Shortened general introductions and support-card descriptions.
- Removed only the duplicate closing CTA.

### About

- Kept the route thesis, current identity gate, verified/unverified disclosure state, contact action and two core product facts.
- Removed the repeated belief essay and duplicate safety boundary list.

### Partners

- Kept three collaboration entries, three decision criteria, contact action and the prohibition on unverified claims.
- Removed repeated explanations and hidden duplicate copy.

### Admin and Review

- Shortened login stories, decorative theatre labels, generic module introductions, metric footnotes and empty-state prose.
- Kept field labels, access separation, controlled-mode rules, permission reasons, evidence constraints, payment/refund truth, identity gating, two-person review, SLA, error recovery and unknown-state wording.
- No DOM ID, script path, API endpoint, role, permission or mutation behavior changed.

## Legal and rules coverage

No legal files required a content change.

- `backend/api/src/legal/legal.controller.ts` already carries current service scope, age and identity, appointment/payment/refund, platform communication/content rules, complaints, privacy processing, retention and user-rights sections.
- `backend/api/public/legal/terms.html` and `privacy.html` already redirect to the current generated versions and retain fallback content.
- A shared `PublicRuleLinks` component now links public pages to Safety, User Agreement/Platform Rules and Privacy Policy.

No urgent or current-step fact was moved into legal pages. No new legal or compliance promise was invented.

## Verification

- complete Web `npm run check` — passed
- Web policy — 19/19 passed
- open rendered HTML — 26/26 passed
- default locked surface — 27/27 passed
- production hostile-reopen lock — 27/27 passed
- Worker image runtime — passed
- Admin/Review JavaScript syntax — passed
- Admin/Review static contracts — 20/20 passed
- API build — passed
- production artifact verification — passed
- complete backend static preflight — 95/95 passed, zero skips (an interim concurrent Mini Program refund-label mismatch was resolved by its owner before this final run)

## Browser evidence boundary

At the end of this worker-local copy pass, post-change 390/1280 browser screenshots had not yet been refreshed because the in-app browser runtime reported no available browser instances after the documented connection audit. A later final-validation pass did refresh all five routes at both widths; its screenshots and conclusions are recorded in `artifacts/ui4-web-copy-*.png` and `docs/2026-09-01-ui4-final-validation.md`. This section remains as timeline context and is not the final package boundary.
