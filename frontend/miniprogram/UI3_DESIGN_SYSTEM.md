# Talk&Talk Mini Program UI 3.0

> Superseded as the active composition and motion specification by [UI4_DESIGN_SYSTEM.md](./UI4_DESIGN_SYSTEM.md). The UI 3.0 pastel palette, semantic-state colors, text-only boundaries and accessibility rules remain the required baseline.

## Direction

UI 3.0 uses a low-saturation pastel card ecosystem over a neutral operating skeleton. Color distinguishes content categories; it never substitutes for verified availability, payment, safety, identity or moderation state.

Target ratio:

- 65–70% neutral canvas and operating surfaces.
- 20–30% pastel content cards.
- 5–10% dark text, selected strokes and primary actions.

## Canonical tokens

`app.wxss` owns the canonical `--tt-color-*` tokens and preserves the previous `--tt-*` aliases during migration.

Pastel content tones:

| Tone | Light background | Light foreground | Content use |
|---|---:|---:|---|
| Powder blue | `#DDE8F2` | `#314F67` | listening, knowledge, communication |
| Soft apricot | `#F1DED5` | `#6B4237` | service types and action themes |
| Mist mint | `#DDECE3` | `#315447` | support relationships and growth |
| Soft lavender | `#E9E1F0` | `#574668` | reflection, relationships, bedtime |
| Butter cream | `#F3EACD` | `#67551F` | time, planning and explanations |
| Dusty rose | `#F0DFE5` | `#68424F` | stories, reviews and personal content |

Each tone has its own background, foreground and stroke token in light and dark modes. `--tt-color-fg-tertiary` is allowed only on neutral Canvas/Surface; pastel cards must use their paired foreground.

System states remain independent:

- success
- info
- warning
- danger
- unknown/unavailable

Every state combines text with a shape or icon. Selection combines stroke/check/text and never relies on color alone.

## Card components

Foundation:

- `tt-card-shell`: tone, size, interaction, selection and optional storytelling tilt.
- `tt-card-grid`: grid, mosaic, stack and rail composition.
- `tt-section-heading`: section hierarchy and optional action.

Composed cards:

- `tt-scene-card`
- `tt-fact-card`
- `tt-timeline`
- upgraded `tt-media-card` variants: list, compact, card and horizontal.

Domain-specific order, payment, dispute, safety and earnings templates stay domain-specific. They must not be forced into a generic card API.

## Interaction boundaries

- Only scene, dialogue-example and brand-story cards may use `±1.6°` static tilt.
- Action, payment, safety, crisis, evidence and state cards remain level and cannot be stacked.
- Press feedback is 160ms; entrance motion is 240ms.
- Reduced-motion removes rotation, translation and stagger.
- Web-style controls target at least `88×88rpx` in Mini Program UI.

## Release boundaries

- Trial/release remain text-only until real capability gates open.
- Voice, image, live-call, voice-intro, profile-media and voice-SKU cards do not render while disabled.
- Public-interaction identity gates continue to block community posts, new bookings, payment and new messages in UI handlers and on the server.
- `unknown`, load failure and unavailable states never collapse to zero or success.

## Verification

Run from the repository root:

```bash
backend/api/node_modules/.bin/tsc -p frontend/miniprogram/tsconfig.json --noEmit
node frontend/miniprogram/scripts/validate.mjs
node frontend/miniprogram/scripts/smoke.mjs
node frontend/miniprogram/scripts/ui2-audit.mjs
node frontend/miniprogram/scripts/test-local-build.mjs
```

The audit filename is retained for CI compatibility, but its output and component gate identify UI 3.0.

Static checks do not substitute for the required 31-page light/dark DevTools matrix or representative real-device flows.
