# UI4 Pastel Card Theatre — Public Web validation

Date: 2026-08-31
Scope: the five indexable public routes only (`/`, `/how-it-works`, `/safety`, `/about`, `/partners`).
Release action: none. No commit, push, upload, or deployment was performed.

## Result

Local implementation and verification passed for the public Web surface.

| Route | UI4 treatment | Motion level | Browser result |
| --- | --- | --- | --- |
| `/` | Listening Lounge hero with a three-layer paper deck, lamp and cup; layered value, moment, trust and channel cards | M4 | 390 and 1280: no document overflow |
| `/how-it-works` | Four-step path cards assemble over a paper stack and thread prop | M3 | 390 and 1280: no document overflow |
| `/safety` | Stable flat safety hero, boundary panels and urgent card | M0–M1 | No theatre component; urgent content remains static |
| `/about` | Open worktable with pinned notes and restrained folder prop | M3 | 390 and 1280: no document overflow |
| `/partners` | Adult paper-and-folder collaboration frame | M2–M3 | 390 and 1280: no document overflow |

The public policy boundary is unchanged. No public page links to `/login`, `/orders`, `/messages`, `/workbench`, `/discover`, `/business`, or `/demo` as a product entry.

## Motion and rendering contract

- The existing Framer Motion runtime is reused; no additional animation framework was added.
- Theatre layers enter once when the stage approaches the viewport. There is no infinite animation.
- Server-rendered and no-JS markup paints every layer visibly; animation starts only after hydration and cannot create a content-sized blank area.
- Scroll reveal uses transform and opacity through Framer controls; initial-viewport content stays static and visible.
- Hover movement is interruptible CSS transition only and is disabled for touch layouts.
- `prefers-reduced-motion: reduce` removes theatre movement, card tilt and button lift while keeping the final layout visible.
- Stage dimensions are reserved before motion, preventing animation-driven layout shift.

## Accessibility and layout checks

- Public CTAs measured 44 px high on the 390 px viewport.
- Focus treatment remains a 3 px visible outline.
- Decorative SVG/CSS props are `aria-hidden`; removed hero summaries were preserved as screen-reader-only text where they carried service-boundary meaning.
- FAQ expands with its native `<details>/<summary>` interaction; click behavior was verified in the local browser.
- Palette contrast calculations:
  - blue 7.24:1
  - apricot 6.69:1
  - mint 6.96:1
  - lavender 6.83:1
  - butter 6.20:1
  - rose 6.50:1
  - urgent danger 7.53:1

## Automated verification

- complete `npm run check` — passed as a single command with the loopback Worker test permitted
- `npm run typecheck` — passed
- `npm run lint` — passed
- `npm run build` — passed
- policy tests — 19/19 passed
- open-surface rendered HTML — 25/25 passed
- default locked surface — 26/26 passed
- production hostile-reopen surface — 26/26 passed
- Worker image runtime — passed after allowing its temporary loopback listener; the first sandboxed attempt was blocked by `listen EPERM`, not an application failure

## Browser evidence

Desktop:

- `artifacts/ui4-web-home-1280.png`
- `artifacts/ui4-web-how-1280.png`
- `artifacts/ui4-web-safety-1280.png`
- `artifacts/ui4-web-about-1280.png`
- `artifacts/ui4-web-partners-1280.png`

Mobile:

- `artifacts/ui4-web-home-390.png`
- `artifacts/ui4-web-how-390.png`
- `artifacts/ui4-web-safety-390.png`
- `artifacts/ui4-web-about-390.png`
- `artifacts/ui4-web-partners-390.png`

Every route reported `documentElement.scrollWidth === clientWidth` at both tested widths. The local browser did not expose reduced-motion emulation, so reduced-motion was verified by source contract rather than claimed as a browser-emulated pass.

## Remaining external gates

This is local repository and browser evidence only. It does not prove production deployment, remote CDN behavior, production analytics, independent accessibility certification, or a real-user performance result.
