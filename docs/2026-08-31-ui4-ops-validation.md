# UI4 Pastel Card Theatre — Admin and Review validation

Date: 2026-08-31
Scope: commercial Admin and independent Review static applications.
Release action: none. No commit, push, credential use, or deployment was performed.

## Result

Local implementation and static verification passed.

### Login surfaces

- Admin uses a blue operating-truth stage, an apricot credential card, a quiet folder object and layered controlled-mode papers.
- Review uses a lavender independent-review stage, a blue credential card, a quiet folder object and separate evidence papers.
- Both retain username, password and six-digit TOTP fields, visible focus, a 50 px login action, no inline script, and the existing same-origin CSP contract.
- Admin still calls `/auth/staff/login`; Review still calls `/api/v1/review/auth/login`.

### Authenticated workbenches

The theatre treatment is deliberately login-only. Authenticated surfaces remain M0/M1:

- no cartoon objects or perspective in cases, evidence, identity, payment, safety, audit, or controlled actions;
- flat panels and restrained pastel metric/state cards;
- no hover lift on operational list rows or high-risk actions;
- controlled-mode, reason, confirmation, two-person review and role-capability behavior unchanged;
- all existing DOM IDs and JavaScript selectors preserved.

## Automated verification

- Admin JavaScript syntax — passed
- Review JavaScript syntax — passed
- targeted Admin/Review static contracts — 19/19 passed
- API TypeScript build and copied public assets — passed
- complete static preflight — 94/94 passed, zero skips
- production artifact verification — passed

## Browser evidence

Desktop login views:

- `artifacts/ui4-ops-admin-1280.png`
- `artifacts/ui4-ops-review-1280.png`

Mobile story and login views:

- `artifacts/ui4-ops-admin-390.png`
- `artifacts/ui4-ops-admin-390-login.png`
- `artifacts/ui4-ops-review-390.png`
- `artifacts/ui4-ops-review-390-login.png`

At 1280 and 390, both applications reported no document overflow, one login theatre, three credential inputs, a 50 px login button, the correct body identity class and the correct identity-specific script. `#portalView` remained hidden. No browser console warning or error was observed.

## Evidence boundary

The browser check used the static public assets and did not submit credentials or connect to production data. Authenticated queues, role-specific data, evidence access, mutations and audit writes were not exercised in a real backend session. Their existing source/static contracts passed, but that is not a substitute for authorized role-based browser validation.
