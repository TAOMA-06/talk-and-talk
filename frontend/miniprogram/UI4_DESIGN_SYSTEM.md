# Talk&Talk Mini Program UI 4.0

> Active specification for the Mini Program card, depth, motion and cartoon-object foundation.
> UI 3.0 remains the color/accessibility baseline; UI 4.0 supersedes it as the active composition and interaction specification.

## 1. Direction

UI 4.0 is the **Pastel Card Theatre** system approved from the five-scene prototype. It keeps the restrained UI 3.0 pastel palette and adds:

- physical-looking paper layers without turning the product into a game;
- smoother, finite card entrance and selection transitions;
- small cartoon objects that support recognition and emotional tone;
- explicit motion and risk contracts so serious workflows remain stable.

The target experience is “many available responses, few simultaneous movements.” A page may contain many motion-capable cards, but mobile playback should normally keep no more than three elements moving at once.

This file describes the shared foundation only. A page is not considered migrated merely because it inherits these tokens or components.

## 2. Unchanged color contract

The canonical palette still lives in app.wxss. Do not duplicate hex values in page or ordinary component styles.

| Content tone | Meaning |
|---|---|
| blue | listening, knowledge, communication |
| apricot | services, invitations, gentle actions |
| mint | support, growth, relationships |
| lavender | reflection, bedtime, emotional space |
| butter | time, planning, explanation |
| rose | stories, reviews, personal content |

Success, info, warning, danger and unknown remain semantic state colors. Pastels must never substitute for verified identity, availability, payment, refund, safety or moderation state.

Dark mode uses the existing low-chroma dark mappings. The depth system adds neutral near/far paper tokens and three shadow tokens, but does not change the paired pastel foregrounds.

## 3. Motion tokens

| Token | Value | Use |
|---|---:|---|
| --tt-motion-instant | 0ms | motion-off and M0 |
| --tt-motion-press | 140ms | touch acknowledgement |
| --tt-motion-standard | 260ms | ordinary content transition |
| --tt-motion-emphasis | 420ms | one-time card focus or section arrival |
| --tt-motion-hero | 620ms | low-risk stage assembly |
| --tt-motion-stagger | 70ms | distance between adjacent card entrances |
| --tt-ease-standard | smooth deceleration | routine transitions |
| --tt-ease-emphasis | stronger ease-out | page/section arrival |
| --tt-ease-playful | restrained overshoot | low-risk cards and props only |

All shared transitions and keyframes animate only transform and opacity. transition: all, infinite animation, gradient animation and layout-property animation are prohibited.

Small text never uses element opacity for visual hierarchy. Labels, descriptions and metadata use a validated solid foreground; opacity is reserved for finite entrance/press feedback, skeletons and purely decorative prop parts.

### Motion levels

| Level | Default behavior | Allowed examples |
|---|---|---|
| M0 | fully stable | crisis, payment result, identity, evidence, unknown/failure |
| M1 | immediate state and press response | forms, sheets, filters, work queues |
| M2 | one-time standard arrival | ordinary content groups |
| M3 | card deal/fan/selection response | discovery and personal content |
| M4 | one-time theatre assembly | home/brand hero only |

M2–M4 are opt-in. Shared components default to M0 or M1 and no entrance. active must also be true before a stage or prop plays.

## 4. Depth model

tt-card-shell provides flat, low, mid and high depth. low renders one subtle paper offset; mid and high expose two offset planes.

The implementation uses only non-negative layers:

1. far paper plane, z-index 1;
2. near paper plane, z-index 2;
3. content surface, z-index 3.

Depth planes use pointer-events: none. The owning card remains the tap target, so a visual layer can never make an interactive card unreachable.

Use:

- flat: payment, refunds, identity, legal consent, safety, evidence and dense controls;
- low: ordinary browse cards;
- mid: featured content and selected low-risk cards;
- high: a single low-risk hero card, never a scrolling list.

Do not add page-local shadows. Use the shared elevation tokens through tt-card-shell or tt-media-card.

## 5. Shared component contracts

### tt-card-shell

Existing properties remain supported: tone, size, interactive, selected, disabled, tilt and ariaLabel.

| New property | Default | Values / contract |
|---|---|---|
| depth | flat | flat, low, mid, high |
| motionLevel | m1 | m0 through m4 |
| entrance | none | none, rise, deal-left, deal-center, deal-right |
| stagger | 0 | integer 0 through 5 |
| motionOff | false | when true, render the final static state |
| risk | high | high disables decorative entrance; use standard only after classification |

Selection uses a stroke and aria-pressed, not color alone. Interactive cards retain an 88rpx minimum target.

Do not combine a static tilt with an entrance animation on the same shell. Put tilted cards inside tt-card-stage, where layout and entrance transforms are separated.

### tt-card-stage

The stage provides named back, middle, front and decorative prop slots. It is static, M1 and high-risk-safe by default.

| Property | Default | Values / contract |
|---|---|---|
| layout | stack | stack, fan, deck, assemble |
| minHeight | 360 | numeric rpx height |
| motionLevel | m1 | M3/M4 required for theatre entrances |
| entrance | none | none, rise, deal, fan, assemble |
| active | false | play only after real content is ready |
| motionOff | false | final static composition |
| risk | high | must be standard before decorative motion can run |
| ariaLabel | 卡片组合 | meaningful group name |

Example:

    <tt-card-stage
      layout="fan"
      min-height="420"
      motion-level="m3"
      entrance="fan"
      active="{{sceneReady}}"
      motion-off="{{motionOff}}"
      risk="standard"
      aria-label="选择一种陪伴场景"
    >
      <tt-scene-card slot="back" title="散步聊聊" tone="mint" />
      <tt-scene-card slot="middle" title="安静听你说" tone="blue" />
      <tt-scene-card slot="front" title="睡前陪伴" tone="lavender" />
      <tt-cartoon-prop slot="prop" kind="lamp" tone="butter" risk="standard" decorative />
    </tt-card-stage>

Each stage layer is pointer-transparent while its card hit area is pointer-active. Do not replace this with a negative z-index implementation.

### tt-cartoon-prop

Available kinds: bubble, lamp, cup, magnifier, envelope, calendar, folder and sprout.

| Property | Default | Contract |
|---|---|---|
| tone | blue | one canonical pastel tone |
| size | md | sm, md, lg |
| motion | none | none, peek, nod, breathe |
| active | false | plays a finite response |
| motionOff | false | final static state |
| expressive | false | adds a minimal face only in low-risk content |
| risk | high | removes expression and blocks motion |
| decorative | true | maps to aria-hidden; set false only when the object conveys information |
| ariaLabel | empty | required when decorative is false |

Props are CSS shapes with no remote asset, GIF or Lottie dependency. They may support a heading or empty state, but they never replace explanatory text.

### Updated components

- tt-scene-card: named prop slot plus depth/motion contract; explicitly low-risk.
- tt-media-card: optional layered depth and opt-in entrances.
- tt-fact-card: defaults to flat, M0 and high risk.
- tt-state: defaults to M0; loading motion is finite and opt-in at M1.
- tt-skeleton: pulse runs twice at most.
- tt-sheet and tt-filter-sheet: M1 essential entrance only; root-portal keeps local light/dark and motion tokens.
- tt-card-grid and tt-section-heading: group arrival is opt-in.
- tt-action-bar and tt-status: no decorative animation.

## 6. Motion-off and reduced-motion

Pages need both contracts:

1. initialize motionOff: false in every registered page data object;
2. add tt-motion-off to the page content root for global utility classes;
3. pass motion-off="{{motionOff}}" to every motion-capable custom component because component style isolation prevents a page class from reaching its internals.

    <view class="page {{motionOff ? 'tt-motion-off' : ''}}">
      <tt-scene-card motion-off="{{motionOff}}" />
    </view>

prefers-reduced-motion: reduce is implemented in every motion-capable shared component. Disabling motion removes animation/transition but preserves the static card order, content, state and hit targets.

Every view with tabindex 0 receives the shared focus ring. Component-internal bindtap views must also provide aria-role, a keyboard tabindex contract and a local :focus rule because style isolation may block app-level focus styling.

## 7. Cartoon and safety boundaries

Cartoon faces, peek/nod/breathe motion, card deal/fan motion and high depth are forbidden in:

- payment amount, payment processing, payment result and refund timeline;
- crisis resources, unsafe-now actions and emergency exit;
- adult eligibility, identity verification, identity authorization and account deletion;
- reports, evidence, appeals, reviewer conclusions and moderation actions;
- legal consent and privacy authorization;
- unknown, unavailable, load failure or unsynchronized result;
- user disclosure text and real review body;
- disabled voice, media and live-call capability surfaces.

These areas use M0 or M1, risk high, flat cards and normal state/press feedback. A cartoon prop must not be mounted and hidden with opacity in a forbidden area; it should not render at all.

The text-only release boundary is unchanged. UI 4.0 does not authorize voice, image, audio evidence, profile media, live calls, voice introductions or voice SKUs.

## 8. Approved scene translations

| Demo scene | Product translation |
|---|---|
| Listening lounge | home scene selection and low-risk recommendation |
| Midnight desk | reflective prompts and bedtime content |
| Discovery garden | discovery filters and result emphasis |
| Message post office | non-sensitive compose feedback with honest delivery state |
| Growth studio | companion learning and ordinary progress |

The demo's long 1.4–1.8 second entrances are not production defaults. Mini Program uses 420–620ms entrances with 70ms stagger and finite prop responses for smoother, more responsive transitions.

## 9. Page migration contract

Every page worker must follow this order:

1. Record the page's primary action, data states and risk level before changing layout.
2. Preserve WXML event names, TypeScript handlers, navigation routes, API gates, identity rules and fail-closed states.
3. Choose one dominant composition: neutral operating surface, card grid, or a single card stage.
4. Assign content tones by meaning; keep system states semantic.
5. Use shared depth components instead of page-local shadow code.
6. Add M2–M4 only after content readiness. Do not replay on every polling or pagination update.
7. Initialize motionOff: false, bind the root tt-motion-off class and pass motion-off to every motion-capable custom component.
8. In wx:for lists, animate only index 0–2; items at index 3 and later render in their final static state.
9. An M4 three-card stage already consumes the mobile concurrency budget. Start a prop response only after the stage settles, never from the same active binding.
10. Test loading, empty, error, unknown, disabled, selected, long text, keyboard focus, dark mode and narrow width.
11. For M3/M4 pages, verify exposed back/middle cards can still be tapped.
12. Run the UI audit before handing the page to the next wave.

Migration waves:

1. Home, discover and companion detail establish the expressive ceiling.
2. Community, messages, notifications and profile reuse the approved vocabulary.
3. Companion workbench/growth pages use M1–M2, with M3 only for ordinary learning progress.
4. Orders, payment, refund, safety, support, identity, legal and crisis remain flat M0/M1.
5. Re-run the full 31-page light/dark/width evidence matrix after every page is migrated.

## 10. Verification

Run from the repository root:

    UI4_FOUNDATION_ONLY=1 node frontend/miniprogram/scripts/ui2-audit.mjs
    backend/api/node_modules/.bin/tsc -p frontend/miniprogram/tsconfig.json --noEmit
    node frontend/miniprogram/scripts/validate.mjs
    node frontend/miniprogram/scripts/ui2-audit.mjs
    node frontend/miniprogram/scripts/ui3-contrast-audit.mjs
    node frontend/miniprogram/scripts/smoke.mjs

The first command validates the shared foundation while page waves are in progress. The historical ui2-audit.mjs filename is retained for CI compatibility. Its normal mode is the final gate and rejects raw page/component colors, uncontrolled rgba values, decorative gradients, page-local shadows, negative z-index, transition: all, infinite animation, non-transform/opacity motion, missing focus contracts, missing motion-off propagation, unbounded list entrance and concurrent M4 stage/prop playback.

Passing this static foundation audit does not mean the 31 pages have completed their UI 4.0 migration or real-device validation.
